import type { Vec3 } from './vec';

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

export function snapPoint(p: Vec3): Vec3 {
  return [snapLength(p[0]), snapLength(p[1]), snapLength(p[2])];
}

/** Points closer than this (mm) are the same vertex; points this close to an edge or plane lie on it. */
export const VERTEX_TOLERANCE = 1e-3;
/** Distances below this many mm are treated as zero. */
export const EPSILON = 1e-3;
/** Gap kept when push/pull is clamped against a neighbouring face, in mm. */
export const CLAMP_MARGIN = 1;
/** Smallest rectangle side, in mm. */
export const MIN_RECT_SIDE = 5;
