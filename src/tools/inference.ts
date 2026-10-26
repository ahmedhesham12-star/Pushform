import type { Vector3 } from 'three';
import { dragStep } from '../units';
import type { Axis, MarkerKind } from '../viewport';
import type { ToolContext } from './tool';

/** Arrow keys lock an axis, as in SketchUp: right is red, left is green, up or down is blue. */
export const AXIS_KEYS: Readonly<Record<string, Axis>> = { ArrowRight: 'x', ArrowLeft: 'z', ArrowUp: 'y', ArrowDown: 'y' };
const AXIS_MARKER: Record<Axis, MarkerKind> = { x: 'axisX', y: 'axisY', z: 'axisZ' };
/** Points within this distance (mm) of a plane count as on it. */
const ON_PLANE = 0.1;

export interface Inferred {
  point: Vector3;
  kind: MarkerKind;
  /** The axis the point lies on from the start point, if inferred along one. */
  axis: Axis | null;
  /** The edge the point lies on, when inferred on one (its ends, world). */
  edge?: { a: Vector3; b: Vector3 };
}

/**
 * A point on a drawing plane (Rectangle, Circle, Polygon, and Line on a face
 * or the ground), by inference: an endpoint or midpoint on the plane, else a
 * point on an edge lying in the plane, else `raw` snapped to the grid.
 * Points and edges win over the face whenever they are within the pick
 * tolerance. Shows the inference marker.
 */
export function inferOnPlane(ctx: ToolContext, planePoint: Vector3, normal: Vector3, raw: Vector3, fallback: MarkerKind): Inferred {
  const vp = ctx.viewport;
  const onPlane = (p: Vector3) => Math.abs(p.clone().sub(planePoint).dot(normal)) < ON_PLANE;
  const snap = vp.nearestSnap(onPlane);
  const edge = snap ? null : vp.pickEdge('all');
  const found: Inferred = snap
    ? { point: snap.point.clone(), kind: snap.kind, axis: null }
    : edge && onPlane(edge.point)
      ? { point: edge.point.clone(), kind: 'edge', axis: null, edge: { a: edge.a, b: edge.b } }
      : { point: vp.gridPoint(planePoint, normal, raw), kind: fallback, axis: null };
  vp.showMarker(found.point, found.kind);
  return found;
}

/**
 * Where a point goes by inference, shared by the Line, Move and Rotate tools:
 * an axis lock first, then endpoints and midpoints, points on edges, the axes
 * through `start`, and finally the face or ground under the pointer (snapped
 * to the grid). Everything visible counts, including geometry outside the
 * editing context; the viewport skips what it was told to exclude.
 */
export function inferPoint(ctx: ToolContext, start: Vector3 | null, lock: Axis | null): Inferred | null {
  const vp = ctx.viewport;
  /** A point along an axis from start, at a distance rounded to the drag step. */
  const onAxis = (s: Vector3, axis: Axis, p: Vector3): Inferred => {
    const step = dragStep(ctx.units());
    const dir = vp.axisDirection(axis);
    const dist = Math.round(p.clone().sub(s).dot(dir) / step) * step;
    return { point: s.clone().addScaledVector(dir, dist), kind: AXIS_MARKER[axis], axis };
  };
  if (start && lock) {
    const p = vp.closestOnLine(start, vp.axisDirection(lock));
    return p ? onAxis(start, lock, p) : null;
  }
  const snap = vp.nearestSnap(() => true);
  if (snap) return { point: snap.point.clone(), kind: snap.kind, axis: null };
  const edge = vp.pickEdge('all');
  if (edge) return { point: edge.point.clone(), kind: 'edge', axis: null, edge: { a: edge.a, b: edge.b } };
  if (start) {
    const a = vp.axisInference(start);
    if (a) return onAxis(start, a.axis, a.point);
  }
  const pl = vp.planeUnderCursor();
  if (!pl) return null;
  return inferOnPlane(ctx, pl.point, pl.normal, pl.point, pl.onFace ? 'face' : 'ground');
}
