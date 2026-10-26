import { Vector3 } from 'three';
import type { Axis } from '../viewport';
import { inferPoint, type Inferred } from './inference';
import type { ToolContext } from './tool';

/** Angles snap to multiples of this (degrees) when the pointer is within SNAP_WITHIN of one. */
const SNAP_STEP = 15;
const SNAP_WITHIN = 2.5;
const SEGMENTS = 72;

/** A point projected onto the plane through center with normal n. */
export const ontoPlane = (p: Vector3, center: Vector3, n: Vector3) => p.clone().sub(n.clone().multiplyScalar(p.clone().sub(center).dot(n)));

/** Signed angle in degrees from a to b around n (counter-clockwise looking against n). */
export const angleBetween = (a: Vector3, b: Vector3, n: Vector3) => (Math.atan2(a.clone().cross(b).dot(n), a.dot(b)) * 180) / Math.PI;

/** The protractor's size on screen follows the camera distance. */
export const protractorRadius = (ctx: ToolContext) => ctx.viewport.camera.distance * 0.06;

/** The protractor's normal: a locked axis, the face under the pointer, or the context's ground. */
export function protractorNormal(ctx: ToolContext, lock: Axis | null): Vector3 {
  const vp = ctx.viewport;
  if (lock) return vp.axisDirection(lock);
  return vp.planeUnderCursor()?.normal.clone() ?? vp.groundNormal();
}

/** The protractor ring around a center, in a locked axis's color. */
export function protractorRing(ctx: ToolContext, center: Vector3, n: Vector3, lock: Axis | null) {
  const u = Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0).cross(n).normalize() : new Vector3(1, 0, 0).cross(n).normalize();
  const v = n.clone().cross(u);
  const r = protractorRadius(ctx);
  const points: Vector3[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    points.push(center.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r));
  }
  return { points, closed: true, axis: lock };
}

/** Where the pointer points in the protractor's plane, by inference (a unit direction from the center). */
export function aim(ctx: ToolContext, center: Vector3, normal: Vector3): { dir: Vector3; inferred: Inferred } | null {
  const inferred = inferPoint(ctx, center, null);
  if (!inferred) return null;
  const dir = ontoPlane(inferred.point, center, normal).sub(center);
  if (dir.length() < 1e-6) return null;
  ctx.viewport.showMarker(inferred.point, inferred.kind);
  return { dir: dir.normalize(), inferred };
}

/**
 * The angle from `start` to `dir` about `normal`, in degrees. Points, edges
 * and guides under the pointer give exact angles; otherwise it snaps to 15
 * degree steps nearby.
 */
export function snappedAngle(start: Vector3, dir: Vector3, normal: Vector3, inferred: Inferred): number {
  let angle = angleBetween(start, dir, normal);
  const exact = ['end', 'mid', 'edge', 'guide', 'guidePoint', 'intersection'].includes(inferred.kind);
  const snapped = Math.round(angle / SNAP_STEP) * SNAP_STEP;
  if (!exact && Math.abs(angle - snapped) <= SNAP_WITHIN) angle = snapped;
  return Math.round(angle * 1e6) / 1e6;
}
