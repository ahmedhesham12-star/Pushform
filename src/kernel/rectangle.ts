import {
  addFace,
  draft,
  INSET_MARGIN,
  MIN_RECT_SIDE,
  orient,
  snapPoint,
  type ModelData,
  type Point3,
} from './model';
import { add, dot, planeAxes, scale, sub, type Vec3 } from './vec';

export const GROUND_NORMAL: Vec3 = [0, 1, 0];
/** How far (mm) a rectangle corner may sit off its target plane. */
const PLANE_TOLERANCE = 0.1;

export interface RectangleSpec {
  /** Face to draw on, or null for the ground plane. */
  faceId: string | null;
  /** First corner, on the target plane. */
  corner: Point3;
  /** Signed sizes along the plane's axes (see planeAxes), in mm. */
  width: number;
  depth: number;
}

export type RectangleError = 'noSuchFace' | 'tooSmall' | 'notOnPlane' | 'outsideFace' | 'overlapsHole';

export type RectangleResult = { ok: true; model: ModelData; faceId: string } | { ok: false; error: RectangleError };

/** The four corners of a rectangle on a plane with normal n, snapped to stored precision. */
export function rectangleLoop(n: Vec3, corner: Point3, width: number, depth: number): Point3[] {
  const [u, v] = planeAxes(n);
  const U = scale(u, width);
  const V = scale(v, depth);
  return [corner, add(corner, U), add(add(corner, U), V), add(corner, V)].map(snapPoint);
}

/**
 * Draw a rectangle on the ground, or inside an existing face. Inside a face it
 * cuts a hole and fills it with a new face; it must sit fully inside the face
 * and must not touch existing holes (edge splitting is not implemented yet).
 */
export function drawRectangle(m0: ModelData, spec: RectangleSpec): RectangleResult {
  const { faceId, corner, width, depth } = spec;
  if (Math.abs(width) < MIN_RECT_SIDE || Math.abs(depth) < MIN_RECT_SIDE) return { ok: false, error: 'tooSmall' };

  if (faceId === null) {
    if (Math.abs(corner[1]) > PLANE_TOLERANCE) return { ok: false, error: 'notOnPlane' };
    const m = draft(m0);
    const id = addFace(m, rectangleLoop(GROUND_NORMAL, corner, width, depth), GROUND_NORMAL);
    return { ok: true, model: m, faceId: id };
  }

  const f = m0.faces[faceId];
  if (!f) return { ok: false, error: 'noSuchFace' };
  const n = f.normal;
  if (Math.abs(dot(sub(corner, f.outer[0]!), n)) > PLANE_TOLERANCE) return { ok: false, error: 'notOnPlane' };

  const loop = rectangleLoop(n, corner, width, depth);
  const [u, v] = planeAxes(n);
  const box = (pts: readonly Point3[]) => {
    const us = pts.map((p) => dot(p, u));
    const vs = pts.map((p) => dot(p, v));
    return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
  };
  const e = INSET_MARGIN;
  const r = box(loop);
  const o = box(f.outer);
  if (!(r.u0 > o.u0 + e && r.u1 < o.u1 - e && r.v0 > o.v0 + e && r.v1 < o.v1 - e)) {
    return { ok: false, error: 'outsideFace' };
  }
  for (const h of f.holes) {
    const b = box(h);
    if (!(r.u1 < b.u0 - e || r.u0 > b.u1 + e || r.v1 < b.v0 - e || r.v0 > b.v1 + e)) {
      return { ok: false, error: 'overlapsHole' };
    }
  }
  const m = draft(m0);
  m.faces[faceId] = { ...f, holes: [...f.holes, orient(loop, n, false)] };
  const id = addFace(m, loop, n);
  return { ok: true, model: m, faceId: id };
}
