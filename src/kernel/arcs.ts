/**
 * Arcs and pies (milestone 4). An arc is one curve of straight segments
 * around a center, drawn through the planar engine like a circle: it splits
 * the edges and faces it crosses, and closes regions with existing edges. A
 * pie adds the two radii, so it is a face on its own.
 */
import { MIN_RECT_SIDE, snapPoint } from './precision';
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from './vec';
import { onPlane } from './geometry';
import { drawingPlane, drawSegments, MAX_SEGMENTS, type DrawResult } from './shapes';
import type { FaceId, Point3, Topology } from './types';

export interface ArcSpec {
  faceId: FaceId | null;
  /** With no face: the normal of the plane through the center (the ground when omitted). */
  normal?: Vec3 | null | undefined;
  center: Point3;
  /** Where the arc starts; its distance from the center is the radius. */
  start: Point3;
  /** The angle it turns through, in radians, counter-clockwise about the plane's normal; less than a full turn. */
  sweep: number;
  segments: number;
  /** Also draw the two radii, closing a pie. */
  pie?: boolean | undefined;
}

/** The points of an arc, from start to end (segments + 1 of them). */
export function arcPoints(n: Vec3, center: Point3, start: Point3, sweep: number, segments: number): Point3[] {
  const r = sub(start, center);
  const u = sub(r, scale(n, dot(r, n)));
  const v = cross(n, u);
  return Array.from({ length: segments + 1 }, (_, i) => {
    if (i === 0) return snapPoint(add(center, u));
    const a = (sweep * i) / segments;
    return snapPoint(add(center, add(scale(u, Math.cos(a)), scale(v, Math.sin(a)))));
  });
}

/** Where an arc is at a fraction of its sweep (0 its start, 1 its end), unrounded. */
function pointAt(n: Vec3, center: Point3, start: Point3, sweep: number, f: number): Point3 {
  const u = sub(start, center);
  return add(center, add(scale(u, Math.cos(sweep * f)), scale(cross(n, u), Math.sin(sweep * f))));
}

export interface ArcGeometry {
  center: Point3;
  radius: number;
  /** Radians, counter-clockwise about the normal. */
  sweep: number;
}

/**
 * The arc from start to end in the plane with normal n that bulges `bulge`
 * from the middle of the chord, to the left of start-to-end seen against n
 * when positive. A bulge more than half the chord gives the larger arc. With
 * `radius`, the arc has that radius instead and the bulge only says which side
 * and which of the two arcs. Null when the chord or bulge is zero, or the
 * radius is shorter than half the chord.
 */
export function twoPointArc(n: Vec3, start: Point3, end: Point3, bulge: number, radius?: number): ArcGeometry | null {
  const chord = sub(end, start);
  const c = length(chord);
  if (c < 1e-9 || !bulge) return null;
  const w = normalize(cross(n, scale(chord, 1 / c)));
  const half = c / 2;
  let s = bulge;
  if (radius !== undefined) {
    if (radius < half - 1e-9) return null;
    const h = Math.sqrt(Math.max(0, radius * radius - half * half));
    s = Math.sign(bulge) * (Math.abs(bulge) > half ? radius + h : radius - h);
  }
  const r = (half * half + s * s) / (2 * Math.abs(s));
  const apex = add(scale(add(start, end), 0.5), scale(w, s));
  const center = sub(apex, scale(w, Math.sign(s) * r));
  const minor = 2 * Math.asin(Math.min(1, half / r));
  const magnitude = Math.abs(s) > r ? 2 * Math.PI - minor : minor;
  // The way round that passes through the apex.
  const off = (sweep: number) => length(sub(pointAt(n, center, start, sweep, 0.5), apex));
  const sweep = off(magnitude) <= off(-magnitude) ? magnitude : -magnitude;
  return { center, radius: r, sweep };
}

/**
 * The arc from a through b to c: its normal (the plane of the three points,
 * so the arc turns counter-clockwise about it), center, radius and sweep. Null
 * when the points are in a line.
 */
export function threePointArc(a: Point3, b: Point3, c: Point3): (ArcGeometry & { normal: Vec3 }) | null {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const nn = cross(ab, ac);
  const n2 = dot(nn, nn);
  if (n2 < 1e-12 * dot(ab, ab) * dot(ac, ac)) return null;
  const off = scale(add(scale(cross(nn, ab), dot(ac, ac)), scale(cross(ac, nn), dot(ab, ab))), 1 / (2 * n2));
  const center = add(a, off);
  const normal = normalize(nn);
  const angle = (p: Point3) => {
    const u = sub(a, center);
    const x = sub(p, center);
    const t = Math.atan2(dot(cross(u, x), normal), dot(u, x));
    return t < 0 ? t + 2 * Math.PI : t;
  };
  // b lies between a and c going counter-clockwise about the normal of a, b, c.
  return { center, normal, radius: length(off), sweep: angle(c) || 2 * Math.PI };
}

/**
 * Draw an arc (or a pie) as one curve on the ground or on a face. Refused when
 * it turns through no angle or a full turn, has too few or too many segments,
 * or its segments are too short.
 */
export function drawArc(t: Topology, spec: ArcSpec): DrawResult {
  const sweep = spec.sweep;
  if (!Number.isInteger(spec.segments) || spec.segments < 2 || spec.segments > MAX_SEGMENTS) return { ok: false, error: 'tooSmall' };
  if (!(Math.abs(sweep) > 1e-9) || Math.abs(sweep) >= 2 * Math.PI - 1e-9) return { ok: false, error: 'tooSmall' };
  const target = drawingPlane(t, spec.faceId, spec.center, spec.normal);
  if (!target) return { ok: false, error: 'noSuchFace' };
  if (!onPlane(target.plane, spec.center, 0.1) || !onPlane(target.plane, spec.start, 0.1)) return { ok: false, error: 'notOnPlane' };
  const radius = length(sub(spec.start, spec.center));
  if (2 * radius * Math.sin(Math.abs(sweep) / spec.segments / 2) < MIN_RECT_SIDE / 5) return { ok: false, error: 'tooSmall' };
  const pts = arcPoints(target.normal, spec.center, spec.start, sweep, spec.segments);
  const segments = pts.slice(1).map((b, i) => ({ a: pts[i]!, b, curve: true }));
  const center = snapPoint(spec.center);
  if (spec.pie) segments.push({ a: pts.at(-1)!, b: center, curve: false }, { a: center, b: pts[0]!, curve: false });
  const curve = { kind: 'arc' as const, segments: spec.segments, center, normal: target.normal, radius };
  return { ok: true, ...drawSegments(t, target.plane, target.normal, segments, curve) };
}
