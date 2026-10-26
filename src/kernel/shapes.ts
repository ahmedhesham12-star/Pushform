import { MIN_RECT_SIDE, snapPoint } from './precision';
import { add, cross, dot, length, normalize, planeAxes, scale, sub, type Vec3 } from './vec';
import { Draft } from './draft';
import { onPlane, planeBasis, planeThrough, samePlane, type Plane } from './geometry';
import { insertSegment, rebuildPlane } from './planar';
import type { Curve, EdgeId, FaceId, Point3, Topology } from './types';

export const GROUND: Plane = { n: [0, 1, 0], d: 0 };
export const GROUND_NORMAL: Vec3 = [0, 1, 0];

export type DrawError = 'noSuchFace' | 'tooSmall' | 'notOnPlane';
export type DrawResult =
  | { ok: true; topology: Topology; faceIds: FaceId[]; edgeIds: EdgeId[] }
  | { ok: false; error: DrawError };

/** Where a shape is drawn: the ground, or the plane of an existing face. */
export function drawingPlane(t: Topology, faceId: FaceId | null): { plane: Plane; normal: Vec3 } | null {
  if (faceId === null) return { plane: GROUND, normal: GROUND_NORMAL };
  const f = t.faces.get(faceId);
  if (!f) return null;
  return { plane: planeThrough(f.normal, t.vertices.get(f.outer[0]!)!.p), normal: f.normal };
}

/**
 * Draw a closed loop of points in a plane. Edges are split where they meet
 * existing geometry, faces in the plane are split, and newly enclosed regions
 * become faces with normal `normal`. Returns the ids of the faces created.
 */
export function drawLoop(
  t: Topology,
  plane: Plane,
  normal: Vec3,
  points: readonly Point3[],
  curve: Omit<Curve, 'edges'> | null = null,
): { topology: Topology; faceIds: FaceId[]; edgeIds: EdgeId[] } {
  const d = new Draft(t);
  const curveId = curve ? d.addCurve(curve) : null;
  const drawn = new Set<EdgeId>();
  points.forEach((p, i) => {
    for (const e of insertSegment(d, plane, p, points[(i + 1) % points.length]!, { curve: curveId })) drawn.add(e);
  });
  const r = rebuildPlane(d, plane, normal, drawn);
  const created = new Set(r.created);
  // Drawn edges can also lie in the plane of another face (along a wall that crosses the
  // drawing plane): rebuild those planes too, so the edge splits the face as a line would.
  const others: { plane: Plane; normal: Vec3 }[] = [];
  for (const [, f] of d.faces) {
    const pl = planeThrough(f.normal, d.point(f.outer[0]!));
    if (samePlane(pl, plane) || others.some((o) => samePlane(o.plane, pl))) continue;
    const lies = [...drawn].some((e) => d.edges.has(e) && d.edge(e).v.every((v) => onPlane(pl, d.point(v))));
    if (lies) others.push({ plane: pl, normal: f.normal });
  }
  for (const o of others) {
    const ro = rebuildPlane(d, o.plane, o.normal, drawn);
    for (const f of ro.created) created.add(f);
    for (const f of ro.removed) created.delete(f);
  }
  return { topology: d.commit(), faceIds: [...created].filter((f) => d.faces.has(f)), edgeIds: [...drawn] };
}

/** The four corners of a rectangle with signed sizes along the plane axes of n. */
export function rectangleCorners(n: Vec3, corner: Point3, width: number, depth: number): Point3[] {
  const [u, v] = planeAxes(n);
  const U = scale(u, width);
  const V = scale(v, depth);
  return [corner, add(corner, U), add(add(corner, U), V), add(corner, V)].map(snapPoint);
}

export interface RectangleSpec {
  faceId: FaceId | null;
  corner: Point3;
  width: number;
  depth: number;
}

export interface RegularPolygonSpec {
  kind: 'circle' | 'polygon';
  faceId: FaceId | null;
  center: Point3;
  radius: number;
  /** Number of segments (circle) or sides (polygon). */
  segments: number;
  /** Direction from the center to the first vertex; projected onto the plane. Defaults to the plane's first axis. */
  direction?: Vec3 | null;
}

/** Most segments a circle or polygon may have. */
export const MAX_SEGMENTS = 1000;

/** Corners of a regular polygon around center in the plane with normal n, first one along `direction`. */
export function regularPolygonPoints(n: Vec3, center: Point3, radius: number, segments: number, direction?: Vec3 | null): Point3[] {
  const basis = planeBasis(n);
  let u = basis.u;
  if (direction) {
    const along = sub(direction, scale(n, dot(direction, n)));
    if (length(along) > 1e-9) u = normalize(along);
  }
  const v = cross(n, u);
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return snapPoint(add(center, add(scale(u, radius * Math.cos(a)), scale(v, radius * Math.sin(a)))));
  });
}

/**
 * Draw a circle or a regular polygon as one curve: its edges are selected and
 * erased together, and push/pull joins circle walls with soft edges.
 */
export function drawRegularPolygon(t: Topology, spec: RegularPolygonSpec): DrawResult {
  if (!Number.isInteger(spec.segments) || spec.segments < 3 || spec.segments > MAX_SEGMENTS) return { ok: false, error: 'tooSmall' };
  // Each side must be at least the smallest rectangle side.
  if (2 * spec.radius * Math.sin(Math.PI / spec.segments) < MIN_RECT_SIDE / 5) return { ok: false, error: 'tooSmall' };
  const target = drawingPlane(t, spec.faceId);
  if (!target) return { ok: false, error: 'noSuchFace' };
  if (!onPlane(target.plane, spec.center, 0.1)) return { ok: false, error: 'notOnPlane' };
  const pts = regularPolygonPoints(target.normal, spec.center, spec.radius, spec.segments, spec.direction);
  const curve = { kind: spec.kind, segments: spec.segments, center: snapPoint(spec.center), normal: target.normal, radius: spec.radius };
  return { ok: true, ...drawLoop(t, target.plane, target.normal, pts, curve) };
}

export function drawRectangle(t: Topology, spec: RectangleSpec): DrawResult {
  if (Math.abs(spec.width) < MIN_RECT_SIDE || Math.abs(spec.depth) < MIN_RECT_SIDE) return { ok: false, error: 'tooSmall' };
  const target = drawingPlane(t, spec.faceId);
  if (!target) return { ok: false, error: 'noSuchFace' };
  if (!onPlane(target.plane, spec.corner, 0.1)) return { ok: false, error: 'notOnPlane' };
  const pts = rectangleCorners(target.normal, spec.corner, spec.width, spec.depth);
  return { ok: true, ...drawLoop(t, target.plane, target.normal, pts) };
}
