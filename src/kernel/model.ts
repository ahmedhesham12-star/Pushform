/**
 * Face/loop model, ported from the Blockout prototype. Every face owns its own
 * vertex copies; faces are related only by shared vertex positions (see key()).
 * Milestone 2 replaces this with a half-edge structure behind the same public
 * API in index.ts.
 *
 * All lengths are millimeters. Models are immutable: operations return a new
 * model and share untouched faces with the old one, which keeps undo snapshots
 * cheap.
 */
import { dot, newell, normalize, type Vec3 } from './vec';

export type Point3 = Vec3;

export interface FaceData {
  /** Counter-clockwise around the normal. */
  readonly outer: readonly Point3[];
  /** Clockwise around the normal. */
  readonly holes: readonly (readonly Point3[])[];
  /** Unit normal; the front side. */
  readonly normal: Vec3;
  /** True for walls created by push/pull; used to hide seams between coplanar walls. */
  readonly side: boolean;
}

export interface ModelData {
  readonly faces: Readonly<Record<string, FaceData>>;
  readonly next: number;
}

/** Vertex positions closer than this many mm are treated as the same vertex. */
export const KEY_PRECISION = 1e-3;
/** Distances below this many mm are treated as zero. */
export const EPSILON = 1e-3;
/** Gap kept when push/pull is clamped against a neighbouring face, in mm. */
export const CLAMP_MARGIN = 1;
/** Margin a rectangle must keep from the edge of the face it is drawn on, in mm. */
export const INSET_MARGIN = 0.1;
/** Smallest rectangle side, in mm. */
export const MIN_RECT_SIDE = 5;

/** Stored coordinates and lengths are rounded to this many mm. */
export const COORDINATE_PRECISION = 1e-6;
const COORDINATE_SCALE = 1 / COORDINATE_PRECISION;

/**
 * Round a length or coordinate to COORDINATE_PRECISION. Dividing the rounded
 * integer gives the double closest to the decimal value, so 24" (computed as
 * 609.5999999999999) is stored as 609.6, and sums like 304.8 + 609.6 do not
 * drift to 914.4000000000001.
 */
export function snapLength(v: number): number {
  return Math.round(v * COORDINATE_SCALE) / COORDINATE_SCALE + 0;
}

export function snapPoint(p: Point3): Point3 {
  return [snapLength(p[0]), snapLength(p[1]), snapLength(p[2])];
}

const KEY_DIGITS = Math.round(-Math.log10(KEY_PRECISION));

export function key(p: Point3): string {
  return p.map((v) => (Math.round(v / KEY_PRECISION) * KEY_PRECISION).toFixed(KEY_DIGITS)).join(',');
}

export function edgeKey(a: Point3, b: Point3): string {
  const ka = key(a);
  const kb = key(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** Return the loop wound counter-clockwise (ccw) or clockwise around n. */
export function orient(loop: readonly Point3[], n: Vec3, ccw: boolean): Point3[] {
  const d = dot(newell(loop), n);
  return (ccw ? d < 0 : d > 0) ? loop.slice().reverse() : loop.slice();
}

export function emptyModel(): ModelData {
  return { faces: {}, next: 1 };
}

/** Mutable working copy used inside one operation. Faces are replaced, never edited. */
export interface Draft {
  faces: Record<string, FaceData>;
  next: number;
}

export function draft(m: ModelData): Draft {
  return { faces: { ...m.faces }, next: m.next };
}

export function addFace(
  m: Draft,
  outer: readonly Point3[],
  normal: Vec3,
  holes: readonly (readonly Point3[])[] = [],
  side = false,
): string {
  const n = normalize(normal);
  const id = `f${m.next++}`;
  m.faces[id] = { outer: orient(outer, n, true), holes: holes.map((h) => orient(h, n, false)), normal: n, side };
  return id;
}

export interface EdgeUse {
  id: string;
  a: Point3;
  b: Point3;
  hole: boolean;
}

/** Every loop edge keyed by its undirected endpoint positions. */
export function edgeMap(m: ModelData | Draft): Map<string, EdgeUse[]> {
  const map = new Map<string, EdgeUse[]>();
  for (const [id, f] of Object.entries(m.faces)) {
    [f.outer, ...f.holes].forEach((loop, li) => {
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const k = edgeKey(a, b);
        let list = map.get(k);
        if (!list) map.set(k, (list = []));
        list.push({ id, a, b, hole: li > 0 });
      }
    });
  }
  return map;
}
