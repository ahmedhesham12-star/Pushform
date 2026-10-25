import earcut from 'earcut';
import { cross, dot, normalize, sub, type Vec3 } from './vec';
import { planeBasis, to2 } from './geometry';
import type { FaceId, Point3, Topology, VertexId } from './types';

export type Triangle = readonly [Point3, Point3, Point3];
export type TriangleIds = readonly [VertexId, VertexId, VertexId];

/**
 * Triangles covering a face (holes excluded), as vertex ids, each wound
 * counter-clockwise around the face normal.
 */
export function faceTriangleIds(t: Topology, id: FaceId): TriangleIds[] {
  const f = t.faces.get(id);
  if (!f) return [];
  const ids = [f.outer, ...f.holes].flat();
  const pts = ids.map((v) => t.vertices.get(v)!.p);
  const b = planeBasis(f.normal);
  const flat: number[] = [];
  for (const p of pts) flat.push(...to2(b, p));
  const holeStarts: number[] = [];
  let n = f.outer.length;
  for (const h of f.holes) {
    holeStarts.push(n);
    n += h.length;
  }
  const idx = earcut(flat, holeStarts, 2);
  const out: TriangleIds[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]!;
    let bb = idx[i + 1]!;
    let c = idx[i + 2]!;
    if (dot(cross(sub(pts[bb]!, pts[a]!), sub(pts[c]!, pts[a]!)), f.normal) < 0) [bb, c] = [c, bb];
    out.push([ids[a]!, ids[bb]!, ids[c]!]);
  }
  return out;
}

/** Triangles covering a face, as points. Used for picking samples and export. */
export function faceTriangles(t: Topology, id: FaceId): Triangle[] {
  const P = (v: VertexId) => t.vertices.get(v)!.p;
  return faceTriangleIds(t, id).map(([a, b, c]) => [P(a), P(b), P(c)] as const);
}

export interface FaceMesh {
  readonly faceId: FaceId;
  /** x, y, z per triangle corner. */
  readonly positions: number[];
  /** Per-corner normals: the face normal, or averaged across soft edges. */
  readonly normals: number[];
}

/**
 * Render-ready triangles for every face. Faces joined through soft edges share
 * averaged normals at their common vertices, so they shade smoothly.
 */
export function faceMeshes(t: Topology): FaceMesh[] {
  const key = (a: VertexId, b: VertexId) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const soft = new Set<string>();
  for (const e of t.edges.values()) if (e.soft) soft.add(key(e.v[0], e.v[1]));

  // For each vertex, the faces around it and the soft edges joining them there.
  const around = new Map<VertexId, { face: FaceId; prev: VertexId; next: VertexId }[]>();
  for (const [id, f] of t.faces) {
    for (const loop of [f.outer, ...f.holes]) {
      loop.forEach((v, i) => {
        let list = around.get(v);
        if (!list) around.set(v, (list = []));
        list.push({ face: id, prev: loop[(i - 1 + loop.length) % loop.length]!, next: loop[(i + 1) % loop.length]! });
      });
    }
  }
  const smooth = new Map<string, Vec3>();
  const normalAt = (face: FaceId, v: VertexId): Vec3 => {
    const own = t.faces.get(face)!.normal;
    const list = around.get(v);
    if (!list || !soft.size) return own;
    const cached = smooth.get(`${face}@${v}`);
    if (cached) return cached;
    // Faces connected to `face` at v through soft edges incident to v.
    const group = new Set([face]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const a of list) {
        if (!group.has(a.face)) continue;
        for (const b of list) {
          if (group.has(b.face)) continue;
          const shared = [a.prev, a.next].filter((x) => x === b.prev || x === b.next);
          if (shared.some((x) => soft.has(key(v, x)))) {
            group.add(b.face);
            grew = true;
          }
        }
      }
    }
    let sum: Vec3 = [0, 0, 0];
    for (const g of group) {
      const n = t.faces.get(g)!.normal;
      sum = [sum[0] + n[0], sum[1] + n[1], sum[2] + n[2]];
    }
    const n = normalize(sum);
    for (const g of group) smooth.set(`${g}@${v}`, n);
    return n;
  };

  const out: FaceMesh[] = [];
  for (const id of t.faces.keys()) {
    const positions: number[] = [];
    const normals: number[] = [];
    for (const tri of faceTriangleIds(t, id)) {
      for (const v of tri) {
        positions.push(...t.vertices.get(v)!.p);
        normals.push(...normalAt(id, v));
      }
    }
    out.push({ faceId: id, positions, normals });
  }
  return out;
}
