import { Matrix4, Ray, Vector3, type Intersection, type Mesh, type Raycaster } from 'three';

/** Triangles per leaf. */
const LEAF = 8;

/**
 * A bounding volume tree over a reference mesh's triangles (milestone 6), so
 * picking a large mesh tests the few triangles near the ray instead of all
 * of them: a million triangles took a quarter of a second per pointer move.
 * Nodes split their triangles at the middle of their longest side.
 */
export class MeshBvh {
  /** Per node: min x, y, z, max x, y, z. */
  private readonly boxes: Float32Array;
  /** Per node: the first triangle (in `order`) and the count for a leaf; for an inner node, -1 and its second child (the first follows it). */
  private readonly nodes: Int32Array;
  private readonly order: Uint32Array;

  /** `positions`: nine coordinates per triangle, as the geometry draws them. */
  constructor(private readonly positions: Float32Array) {
    const count = positions.length / 9;
    const order = new Uint32Array(count);
    const centers = new Float32Array(count * 3);
    for (let t = 0; t < count; t++) {
      order[t] = t;
      for (let k = 0; k < 3; k++) centers[3 * t + k] = (positions[9 * t + k]! + positions[9 * t + 3 + k]! + positions[9 * t + 6 + k]!) / 3;
    }
    const boxes: number[] = [];
    const nodes: number[] = [];
    const build = (start: number, end: number, depth: number): number => {
      const node = nodes.length / 2;
      nodes.push(0, 0);
      const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      const mid = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = start; i < end; i++) {
        const t = order[i]!;
        for (let k = 0; k < 3; k++) {
          for (let c = 0; c < 3; c++) {
            const v = positions[9 * t + 3 * c + k]!;
            if (v < box[k]!) box[k] = v;
            if (v > box[k + 3]!) box[k + 3] = v;
          }
          const m = centers[3 * t + k]!;
          if (m < mid[k]!) mid[k] = m;
          if (m > mid[k + 3]!) mid[k + 3] = m;
        }
      }
      boxes.push(...box);
      const extent = [mid[3]! - mid[0]!, mid[4]! - mid[1]!, mid[5]! - mid[2]!];
      const axis = extent[0]! >= extent[1]! && extent[0]! >= extent[2]! ? 0 : extent[1]! >= extent[2]! ? 1 : 2;
      if (end - start <= LEAF || extent[axis]! <= 0) {
        nodes[2 * node] = start;
        nodes[2 * node + 1] = end - start;
        return node;
      }
      // Partition around the middle of the centers' extent along the axis.
      const split = mid[axis]! + extent[axis]! / 2;
      let i = start;
      let j = end - 1;
      while (i <= j) {
        if (centers[3 * order[i]! + axis]! < split) i++;
        else {
          const swap = order[i]!;
          order[i] = order[j]!;
          order[j--] = swap;
        }
      }
      // Halving when the middle splits nothing off, or the tree grows deep (very uneven triangles), bounds its depth.
      if (i === start || i === end || depth > 40) i = (start + end) >> 1;
      build(start, i, depth + 1);
      const second = build(i, end, depth + 1);
      nodes[2 * node] = -1;
      nodes[2 * node + 1] = second;
      return node;
    };
    build(0, count, 0);
    this.boxes = new Float32Array(boxes);
    this.nodes = new Int32Array(nodes);
    this.order = order;
  }

  /** three.js's raycast for a mesh drawn from these triangles: every hit along the ray, either side. */
  raycast(mesh: Mesh, raycaster: Raycaster, intersects: Intersection[]): void {
    const inverse = new Matrix4().copy(mesh.matrixWorld).invert();
    const ray = new Ray().copy(raycaster.ray).applyMatrix4(inverse);
    const o = ray.origin;
    const d = ray.direction;
    const inv = [1 / d.x, 1 / d.y, 1 / d.z];
    const p = this.positions;
    const stack = [0];
    const edge1 = new Vector3();
    const edge2 = new Vector3();
    const h = new Vector3();
    const s = new Vector3();
    const q = new Vector3();
    const a = new Vector3();
    while (stack.length) {
      const node = stack.pop()!;
      if (!this.hitsBox(node, o, inv)) continue;
      const first = this.nodes[2 * node]!;
      if (first === -1) {
        stack.push(node + 1, this.nodes[2 * node + 1]!);
        continue;
      }
      for (let i = first; i < first + this.nodes[2 * node + 1]!; i++) {
        const t = this.order[i]!;
        // Moller-Trumbore, both sides.
        a.fromArray(p, 9 * t);
        edge1.fromArray(p, 9 * t + 3).sub(a);
        edge2.fromArray(p, 9 * t + 6).sub(a);
        h.crossVectors(d, edge2);
        const det = edge1.dot(h);
        if (Math.abs(det) < 1e-12) continue;
        s.subVectors(o, a);
        const u = s.dot(h) / det;
        if (u < 0 || u > 1) continue;
        q.crossVectors(s, edge1);
        const v = d.dot(q) / det;
        if (v < 0 || u + v > 1) continue;
        const along = edge2.dot(q) / det;
        if (along < 0) continue;
        const point = d.clone().multiplyScalar(along).add(o).applyMatrix4(mesh.matrixWorld);
        const distance = raycaster.ray.origin.distanceTo(point);
        if (distance < raycaster.near || distance > raycaster.far) continue;
        const normal = new Vector3().crossVectors(edge1, edge2).normalize();
        intersects.push({ distance, point, object: mesh, faceIndex: t, face: { a: 3 * t, b: 3 * t + 1, c: 3 * t + 2, normal, materialIndex: 0 } });
      }
    }
  }

  /** Whether the ray (origin, 1 / direction) meets a node's box ahead of it. */
  private hitsBox(node: number, o: Vector3, inv: number[]): boolean {
    const b = this.boxes;
    let near = 0;
    let far = Infinity;
    const origin = [o.x, o.y, o.z];
    for (let k = 0; k < 3; k++) {
      let t1 = (b[6 * node + k]! - origin[k]!) * inv[k]!;
      let t2 = (b[6 * node + 3 + k]! - origin[k]!) * inv[k]!;
      if (Number.isNaN(t1) || Number.isNaN(t2)) continue;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > near) near = t1;
      if (t2 < far) far = t2;
      if (near > far) return false;
    }
    return true;
  }
}
