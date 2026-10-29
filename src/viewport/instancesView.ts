import { BackSide, BufferGeometry, Float32BufferAttribute, FrontSide, Group, LineBasicMaterial, LineSegments, Mesh, MeshLambertMaterial, type Intersection } from 'three';
import { faceMeshes, listEdges, listFaces, type FaceSide, type Model, type Vec3 } from '../kernel';
import {
  applyNormal,
  applyPoint,
  contextRelation,
  definitionBounds,
  inheritedMaterial,
  multiply,
  pathDefinition,
  pathTag,
  pathTransform,
  placements,
  toMatrix,
  type Affine,
  type InstanceId,
  type Placement,
  type Scene,
} from '../scene';
import { FACE_COLOR, FADED_OPACITY, faceMaterial, faceUVs, MaterialLibrary } from './materials';
import { EDGE_COLORS, type EdgeHighlight } from './modelView';

/** Both sides in a tag's color (Color by Tag), normal or faded, made once per color. */
const colored = new Map<string, readonly [MeshLambertMaterial, MeshLambertMaterial]>();
function colorFaces(color: number, faded: boolean): readonly [MeshLambertMaterial, MeshLambertMaterial] {
  const key = `${color}:${faded}`;
  let pair = colored.get(key);
  if (!pair) colored.set(key, (pair = [faceMaterial(color, FrontSide, faded), faceMaterial(color, BackSide, faded)]));
  return pair;
}

/** A tag's #rrggbb color as a number; Untagged shows the usual face color. */
export const tagColor = (s: Scene, path: readonly InstanceId[]): number => {
  const tag = pathTag(s, path);
  return tag ? parseInt(s.tags.get(tag)!.color.slice(1), 16) : FACE_COLOR;
};
const EDGES = {
  normal: new LineBasicMaterial({ color: 0x262c31 }),
  faded: new LineBasicMaterial({ color: 0x262c31, transparent: true, opacity: FADED_OPACITY, depthWrite: false }),
};

/**
 * The triangles of a definition's faces for one side, ordered by the
 * material painted on that side, with a draw group per material (null:
 * unpainted, which shows what the instance passes down).
 */
interface SideGeometry {
  readonly geometry: BufferGeometry;
  /** Face id of each triangle, to find the exact normal of a picked face. */
  readonly triangleFaces: readonly string[];
  /** The material of each draw group. */
  readonly paints: readonly (string | null)[];
}

/** A definition's geometry built once and shared by all its instances. */
interface DefinitionGeometry {
  readonly front: SideGeometry;
  readonly back: SideGeometry;
  readonly normals: ReadonlyMap<string, Vec3>;
  readonly edges: BufferGeometry;
}

function buildSide(model: Model, side: FaceSide): SideGeometry {
  const meshes = faceMeshes(model);
  const paint = new Map(listFaces(model).map((f) => [f.id, f.paint?.[side] ?? null]));
  const paints = [...new Set(meshes.map((m) => paint.get(m.faceId) ?? null))];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const triangleFaces: string[] = [];
  const geometry = new BufferGeometry();
  paints.forEach((key, group) => {
    const start = positions.length / 3;
    for (const m of meshes) {
      if ((paint.get(m.faceId) ?? null) !== key) continue;
      positions.push(...m.positions);
      normals.push(...m.normals);
      uvs.push(...faceUVs(model, m));
      for (let i = 0; i < m.positions.length / 9; i++) triangleFaces.push(m.faceId);
    }
    geometry.addGroup(start, positions.length / 3 - start, group);
  });
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  return { geometry, triangleFaces, paints };
}

