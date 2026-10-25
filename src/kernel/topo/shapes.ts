import { MIN_RECT_SIDE } from '../model';
import { snapPoint } from '../precision';
import { add, planeAxes, scale, type Vec3 } from '../vec';
import { Draft } from './draft';
import { onPlane, planeThrough, type Plane } from './geometry';
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
  return { topology: d.commit(), faceIds: r.created, edgeIds: [...drawn] };
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

export function drawRectangle(t: Topology, spec: RectangleSpec): DrawResult {
  if (Math.abs(spec.width) < MIN_RECT_SIDE || Math.abs(spec.depth) < MIN_RECT_SIDE) return { ok: false, error: 'tooSmall' };
  const target = drawingPlane(t, spec.faceId);
  if (!target) return { ok: false, error: 'noSuchFace' };
  if (!onPlane(target.plane, spec.corner, 0.1)) return { ok: false, error: 'notOnPlane' };
  const pts = rectangleCorners(target.normal, spec.corner, spec.width, spec.depth);
  return { ok: true, ...drawLoop(t, target.plane, target.normal, pts) };
}
