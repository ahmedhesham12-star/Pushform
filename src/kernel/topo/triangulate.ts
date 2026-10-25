import earcut from 'earcut';
import { cross, dot, sub } from '../vec';
import { planeBasis, to2 } from './geometry';
import type { FaceId, Point3, Topology } from './types';

export type Triangle = readonly [Point3, Point3, Point3];

/**
 * Triangles covering a face (holes excluded), each wound counter-clockwise
 * around the face normal. Used for rendering, picking samples and export.
 */
export function faceTriangles(t: Topology, id: FaceId): Triangle[] {
  const f = t.faces.get(id);
  if (!f) return [];
  const pts = [f.outer, ...f.holes].flat().map((v) => t.vertices.get(v)!.p);
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
  const out: Triangle[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = pts[idx[i]!]!;
    let bb = pts[idx[i + 1]!]!;
    let c = pts[idx[i + 2]!]!;
    if (dot(cross(sub(bb, a), sub(c, a)), f.normal) < 0) [bb, c] = [c, bb];
    out.push([a, bb, c]);
  }
  return out;
}
