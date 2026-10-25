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
  ShapeUtils,
  Vector2,
  Vector3,
  type Side,
} from 'three';
import { listFaces, planeAxes, renderEdges, type Model, type Point3, type Vec3 } from '../kernel';

export type Highlight = 'normal' | 'hover' | 'selected' | 'erase';

function faceMaterial(color: number, side: Side): MeshLambertMaterial {
  return new MeshLambertMaterial({ color, side, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
}

/** Front and back face colors, as in the prototype. */
const MATERIALS: Record<Highlight, [MeshLambertMaterial, MeshLambertMaterial]> = {
  normal: [faceMaterial(0xf3f2ee, FrontSide), faceMaterial(0x8e9fb2, BackSide)],
  hover: [faceMaterial(0xd5e5f1, FrontSide), faceMaterial(0xa9bed2, BackSide)],
  selected: [faceMaterial(0x8fbde0, FrontSide), faceMaterial(0x6f9dc4, BackSide)],
  erase: [faceMaterial(0xf1c3ba, FrontSide), faceMaterial(0xd29a90, BackSide)],
};
const EDGE_MATERIAL = new LineBasicMaterial({ color: 0x262c31 });

const dot = (a: Point3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** three.js meshes for a model: two meshes per face (front and back color) plus edge lines. */
export class ModelView {
  readonly group = new Group();
  /** Meshes the picker raycasts against; userData.faceId holds the face id. */
  pickables: Mesh[] = [];
  private meshes = new Map<string, [Mesh, Mesh]>();
  private normals = new Map<string, Vector3>();

  build(model: Model): void {
    this.dispose();
    for (const f of listFaces(model)) {
      const [u, v] = planeAxes(f.normal);
      const to2 = (p: Point3) => new Vector2(dot(p, u), dot(p, v));
      const tris = ShapeUtils.triangulateShape(f.outer.map(to2), f.holes.map((h) => h.map(to2)));
      const all = [f.outer, ...f.holes].flat();
      const n = new Vector3(...f.normal);
      const pos: number[] = [];
      for (const [i, j0, k0] of tris) {
        let j = j0!;
        let k = k0!;
        const a = new Vector3(...all[i!]!);
        const b = new Vector3(...all[j]!);
        const c = new Vector3(...all[k]!);
        if (b.sub(a).cross(c.sub(a)).dot(n) < 0) [j, k] = [k, j];
        pos.push(...all[i!]!, ...all[j]!, ...all[k]!);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const front = new Mesh(g, MATERIALS.normal[0]);
      const back = new Mesh(g, MATERIALS.normal[1]);
      front.userData.faceId = back.userData.faceId = f.id;
      this.group.add(front, back);
      this.pickables.push(front, back);
      this.meshes.set(f.id, [front, back]);
      this.normals.set(f.id, n);
    }
    const ep: number[] = [];
    for (const [a, b] of renderEdges(model)) ep.push(...a, ...b);
    const eg = new BufferGeometry();
    eg.setAttribute('position', new Float32BufferAttribute(ep, 3));
    this.group.add(new LineSegments(eg, EDGE_MATERIAL));
  }

  /** Normal of a face in the currently shown model. */
  normalOf(faceId: string): Vector3 | undefined {
    return this.normals.get(faceId)?.clone();
  }

  paint(faceId: string, kind: Highlight): void {
    const pair = this.meshes.get(faceId);
    if (pair) {
      pair[0].material = MATERIALS[kind][0];
      pair[1].material = MATERIALS[kind][1];
    }
  }

  paintAll(kind: Highlight): void {
    for (const id of this.meshes.keys()) this.paint(id, kind);
  }

  private dispose(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      if (c instanceof Mesh || c instanceof LineSegments) c.geometry.dispose();
    }
    this.pickables = [];
    this.meshes.clear();
    this.normals.clear();
  }
}