function buildGeometry(model: Model): DefinitionGeometry {
  const ep: number[] = [];
  for (const e of listEdges(model)) if (!e.soft) ep.push(...e.a, ...e.b);
  const edges = new BufferGeometry();
  edges.setAttribute('position', new Float32BufferAttribute(ep, 3));
  return { front: buildSide(model, 'front'), back: buildSide(model, 'back'), normals: new Map(listFaces(model).map((f) => [f.id, f.normal])), edges };
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
 * it (drawn normally, selected as a whole), in their materials: each face
 * side's own, else what the instances around it pass down. Also draws
 * bounding boxes for highlighted instances.
 */
export class InstancesView {
  readonly group = new Group();
  pickables: Mesh[] = [];
  private readonly cache = new Map<Model, DefinitionGeometry>();
  private boxes: LineSegments | null = null;

  constructor(private readonly library = new MaterialLibrary()) {}

  /** With `colorByTag`, faces show their tag's color (see tagColor) instead of their materials. */
  build(scene: Scene, context: readonly InstanceId[], colorByTag = false): void {
    for (const c of [...this.group.children]) this.group.remove(c);
    this.boxes?.geometry.dispose();
    this.boxes = null;
    this.pickables = [];
    const used = new Set<Model>();
    for (const p of placements(scene, context)) {
      const relation = contextRelation(p.path, context);
      if (relation === 'context') continue;
      const model = p.definition.model;
      used.add(model);
      let g = this.cache.get(model);
      if (!g) this.cache.set(model, (g = buildGeometry(model)));
      const faded = relation === 'outside';
      const inherited = inheritedMaterial(scene, p.path);
      const looks = (side: FaceSide, s: SideGeometry): MeshLambertMaterial[] => {
        if (colorByTag) return s.paints.map(() => colorFaces(tagColor(scene, p.path), faded)[side === 'front' ? 0 : 1]);
        return s.paints.map((id) => this.library.get(scene.materials.get(id ?? inherited ?? ''), side, faded));
      };
      const front = new Mesh(g.front.geometry, looks('front', g.front));
      const back = new Mesh(g.back.geometry, looks('back', g.back));
      const lines = new LineSegments(g.edges, EDGES[faded ? 'faded' : 'normal']);
      for (const [o, side] of [
        [front, g.front],
        [back, g.back],
        [lines, null],
      ] as const) {
        o.matrixAutoUpdate = false;
        o.matrix.fromArray(toMatrix(p.world));
        o.userData = { placement: p, relation, geometry: g, side };
        this.group.add(o);
      }
      this.pickables.push(front, back);
    }
    for (const [model, g] of this.cache) {
      if (used.has(model)) continue;
      g.front.geometry.dispose();
      g.back.geometry.dispose();
      g.edges.dispose();
      this.cache.delete(model);
    }
    // Picking can happen before the next render updates world matrices.
    this.group.updateMatrixWorld(true);
  }

  /** The placement a raycast hit belongs to, or null when the hit is not on one of these meshes. */
  placementOf(hit: Intersection): PlacementHit | null {
    const data = hit.object.userData as { placement?: Placement; relation?: 'inside' | 'outside'; geometry?: DefinitionGeometry; side?: SideGeometry | null };
    if (!data.placement || !data.relation || !data.geometry || !data.side || hit.faceIndex == null) return null;
    const faceId = data.side.triangleFaces[hit.faceIndex];
    const local = (faceId && data.geometry.normals.get(faceId)) || ([0, 1, 0] as Vec3);
    return { placement: data.placement, relation: data.relation, normal: applyNormal(data.placement.world, local), faceId: faceId ?? null };
  }

  /**
   * Bounding boxes around instances placed in the open context, in their
   * highlight colors, and around `marked` instances anywhere (by path: the
   * parts of a cut list row outside the open context), in the hover color.
   */
  highlight(scene: Scene, context: readonly InstanceId[], instances: ReadonlyMap<InstanceId, EdgeHighlight>, marked: readonly (readonly InstanceId[])[] = []): void {
    if (this.boxes) {
      this.group.remove(this.boxes);
      this.boxes.geometry.dispose();
      this.boxes = null;
    }
    const def = pathDefinition(scene, context);
    if (!def || (!instances.size && !marked.length)) return;
    const base = pathTransform(scene, context);
    const pos: number[] = [];
    const col: number[] = [];
    const box = (world: Affine, definitionId: string, kind: EdgeHighlight) => {
      const b = definitionBounds(scene, definitionId);
      if (!b) return;
      const corner = (x: number, y: number, z: number) => applyPoint(world, [x ? b.max[0] : b.min[0], y ? b.max[1] : b.min[1], z ? b.max[2] : b.min[2]]);
      const c = EDGE_COLORS[kind];
      // The twelve edges of the box: along x, y and z from each corner on the low side.
      for (const [a, d] of BOX_EDGES) {
        pos.push(...corner(a[0], a[1], a[2]), ...corner(d[0], d[1], d[2]));
        col.push(...c, ...c);
      }
    };
    for (const [id, kind] of instances) {
      const i = def.instances.get(id);
      if (i) box(multiply(base, i.transform), i.definitionId, kind);
    }
    for (const path of marked) {
      const d = pathDefinition(scene, path);
      if (d) box(pathTransform(scene, path), d.id, 'hover');
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
