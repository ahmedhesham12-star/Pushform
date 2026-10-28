/**
 * Instance transforms: rotation (unit quaternion), translation (mm) and scale
 * along the instance's own axes, which may be non-uniform or negative (a
 * mirror). A transform maps a point p in the instance's local space to its
 * parent as
 *   rotation * (scale * p) + translation.
 *
 * Placing a scaled instance inside a turned one can skew, which no Transform
 * holds: world placements are general affine maps (Affine).
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

/**
 * A general affine map p -> m p + t: `m` is the 3x3 linear part, column by
 * column. It may scale, mirror and skew.
 */
export interface Affine {
  readonly m: readonly [number, number, number, number, number, number, number, number, number];
  readonly t: Vec3;
}

export type AnyTransform = Transform | Affine;

export const AFFINE_IDENTITY: Affine = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

const isAffine = (x: AnyTransform): x is Affine => 'm' in x;

/** The affine map of a transform (or the map itself). */
export function affineOf(x: AnyTransform): Affine {
  if (isAffine(x)) return x;
  const c = (axis: Vec3, s: number) => quatRotate(x.rotation, [axis[0] * s, axis[1] * s, axis[2] * s]);
  const [a, b, d] = [c([1, 0, 0], x.scale[0]), c([0, 1, 0], x.scale[1]), c([0, 0, 1], x.scale[2])];
  return { m: [a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2]], t: x.translation };
}

const linear = (m: Affine['m'], v: Vec3): Vec3 => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

/** A point in local space, in the parent's space. */
export function applyPoint(x: AnyTransform, p: Vec3): Vec3 {
  if (isAffine(x)) {
    const r = linear(x.m, p);
    return [r[0] + x.t[0], r[1] + x.t[1], r[2] + x.t[2]];
  }
  const r = quatRotate(x.rotation, [p[0] * x.scale[0], p[1] * x.scale[1], p[2] * x.scale[2]]);
  return [r[0] + x.translation[0], r[1] + x.translation[1], r[2] + x.translation[2]];
}

/** A direction in local space, in the parent's space (no translation; lengths scale). */
export function applyVector(x: AnyTransform, v: Vec3): Vec3 {
  if (isAffine(x)) return linear(x.m, v);
  return quatRotate(x.rotation, [v[0] * x.scale[0], v[1] * x.scale[1], v[2] * x.scale[2]]);
}

export function determinant(x: AnyTransform): number {
  if (!isAffine(x)) return x.scale[0] * x.scale[1] * x.scale[2];
  const m = x.m;
  return m[0] * (m[4] * m[8] - m[7] * m[5]) - m[3] * (m[1] * m[8] - m[7] * m[2]) + m[6] * (m[1] * m[5] - m[4] * m[2]);
}

/** `b` then `a`: a general product, skewed when a non-uniform scale meets a turn. */
export function multiply(a: AnyTransform, b: AnyTransform): Affine {
  const A = affineOf(a);
  const B = affineOf(b);
  const col = (i: number) => linear(A.m, [B.m[i * 3]!, B.m[i * 3 + 1]!, B.m[i * 3 + 2]!]);
  const [c0, c1, c2] = [col(0), col(1), col(2)];
  return { m: [...c0, ...c1, ...c2], t: applyPoint(A, B.t) };
}

/** The inverse map. A transform's scale is never zero, so it always exists. */
export function invert(x: AnyTransform): Affine {
  const { m, t } = affineOf(x);
  const det = determinant({ m, t });
  // The inverse is the adjugate over the determinant; written column by column.
  const inv: Affine['m'] = [
    (m[4] * m[8] - m[7] * m[5]) / det,
    (m[7] * m[2] - m[1] * m[8]) / det,
    (m[1] * m[5] - m[4] * m[2]) / det,
    (m[6] * m[5] - m[3] * m[8]) / det,
    (m[0] * m[8] - m[6] * m[2]) / det,
    (m[3] * m[2] - m[0] * m[5]) / det,
    (m[3] * m[7] - m[6] * m[4]) / det,
    (m[6] * m[1] - m[0] * m[7]) / det,
    (m[0] * m[4] - m[3] * m[1]) / det,
  ];
  const r = linear(inv, t);
  return { m: inv, t: [-r[0] + 0, -r[1] + 0, -r[2] + 0] };
}

/**
 * A face normal in local space, in the parent's space: through the inverse
 * transpose, which keeps it square to the face under a scale, and unit
 * length. It still points out of the same side of the face under a mirror.
 */
export function applyNormal(x: AnyTransform, n: Vec3): Vec3 {
  const inv = invert(x).m;
  const v: Vec3 = [inv[0] * n[0] + inv[1] * n[1] + inv[2] * n[2], inv[3] * n[0] + inv[4] * n[1] + inv[5] * n[2], inv[6] * n[0] + inv[7] * n[1] + inv[8] * n[2]];
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Scaling about `origin`: by factors[i] along each of `axes` (unit vectors at
 * right angles to each other), or by factors[0] in every direction when there
 * are no axes. A negative factor mirrors.
 */
export function scaling(origin: Vec3, axes: readonly Vec3[], factors: readonly number[]): Affine {
  const m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (!axes.length) for (const i of [0, 4, 8]) m[i] = factors[0]!;
  axes.forEach((u, k) => {
    const f = factors[k]! - 1;
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 3 + r]! += f * u[r]! * u[c]!;
  });
  const lin = m as unknown as Affine['m'];
  const o = linear(lin, origin);
  return { m: lin, t: [origin[0] - o[0], origin[1] - o[1], origin[2] - o[2]] };
}

