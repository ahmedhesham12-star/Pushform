import {
  BackSide,
  BufferGeometry,
  Float32BufferAttribute,
  FrontSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  type Intersection,
  type Side,
} from 'three';
import { faceMeshes, listEdges, listFaces, type Model, type Vec3 } from '../kernel';
import {
  applyPoint,
  applyVector,
  compose,
  contextRelation,
  definitionBounds,
  pathDefinition,
  pathTransform,
  placements,
  toMatrix,
  type InstanceId,
  type Placement,
  type Scene,
} from '../scene';
import { EDGE_COLORS, type EdgeHighlight } from './modelView';

/** Geometry outside the editing context is drawn faded, as in SketchUp. */
const FADED_OPACITY = 0.3;

function material(color: number, side: Side, faded: boolean): MeshLambertMaterial {
  return new MeshLambertMaterial({
    color,
    side,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    transparent: faded,
    opacity: faded ? FADED_OPACITY : 1,
    depthWrite: !faded,
  });
}

/** Same colors as the editable model (modelView.ts). Faded back faces use the front color, so faded geometry reads as a neutral ghost. */
const FACES = { normal: [material(0xf3f2ee, FrontSide, false), material(0x8e9fb2, BackSide, false)] as const, faded: [material(0xf3f2ee, FrontSide, true), material(0xf3f2ee, BackSide, true)] as const };
const EDGES = {
  normal: new LineBasicMaterial({ color: 0x262c31 }),
  faded: new LineBasicMaterial({ color: 0x262c31, transparent: true, opacity: FADED_OPACITY, depthWrite: false }),
};

/** A definition's geometry built once and shared by all its instances. */
interface DefinitionGeometry {
  readonly faces: BufferGeometry;
  /** Face id of each triangle, to find the exact normal of a picked face. */
  readonly triangleFaces: readonly string[];
  readonly normals: ReadonlyMap<string, Vec3>;
  readonly edges: BufferGeometry;
}

function buildGeometry(model: Model): DefinitionGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const triangleFaces: string[] = [];
  for (const m of faceMeshes(model)) {
    positions.push(...m.positions);
    normals.push(...m.normals);
    for (let i = 0; i < m.positions.length / 9; i++) triangleFaces.push(m.faceId);
  }
  const faces = new BufferGeometry();
  faces.setAttribute('position', new Float32BufferAttribute(positions, 3));
  faces.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  const ep: number[] = [];
  for (const e of listEdges(model)) if (!e.soft) ep.push(...e.a, ...e.b);
  const edges = new BufferGeometry();
  edges.setAttribute('position', new Float32BufferAttribute(ep, 3));
  return { faces, triangleFaces, normals: new Map(listFaces(model).map((f) => [f.id, f.normal])), edges };
}

/** What a picked mesh belongs to. */
export interface PlacementHit {
  readonly placement: Placement;
  readonly relation: 'inside' | 'outside';
  /** Front normal of the picked face, in world coordinates. */
  readonly normal: Vec3;
  /** The picked face, in the placement's definition. */
  readonly faceId: string | null;
}

/**
 * Every placement of geometry except the open context's own: the root and
 * instances outside the context (faded, not editable), and instances inside
 * it (drawn normally, selected as a whole). Also draws bounding boxes for
 * highlighted instances.
 */
export class InstancesView {
  readonly group = new Group();
  pickables: Mesh[] = [];
  private readonly cache = new Map<Model, DefinitionGeometry>();
  private boxes: LineSegments | null = null;

  build(scene: Scene, context: readonly InstanceId[]): void {
    for (const c of [...this.group.children]) this.group.remove(c);
    this.boxes?.geometry.dispose();
    this.boxes = null;
    this.pickables = [];
    const used = new Set<Model>();
    for (const p of placements(scene)) {
      const relation = contextRelation(p.path, context);
      if (relation === 'context') continue;
      const model = p.definition.model;
      used.add(model);
      let g = this.cache.get(model);
      if (!g) this.cache.set(model, (g = buildGeometry(model)));
      const look = relation === 'outside' ? 'faded' : 'normal';
      const front = new Mesh(g.faces, FACES[look][0]);
      const back = new Mesh(g.faces, FACES[look][1]);
      const lines = new LineSegments(g.edges, EDGES[look]);
      for (const o of [front, back, lines]) {
        o.matrixAutoUpdate = false;
        o.matrix.fromArray(toMatrix(p.world));
        o.userData = { placement: p, relation, geometry: g };
        this.group.add(o);
      }
      this.pickables.push(front, back);
    }
    for (const [model, g] of this.cache) {
      if (used.has(model)) continue;
      g.faces.dispose();
      g.edges.dispose();
      this.cache.delete(model);
    }
    // Picking can happen before the next render updates world matrices.
    this.group.updateMatrixWorld(true);
  }

  /** The placement a raycast hit belongs to, or null when the hit is not on one of these meshes. */
  placementOf(hit: Intersection): PlacementHit | null {
    const data = hit.object.userData as { placement?: Placement; relation?: 'inside' | 'outside'; geometry?: DefinitionGeometry };
    if (!data.placement || !data.relation || !data.geometry || hit.faceIndex == null) return null;
    const faceId = data.geometry.triangleFaces[hit.faceIndex];
    const local = (faceId && data.geometry.normals.get(faceId)) || ([0, 1, 0] as Vec3);
    return { placement: data.placement, relation: data.relation, normal: applyVector(data.placement.world, local), faceId: faceId ?? null };
  }

  /** Bounding boxes around instances placed in the open context, in their highlight colors. */
  highlight(scene: Scene, context: readonly InstanceId[], instances: ReadonlyMap<InstanceId, EdgeHighlight>): void {
    if (this.boxes) {
      this.group.remove(this.boxes);
      this.boxes.geometry.dispose();
      this.boxes = null;
    }
    const def = pathDefinition(scene, context);
    if (!def || !instances.size) return;
    const base = pathTransform(scene, context);
    const pos: number[] = [];
    const col: number[] = [];
    for (const [id, kind] of instances) {
      const i = def.instances.get(id);
      const b = i && definitionBounds(scene, i.definitionId);
      if (!i || !b) continue;
      const world = compose(base, i.transform);
      const corner = (x: number, y: number, z: number) => applyPoint(world, [x ? b.max[0] : b.min[0], y ? b.max[1] : b.min[1], z ? b.max[2] : b.min[2]]);
      const c = EDGE_COLORS[kind];
      // The twelve edges of the box: along x, y and z from each corner on the low side.
      for (const [a, d] of BOX_EDGES) {
        pos.push(...corner(a[0], a[1], a[2]), ...corner(d[0], d[1], d[2]));
        col.push(...c, ...c);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    this.boxes = new LineSegments(g, BOX_LINE);
    this.boxes.renderOrder = 2;
    this.group.add(this.boxes);
  }
}

const BOX_LINE = new LineBasicMaterial({ vertexColors: true, depthTest: false });

type Bit = 0 | 1;
const BOX_EDGES: [[Bit, Bit, Bit], [Bit, Bit, Bit]][] = [];
for (const x of [0, 1] as const)
  for (const y of [0, 1] as const)
    for (const z of [0, 1] as const) {
      if (!x) BOX_EDGES.push([[x, y, z], [1, y, z]]);
      if (!y) BOX_EDGES.push([[x, y, z], [x, 1, z]]);
      if (!z) BOX_EDGES.push([[x, y, z], [x, y, 1]]);
    }
