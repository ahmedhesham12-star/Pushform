import type { Vector3 } from 'three';
import type { PlaneHit } from '../viewport';
import type { Inferred } from './inference';
import type { ToolContext } from './tool';

/** How far (mm) a placed point may lie from a plane and still be on it. */
const ON_PLANE = 1e-3;

interface PlaneLike {
  point: Vector3;
  normal: Vector3;
}

const holds = (pl: PlaneLike) => (p: Vector3) => Math.abs(p.clone().sub(pl.point).dot(pl.normal)) < ON_PLANE;

/**
 * Whether a shape started at this point still has its plane to find: inside
 * a face or on the ground the first click fixes the plane; on an edge, a
 * corner or a guide it does not, since the faces meeting there are equally
 * likely to be under the pointer.
 */
export const startsLoose = (at: Inferred) => at.kind !== 'face' && at.kind !== 'ground';

/**
 * The face (or ground) under the pointer when its plane holds every point
 * placed so far, else null. A shape started on an edge or a corner moves to
 * it, so a notch or an arc drawn from a box's top edge lies on the top face
 * the pointer is over, not on the side the first click happened to hit. Over
 * an edge or a point the current plane holds as well, it stays where it is.
 */
export function planeHolding(ctx: ToolContext, points: readonly Vector3[], current: PlaneLike): PlaneHit | null {
  const vp = ctx.viewport;
  const pl = vp.planeUnderCursor();
  if (!pl || !points.every(holds(pl))) return null;
  const at = vp.nearestSnap(holds(current)) ?? vp.pickEdge('all');
  return at && holds(current)(at.point) ? null : pl;
}
