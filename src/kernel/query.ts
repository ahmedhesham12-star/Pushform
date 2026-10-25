import { edgeMap, key, type ModelData, type Point3 } from './model';
import { dot, length, midpoint, newell, type Vec3 } from './vec';

export interface FaceView {
  readonly id: string;
  readonly outer: readonly Point3[];
  readonly holes: readonly (readonly Point3[])[];
  readonly normal: Vec3;
}

export type SnapKind = 'end' | 'mid';

export interface SnapPoint {
  readonly point: Point3;
  readonly kind: SnapKind;
}

export interface Bounds {
  readonly min: Point3;
  readonly max: Point3;
}

export function listFaces(m: ModelData): FaceView[] {
  return Object.entries(m.faces).map(([id, f]) => ({ id, outer: f.outer, holes: f.holes, normal: f.normal }));
}

export function getFace(m: ModelData, id: string): FaceView | undefined {
  const f = m.faces[id];
  return f && { id, outer: f.outer, holes: f.holes, normal: f.normal };
}

export function faceCount(m: ModelData): number {
  return Object.keys(m.faces).length;
}

/** Face area in mm², holes subtracted. */
export function faceArea(m: ModelData, id: string): number {
  const f = m.faces[id];
  if (!f) return 0;
  let s = length(newell(f.outer)) / 2;
  for (const h of f.holes) s -= length(newell(h)) / 2;
  return s;
}

/**
 * Edges to draw, each once. The seam between two coplanar side walls (left by
 * pushing the same face twice) is hidden, as in the prototype.
 */
export function renderEdges(m: ModelData): [Point3, Point3][] {
  const out: [Point3, Point3][] = [];
  for (const list of edgeMap(m).values()) {
    if (list.length === 2) {
      const f1 = m.faces[list[0]!.id]!;
      const f2 = m.faces[list[1]!.id]!;
      if (f1.side && f2.side && dot(f1.normal, f2.normal) > 0.999) continue;
    }
    out.push([list[0]!.a, list[0]!.b]);
  }
  return out;
}

/** Endpoints (deduplicated) and midpoints of the drawn edges. */
export function snapPoints(m: ModelData): SnapPoint[] {
  const seen = new Set<string>();
  const out: SnapPoint[] = [];
  for (const [a, b] of renderEdges(m)) {
    for (const p of [a, b]) {
      const k = key(p);
      if (!seen.has(k)) {
        seen.add(k);
        out.push({ point: p, kind: 'end' });
      }
    }
    out.push({ point: midpoint(a, b), kind: 'mid' });
  }
  return out;
}

/** Bounding box of all face outlines, or null for an empty model. */
export function bounds(m: ModelData): Bounds | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const f of Object.values(m.faces)) {
    for (const p of f.outer) {
      any = true;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, p[i]!);
        max[i] = Math.max(max[i]!, p[i]!);
      }
    }
  }
  return any ? { min: min as unknown as Point3, max: max as unknown as Point3 } : null;
}
