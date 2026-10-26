import type { Vector3 } from 'three';
import { dragStep } from '../units';
import { AXIS_DIRECTION, type Axis, type MarkerKind } from '../viewport';
import type { ToolContext } from './tool';

/** Arrow keys lock an axis, as in SketchUp: right is red, left is green, up or down is blue. */
export const AXIS_KEYS: Readonly<Record<string, Axis>> = { ArrowRight: 'x', ArrowLeft: 'z', ArrowUp: 'y', ArrowDown: 'y' };
const AXIS_MARKER: Record<Axis, MarkerKind> = { x: 'axisX', y: 'axisY', z: 'axisZ' };

export interface Inferred {
  point: Vector3;
  kind: MarkerKind;
  /** The axis the point lies on from the start point, if inferred along one. */
  axis: Axis | null;
}

/**
 * Where a point goes by inference, shared by the Line, Move and Rotate tools:
 * an axis lock first, then endpoints and midpoints, points on edges, the axes
 * through \`start\`, and finally the face or ground under the pointer (snapped
 * to the grid). Everything visible counts, including geometry outside the
 * editing context; the viewport skips what it was told to exclude.
 */
export function inferPoint(ctx: ToolContext, start: Vector3 | null, lock: Axis | null): Inferred | null {
  const vp = ctx.viewport;
  /** A point along an axis from start, at a distance rounded to the drag step. */
  const onAxis = (s: Vector3, axis: Axis, p: Vector3): Inferred => {
    const step = dragStep(ctx.units());
    const dist = Math.round(p.clone().sub(s).dot(AXIS_DIRECTION[axis]) / step) * step;
    return { point: s.clone().addScaledVector(AXIS_DIRECTION[axis], dist), kind: AXIS_MARKER[axis], axis };
  };
  if (start && lock) {
    const p = vp.closestOnLine(start, AXIS_DIRECTION[lock]);
    return p ? onAxis(start, lock, p) : null;
  }
  const snap = vp.nearestSnap(() => true);
  if (snap) return { point: snap.point.clone(), kind: snap.kind, axis: null };
  const edge = vp.pickEdge('all');
  if (edge) return { point: edge.point.clone(), kind: 'edge', axis: null };
  if (start) {
    const a = vp.axisInference(start);
    if (a) return onAxis(start, a.axis, a.point);
  }
  const pl = vp.planeUnderCursor();
  if (!pl) return null;
  const p = vp.snapOnPlane(pl.point, pl.normal, pl.point, pl.onFace ? 'face' : 'ground');
  return { point: p, kind: pl.onFace ? 'face' : 'ground', axis: null };
}
