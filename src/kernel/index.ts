/**
 * Public kernel API. Nothing outside src/kernel may import other kernel files.
 *
 * Model is opaque: callers can only pass it back to these functions. This is
 * the boundary that lets milestone 2 swap the face/loop store for a half-edge
 * structure without touching commands, tools or the viewport.
 *
 * Mutations (createModel, drawRectangle, pushPull, deleteFace, deserialize) are
 * for src/commands only; everything else is read-only and may be used anywhere.
 */
import { emptyModel, type ModelData } from './model';
import * as q from './query';
import { drawRectangle as drawRect, rectangleLoop, type RectangleError, type RectangleSpec } from './rectangle';
import { pushPull as push } from './pushPull';
import { deserialize as load, serialize as save, type SerializedModel } from './serialize';

declare const opaque: unique symbol;
export type Model = { readonly [opaque]: 'Model' };

const data = (m: Model) => m as unknown as ModelData;
const wrap = (m: ModelData) => m as unknown as Model;

export type { Vec3 } from './vec';
export type { Point3 } from './model';
export type { FaceView, SnapPoint, SnapKind, Bounds } from './query';
export type { RectangleError, RectangleSpec, SerializedModel };
export { planeAxes } from './vec';
export { GROUND_NORMAL } from './rectangle';
export { COORDINATE_PRECISION, EPSILON, MIN_RECT_SIDE, snapLength, snapPoint } from './model';

/* ---------- mutations (commands only) ---------- */

export function createModel(): Model {
  return wrap(emptyModel());
}

export type DrawRectangleResult = { ok: true; model: Model; faceId: string } | { ok: false; error: RectangleError };

export function drawRectangle(m: Model, spec: RectangleSpec): DrawRectangleResult {
  const r = drawRect(data(m), spec);
  return r.ok ? { ok: true, model: wrap(r.model), faceId: r.faceId } : r;
}

/** Returns the same model instance when nothing changed (distance 0). */
export function pushPull(m: Model, faceId: string, distance: number): { model: Model; distance: number } {
  const r = push(data(m), faceId, distance);
  return { model: wrap(r.model), distance: r.distance };
}

/** Returns the same model instance when the face does not exist. */
export function deleteFace(m: Model, faceId: string): Model {
  const d = data(m);
  if (!d.faces[faceId]) return m;
  const faces = { ...d.faces };
  delete faces[faceId];
  return wrap({ faces, next: d.next });
}

export function deserialize(json: unknown): Model | null {
  const d = load(json);
  return d && wrap(d);
}

/* ---------- read-only queries ---------- */

export const serialize = (m: Model): SerializedModel => save(data(m));
export const listFaces = (m: Model) => q.listFaces(data(m));
export const getFace = (m: Model, id: string) => q.getFace(data(m), id);
export const hasFace = (m: Model, id: string): boolean => Object.hasOwn(data(m).faces, id);
export const faceCount = (m: Model) => q.faceCount(data(m));
export const faceArea = (m: Model, id: string) => q.faceArea(data(m), id);
export const renderEdges = (m: Model) => q.renderEdges(data(m));
export const snapPoints = (m: Model) => q.snapPoints(data(m));
export const bounds = (m: Model) => q.bounds(data(m));
/** Corners of a rectangle as drawRectangle would create it; used for previews. */
export const previewRectangle = rectangleLoop;
