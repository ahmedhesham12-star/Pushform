/** Minimal 3D vector math on plain tuples, so geometry stays JSON-serializable. */

export type Vec3 = readonly [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
// Adding 0 turns -0 into 0 so normals compare and serialize cleanly.
export const negate = (a: Vec3): Vec3 => [-a[0] + 0, -a[1] + 0, -a[2] + 0];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const midpoint = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);

export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l ? [a[0] / l + 0, a[1] / l + 0, a[2] / l + 0] : [0, 0, 0];
}

/** Newell's method: area-weighted normal of a polygon (length is twice the area). */
export function newell(loop: readonly Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}

/**
 * Two in-plane axes for a plane normal, chosen from the dominant normal
 * component. The ground (normal +Y) gets X and Z.
 */
export function planeAxes(n: Vec3): [Vec3, Vec3] {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return [[1, 0, 0], [0, 0, 1]];
  if (ax >= az) return [[0, 0, 1], [0, 1, 0]];
  return [[1, 0, 0], [0, 1, 0]];
}
