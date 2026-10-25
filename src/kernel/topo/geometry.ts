import { VERTEX_TOLERANCE } from '../precision';
import { cross, dot, length, newell, normalize, planeAxes, scale, sub, type Vec3 } from '../vec';
import type { Point3 } from './types';

export type Vec2 = readonly [number, number];

/** Normals closer than this (1 - cos of the angle) count as parallel. */
const PARALLEL = 1e-9;

export interface Plane {
  readonly n: Vec3;
  /** n . p for points p on the plane. */
  readonly d: number;
}

export const planeThrough = (n: Vec3, p: Point3): Plane => ({ n, d: dot(n, p) });
export const distanceToPlane = (pl: Plane, p: Point3): number => dot(pl.n, p) - pl.d;
export const onPlane = (pl: Plane, p: Point3, tol = VERTEX_TOLERANCE): boolean => Math.abs(distanceToPlane(pl, p)) <= tol;

export function parallel(a: Vec3, b: Vec3): boolean {
  return Math.abs(dot(a, b)) >= 1 - PARALLEL;
}

/** Same plane regardless of orientation. */
export function samePlane(a: Plane, b: Plane): boolean {
  if (!parallel(a.n, b.n)) return false;
  const s = Math.sign(dot(a.n, b.n));
  return Math.abs(a.d - s * b.d) <= VERTEX_TOLERANCE;
}

/** Unit normal of a polygon from Newell's method, or null when it is degenerate. */
export function polygonNormal(pts: readonly Point3[]): Vec3 | null {
  const n = newell(pts);
  return length(n) < 1e-12 ? null : normalize(n);
}

export interface Basis {
  readonly u: Vec3;
  readonly v: Vec3;
  readonly n: Vec3;
}

/**
 * Orthonormal in-plane axes for a normal, with (u, v, n) right-handed, so
 * counter-clockwise around n is counter-clockwise in (u, v). For the ground
 * (normal +Y) u is +X.
 */
export function planeBasis(n: Vec3): Basis {
  const [a] = planeAxes(n);
  const u = normalize(sub(a, scale(n, dot(a, n))));
  return { u, v: cross(n, u), n };
}

export const to2 = (b: Basis, p: Point3): Vec2 => [dot(p, b.u), dot(p, b.v)];

/* ---------- 2D ---------- */

export function signedArea(pts: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Point strictly inside a polygon (even-odd rule). Points on the boundary give either answer. */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Distance from p to segment ab, and the parameter of the closest point. */
export function pointSegment(p: Vec2, a: Vec2, b: Vec2): { distance: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return { distance: Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]), t };
}

/**
 * Proper crossing of segments ab and cd: one point strictly inside both.
 * Touching at endpoints and collinear overlaps are reported as null; callers
 * handle those through vertex-on-segment tests.
 */
export function segmentCrossing(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { t: number; s: number } | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  const lenR = Math.hypot(rx, ry);
  const lenS = Math.hypot(sx, sy);
  if (Math.abs(denom) <= 1e-12 * lenR * lenS) return null;
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / denom;
  const s = (qx * ry - qy * rx) / denom;
  // Keep clear of the endpoints by the vertex tolerance, measured along each segment.
  const et = VERTEX_TOLERANCE / lenR;
  const es = VERTEX_TOLERANCE / lenS;
  if (t <= et || t >= 1 - et || s <= es || s >= 1 - es) return null;
  return { t, s };
}
