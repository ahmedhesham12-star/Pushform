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
  Vector3,
  type Side,
} from 'three';
import { faceMeshes, listEdges, listFaces, type Model } from '../kernel';

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

/**
 * three.js meshes for a model: two meshes per face (front and back color) plus
 * lines for the visible edges. Triangles and smooth normals across soft edges
 * come from the kernel; soft edges are not drawn.
 */
export class ModelView {
  readonly group = new Group();
  /** Meshes the picker raycasts against; userData.faceId holds the face id. */
  pickables: Mesh[] = [];
  private meshes = new Map<string, [Mesh, Mesh]>();
  private normals = new Map<string, Vector3>();

  build(model: Model): void {
    this.dispose();
    for (const f of listFaces(model)) this.normals.set(f.id, new Vector3(...f.normal));
    for (const m of faceMeshes(model)) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(m.positions, 3));
      g.setAttribute('normal', new Float32BufferAttribute(m.normals, 3));
      const front = new Mesh(g, MATERIALS.normal[0]);
      const back = new Mesh(g, MATERIALS.normal[1]);
      front.userData.faceId = back.userData.faceId = m.faceId;
      this.group.add(front, back);
      this.pickables.push(front, back);
      this.meshes.set(m.faceId, [front, back]);
    }
    const ep: number[] = [];
    for (const e of listEdges(model)) if (!e.soft) ep.push(...e.a, ...e.b);
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
