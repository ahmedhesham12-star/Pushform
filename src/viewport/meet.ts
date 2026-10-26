import { Vector3 } from 'three';

/** Lines closer than this (mm) where they pass each other meet. */
export const MEET = 0.01;

/**
 * Where line p + s d meets line q + t e (unit directions), with t, or null
 * when they are parallel or pass more than MEET apart.
 */
export function meet(p: Vector3, d: Vector3, q: Vector3, e: Vector3): { point: Vector3; t: number } | null {
  const b = d.dot(e);
  const den = 1 - b * b;
  if (den < 1e-9) return null;
  const w = p.clone().sub(q);
  const s = (b * e.dot(w) - d.dot(w)) / den;
  const t = (e.dot(w) - b * d.dot(w)) / den;
  const a = p.clone().addScaledVector(d, s);
  const c = q.clone().addScaledVector(e, t);
  return a.distanceTo(c) <= MEET ? { point: a.add(c).multiplyScalar(0.5), t } : null;
}
