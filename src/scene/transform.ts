/**
 * Instance transforms: rotation (unit quaternion), translation (mm) and scale.
 * Scale is part of the format so Flip and Scale (milestone 4) need no format
 * change; until then it is always [1, 1, 1].
 *
 * A transform maps a point p in the instance's local space to its parent as
 *   rotation * (scale * p) + translation.
 */
import { snapLength, type Vec3 } from '../kernel';

export type Quat = readonly [number, number, number, number];

export interface Transform {
  readonly rotation: Quat;
  readonly translation: Vec3;
  readonly scale: Vec3;
}

export const IDENTITY: Transform = { rotation: [0, 0, 0, 1], translation: [0, 0, 0], scale: [1, 1, 1] };

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export const quatConjugate = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

export function quatNormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return l ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : [0, 0, 0, 1];
}

/** Rotation by `angle` radians around a unit axis. */
export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const l = Math.hypot(axis[0], axis[1], axis[2]);
  const s = Math.sin(angle / 2) / (l || 1);
  return quatNormalize([axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]);
}

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  // v' = q v q*, expanded.
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** A point in local space, in the parent's space. */
export function applyPoint(t: Transform, p: Vec3): Vec3 {
  const r = quatRotate(t.rotation, [p[0] * t.scale[0], p[1] * t.scale[1], p[2] * t.scale[2]]);
  return [r[0] + t.translation[0], r[1] + t.translation[1], r[2] + t.translation[2]];
}

/** A direction in local space, in the parent's space (no translation). */
export function applyVector(t: Transform, v: Vec3): Vec3 {
  return quatRotate(t.rotation, [v[0] * t.scale[0], v[1] * t.scale[1], v[2] * t.scale[2]]);
}

/** `child` then `parent`: maps the child's local space through the parent's transform. Assumes unit scale (see isUnitScale). */
export function compose(parent: Transform, child: Transform): Transform {
  return {
    rotation: quatNormalize(quatMultiply(parent.rotation, child.rotation)),
    translation: applyPoint(parent, child.translation),
    scale: [parent.scale[0] * child.scale[0], parent.scale[1] * child.scale[1], parent.scale[2] * child.scale[2]],
  };
}

/** The inverse of a transform with unit scale. */
export function inverse(t: Transform): Transform {
  const rotation = quatConjugate(t.rotation);
  const tr = quatRotate(rotation, t.translation);
  return { rotation, translation: [-tr[0] + 0, -tr[1] + 0, -tr[2] + 0], scale: [1, 1, 1] };
}

export const translation = (v: Vec3): Transform => ({ ...IDENTITY, translation: v });

/** Rotation by `angle` radians around the axis through `center`. */
export function rotationAbout(center: Vec3, axis: Vec3, angle: number): Transform {
  const rotation = quatFromAxisAngle(axis, angle);
  const rc = quatRotate(rotation, center);
  return { rotation, translation: [center[0] - rc[0], center[1] - rc[1], center[2] - rc[2]], scale: [1, 1, 1] };
}

export const isUnitScale = (t: Transform) => t.scale[0] === 1 && t.scale[1] === 1 && t.scale[2] === 1;

/**
 * Round a transform for storage: translation to the model's 1e-6 mm, and the
 * rotation normalized with components that are almost exact (0, 1, 1/sqrt 2)
 * snapped, so 90 degree turns compose without drift.
 */
export function snapTransform(t: Transform): Transform {
  const q = quatNormalize(t.rotation);
  const exact = [0, 1, -1, Math.SQRT1_2, -Math.SQRT1_2, 0.5, -0.5];
  const snap = (v: number) => exact.find((e) => Math.abs(v - e) < 1e-12) ?? v;
  const snapped: Quat = [snap(q[0]), snap(q[1]), snap(q[2]), snap(q[3])];
  // Renormalizing an already-unit quaternion can nudge exact values (sqrt 1/2) to a neighbouring float.
  const norm = Math.hypot(...snapped);
  const rotation = Math.abs(norm - 1) <= 1e-12 ? snapped : quatNormalize(snapped);
  // q and -q are the same rotation; keep w non-negative for a stable form.
  const canonical: Quat = rotation[3] < 0 ? [-rotation[0] + 0, -rotation[1] + 0, -rotation[2] + 0, -rotation[3] + 0] : rotation;
  return {
    rotation: canonical,
    translation: [snapLength(t.translation[0]), snapLength(t.translation[1]), snapLength(t.translation[2])],
    scale: t.scale,
  };
}

/** Column-major 4x4 matrix, as three.js and glTF use. */
export function toMatrix(t: Transform): number[] {
  const [x, y, z, w] = t.rotation;
  const [sx, sy, sz] = t.scale;
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    t.translation[0],
    t.translation[1],
    t.translation[2],
    1,
  ];
}
