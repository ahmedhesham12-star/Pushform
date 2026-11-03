import {
  BackSide,
  BufferGeometry,
  Float32BufferAttribute,
  FrontSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Vector3,
  type Side,
} from 'three';
import { faceMeshes, listEdges, listFaces, type FaceSide, type Model } from '../kernel';
import { BACK_COLOR, FACE_COLOR, faceUVs } from './materials';
import { palette, rgb, themedColor, type Palette } from './palette';

export type Highlight = 'normal' | 'hover' | 'selected' | 'erase';

function faceMaterial(color: number, side: Side): MeshLambertMaterial {
  return new MeshLambertMaterial({ color, side, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
}

/** Both sides of a highlighted face, in the theme's colors. */
const highlighted = (pick: (p: Palette) => readonly [number, number]): [MeshLambertMaterial, MeshLambertMaterial] => [
  themedColor(faceMaterial(0, FrontSide), (p) => pick(p)[0]),
  themedColor(faceMaterial(0, BackSide), (p) => pick(p)[1]),
];

/** Front and back face colors, as in the prototype, and the highlights. */
const MATERIALS: Record<Highlight, [MeshLambertMaterial, MeshLambertMaterial]> = {
  normal: [faceMaterial(FACE_COLOR, FrontSide), faceMaterial(BACK_COLOR, BackSide)],
  hover: highlighted((p) => p.faceHover),
  selected: highlighted((p) => p.faceSelected),
  erase: highlighted((p) => p.faceErase),
};
const EDGE_MATERIAL = themedColor(new LineBasicMaterial(), (p) => p.edge);

/** Both sides in one color (Color by Tag), made once per color. */
const colored = new Map<number, [MeshLambertMaterial, MeshLambertMaterial]>();
export function colorMaterials(color: number): [MeshLambertMaterial, MeshLambertMaterial] {
  let pair = colored.get(color);
  if (!pair) colored.set(color, (pair = [faceMaterial(color, FrontSide), faceMaterial(color, BackSide)]));
  return pair;
}

/** How a face side looks when not highlighted: its material, or its tag color with Color by Tag. */
export type FaceLook = (faceId: string, side: FaceSide) => MeshLambertMaterial;
const PLAIN: FaceLook = (_f, side) => MATERIALS.normal[side === 'front' ? 0 : 1];

export type EdgeHighlight = 'hover' | 'selected' | 'erase';
/** A highlight's color in the theme in use, as vertex colors (shown as given: color management is off). */
export const edgeColor = (kind: EdgeHighlight): [number, number, number] => rgb(palette()[kind]);
const HIGHLIGHT_EDGE_MATERIAL = new LineBasicMaterial({ vertexColors: true });

/**
 * three.js meshes for the model of the open editing context: two meshes per
 * face (front and back color, so faces highlight one by one) plus lines for
 * the visible edges. Triangles and smooth normals across soft edges come from
 * the kernel; soft edges are not drawn. Coordinates are local; the group
 * carries the context's world transform.
 */
export class ModelView {
  readonly group = new Group();
  /** Meshes the picker raycasts against; userData.faceId holds the face id. */
  pickables: Mesh[] = [];
  /** Visible (non-soft) edges in local coordinates, for highlighting. */
  private edges: { id: string; a: Vector3; b: Vector3 }[] = [];
  private meshes = new Map<string, [Mesh, Mesh]>();
  private normals = new Map<string, Vector3>();
  private overlay: LineSegments | null = null;
  /** How each face looks when not highlighted, front and back. */
  private normal = new Map<string, [MeshLambertMaterial, MeshLambertMaterial]>();

  /** Build the meshes; `look` gives each face side its material (the usual colors by default). */
  build(model: Model, world: Matrix4, look: FaceLook = PLAIN): void {
    this.dispose();
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(world);
    for (const e of listEdges(model)) if (!e.soft) this.edges.push({ id: e.id, a: new Vector3(...e.a), b: new Vector3(...e.b) });
    for (const f of listFaces(model)) this.normals.set(f.id, new Vector3(...f.normal));
    for (const m of faceMeshes(model)) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(m.positions, 3));
      g.setAttribute('normal', new Float32BufferAttribute(m.normals, 3));
      g.setAttribute('uv', new Float32BufferAttribute(faceUVs(model, m), 2));
      const [frontMaterial, backMaterial] = [look(m.faceId, 'front'), look(m.faceId, 'back')];
      this.normal.set(m.faceId, [frontMaterial, backMaterial]);
      const front = new Mesh(g, frontMaterial);
      const back = new Mesh(g, backMaterial);
      front.userData.faceId = back.userData.faceId = m.faceId;
      this.group.add(front, back);
      this.pickables.push(front, back);
      this.meshes.set(m.faceId, [front, back]);
    }
    const ep: number[] = [];
    for (const e of this.edges) ep.push(e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z);
    const eg = new BufferGeometry();
    eg.setAttribute('position', new Float32BufferAttribute(ep, 3));
    this.group.add(new LineSegments(eg, EDGE_MATERIAL));
    // Picking can happen before the next render updates world matrices.
    this.group.updateMatrixWorld(true);
  }

  /** Normal of a face in the currently shown model, in local coordinates. */
  normalOf(faceId: string): Vector3 | undefined {
    return this.normals.get(faceId)?.clone();
  }

  paint(faceId: string, kind: Highlight): void {
    const pair = this.meshes.get(faceId);
    if (pair) [pair[0].material, pair[1].material] = kind === 'normal' ? (this.normal.get(faceId) ?? MATERIALS.normal) : MATERIALS[kind];
  }

  paintAll(kind: Highlight): void {
    for (const id of this.meshes.keys()) this.paint(id, kind);
  }

  /** Draw the given edges over the normal edge lines in their highlight colors. */
  highlightEdges(edges: ReadonlyMap<string, EdgeHighlight>): void {
    if (this.overlay) {
      this.group.remove(this.overlay);
      this.overlay.geometry.dispose();
      this.overlay = null;
    }
    if (!edges.size) return;
    const pos: number[] = [];
    const col: number[] = [];
    for (const e of this.edges) {
      const kind = edges.get(e.id);
      if (!kind) continue;
      const c = edgeColor(kind);
      pos.push(e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z);
      col.push(...c, ...c);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    this.overlay = new LineSegments(g, HIGHLIGHT_EDGE_MATERIAL);
    this.overlay.renderOrder = 1;
    this.group.add(this.overlay);
  }

  private dispose(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      if (c instanceof Mesh || c instanceof LineSegments) c.geometry.dispose();
    }
    this.pickables = [];
    this.edges = [];
    this.overlay = null;
    this.meshes.clear();
    this.normal.clear();
    this.normals.clear();
  }
}
