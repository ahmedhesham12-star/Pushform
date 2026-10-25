import { length, newell } from '../vec';
import type { FaceId, Point3, Topology } from './types';

export interface FacePoints {
  readonly outer: Point3[];
  readonly holes: Point3[][];
}

export function facePoints(t: Topology, id: FaceId): FacePoints | undefined {
  const f = t.faces.get(id);
  if (!f) return undefined;
  const P = (v: string) => t.vertices.get(v)!.p;
  return { outer: f.outer.map(P), holes: f.holes.map((h) => h.map(P)) };
}

/** Face area in mm², holes subtracted. */
export function faceArea(t: Topology, id: FaceId): number {
  const pts = facePoints(t, id);
  if (!pts) return 0;
  let s = length(newell(pts.outer)) / 2;
  for (const h of pts.holes) s -= length(newell(h)) / 2;
  return s;
}