/**
 * How much a map scales lengths in the plane with this normal, when it scales
 * them the same in every direction there (a circle in it stays a circle);
 * null when it stretches the plane.
 */
export function planeScale(x: AnyTransform, normal: Vec3): number | null {
  const [nx, ny, nz] = normal;
  // Any unit vector in the plane, and the one square to it.
  const u: Vec3 = Math.abs(nx) < 0.9 ? [0, nz, -ny] : [-nz, 0, nx];
  const lu = Math.hypot(u[0], u[1], u[2]);
  const a: Vec3 = [u[0] / lu, u[1] / lu, u[2] / lu];
  const nl = Math.hypot(nx, ny, nz);
  const b: Vec3 = [(ny * a[2] - nz * a[1]) / nl, (nz * a[0] - nx * a[2]) / nl, (nx * a[1] - ny * a[0]) / nl];
  const [pa, pb] = [applyVector(x, a), applyVector(x, b)];
  const [la, lb] = [Math.hypot(...pa), Math.hypot(...pb)];
  const square = Math.abs(pa[0] * pb[0] + pa[1] * pb[1] + pa[2] * pb[2]) <= 1e-9 * la * lb;
  return square && Math.abs(la - lb) <= 1e-9 * la ? la : null;
}

/**
 * The transform of an affine map without skew: its columns square to each
 * other. Null when it is skewed. Scale signs can trade places with a half
 * turn; a mirror shows as a negative scale on red, or, given `near`, the
 * signs are chosen whose rotation is closest to it (a group flipped along
 * green keeps its rotation and shows -1 on green).
 */
export function decompose(a: Affine, near?: Quat): Transform | null {
  const cols: Vec3[] = [0, 1, 2].map((i) => [a.m[i * 3]!, a.m[i * 3 + 1]!, a.m[i * 3 + 2]!]);
  const len = cols.map((c) => Math.hypot(c[0], c[1], c[2]));
  if (len.some((l) => l < 1e-12)) return null;
  for (const [i, j] of [
    [0, 1],
    [0, 2],
    [1, 2],
  ] as const) {
    const d = cols[i]![0] * cols[j]![0] + cols[i]![1] * cols[j]![1] + cols[i]![2] * cols[j]![2];
    if (Math.abs(d) > 1e-9 * len[i]! * len[j]!) return null;
  }
  const signs: [number, number, number][] =
    determinant(a) < 0
      ? [
          [-1, 1, 1],
          [1, -1, 1],
          [1, 1, -1],
          [-1, -1, -1],
        ]
      : [
          [1, 1, 1],
          [-1, -1, 1],
          [-1, 1, -1],
          [1, -1, -1],
        ];
  let best: Transform | null = null;
  let closest = -1;
  for (const sign of near ? signs : signs.slice(0, 1)) {
    const scale = sign.map((s, i) => s * len[i]!) as [number, number, number];
    const r = cols.map((c, i) => c.map((v) => v / scale[i]!) as unknown as Vec3);
    const rotation = quatFromColumns(r[0]!, r[1]!, r[2]!);
    const d = near ? Math.abs(rotation[0] * near[0] + rotation[1] * near[1] + rotation[2] * near[2] + rotation[3] * near[3]) : 0;
    if (d > closest + 1e-12) {
      best = { rotation, translation: a.t, scale };
      closest = d;
    }
  }
  return best;
}

/** The rotation whose matrix has these unit, square columns (Shepperd's method). */
function quatFromColumns(x: Vec3, y: Vec3, z: Vec3): Quat {
  const [m00, m10, m20, m01, m11, m21, m02, m12, m22] = [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  return quatNormalize(q);
}

/**
 * `child` then `parent`, as a transform. Exact for the moves and turns tools
 * make; only valid when the parent's scale is uniform (a non-uniform parent
 * can skew the child: use multiply and decompose).
 */
export function compose(parent: Transform, child: Transform): Transform {
  return {
    rotation: quatNormalize(quatMultiply(parent.rotation, child.rotation)),
    translation: applyPoint(parent, child.translation),
    scale: [parent.scale[0] * child.scale[0], parent.scale[1] * child.scale[1], parent.scale[2] * child.scale[2]],
  };
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
 * Round a transform for storage: translation to the model's 1e-6 mm, the
 * rotation normalized with components that are almost exact (0, 1, 1/sqrt 2)
 * snapped, so 90 degree turns compose without drift, and scales within float
 * noise of a round value (2.0000000000000004) snapped to it.
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
    scale: [snapScale(t.scale[0]), snapScale(t.scale[1]), snapScale(t.scale[2])],
  };
}

function snapScale(v: number): number {
  const r = Math.round(v * 1e9) / 1e9;
  return Math.abs(v - r) <= 1e-12 * Math.max(1, Math.abs(v)) ? r + 0 : v;
}

/** Column-major 4x4 matrix, as three.js and glTF use. */
export function toMatrix(x: AnyTransform): number[] {
  if (isAffine(x)) {
    const m = x.m;
    return [m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, x.t[0], x.t[1], x.t[2], 1];
  }
  return trsMatrix(x);
}

function trsMatrix(t: Transform): number[] {
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
