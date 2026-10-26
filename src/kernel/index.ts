/**
 * Public kernel API. Nothing outside src/kernel may import other kernel files.
 *
 * The model is a shared topology (vertices, edges, faces, curves; see
 * types.ts). Model is opaque: callers can only pass it back to these functions,
 * so the representation can change without touching commands, tools or the
 * viewport.
 *
 * Mutations (createModel, drawRectangle, drawRegularPolygon, drawLine, pushPull, erase,
 * extractGeometry, transformGeometry, mergeGeometry, deserialize) are for
 * src/commands only; everything else is read-only and may be used anywhere.
 */
import { extract as extractTopology, merge as mergeTopology, transformTopology } from './assembly';
import { erase as eraseTopology } from './erase';
import { drawLine as drawTopologyLine } from './lines';
import { pushPull as pushTopology } from './pushPull';
import * as q from './query';
import { deserializeTopology, serializeTopology, type SerializedTopology } from './serialize';
import {
  drawRectangle as drawRect,
  drawRegularPolygon as drawRegular,
  rectangleCorners,
  regularPolygonPoints,
  type DrawError,
  type RectangleSpec,
  type RegularPolygonSpec,
} from './shapes';
import { faceMeshes as meshes, faceTriangles as triangles, type FaceMesh, type Triangle } from './triangulate';
import { emptyTopology, type Point3, type Topology } from './types';
import type { Vec3 } from './vec';
import { validate } from './validate';

declare const opaque: unique symbol;
export type Model = { readonly [opaque]: 'Model' };

const data = (m: Model) => m as unknown as Topology;
const wrap = (t: Topology) => t as unknown as Model;

export type { Vec3 } from './vec';
export type { Point3, FaceId, EdgeId, CurveId, CurveKind } from './types';
export type { FaceView, EdgeView, SnapPoint, SnapKind, Bounds } from './query';
export type { DrawError, RectangleSpec, RegularPolygonSpec, SerializedTopology, FaceMesh, Triangle };
export { cleanNormal, planeAxes } from './vec';
export { GROUND_NORMAL, MAX_SEGMENTS } from './shapes';
export { COORDINATE_PRECISION, EPSILON, MIN_RECT_SIDE, snapLength, snapPoint, VERTEX_TOLERANCE } from './precision';

/* ---------- mutations (commands only) ---------- */

export function createModel(): Model {
  return wrap(emptyTopology());
}

export type DrawResult = { ok: true; model: Model; faceIds: string[] } | { ok: false; error: DrawError };

/**
 * Draw a rectangle on the ground or on a face. It may overlap, cross, touch or
 * contain existing faces; they are split into the right regions.
 */
export function drawRectangle(m: Model, spec: RectangleSpec): DrawResult {
  const r = drawRect(data(m), spec);
  return r.ok ? { ok: true, model: wrap(r.topology), faceIds: r.faceIds } : r;
}

/** Draw a circle or regular polygon as one curve, on the ground or on a face. */
export function drawRegularPolygon(m: Model, spec: RegularPolygonSpec): DrawResult {
  const r = drawRegular(data(m), spec);
  return r.ok ? { ok: true, model: wrap(r.topology), faceIds: r.faceIds } : r;
}

/**
 * Draw a straight line. It splits edges and faces it crosses in their plane,
 * and closing a planar loop creates a face. Returns the same model when the
 * line adds nothing (both ends on one vertex).
 */
export function drawLine(m: Model, start: Point3, end: Point3): { model: Model; edgeIds: string[]; faceIds: string[] } {
  const r = drawTopologyLine(data(m), start, end);
  return { model: wrap(r.topology), edgeIds: r.edgeIds, faceIds: r.faceIds };
}

export interface PushPullResult {
  model: Model;
  distance: number;
  createdFaceIds: string[];
  removedFaceIds: string[];
}

/** Returns the same model instance when nothing changed (distance 0). */
export function pushPull(m: Model, faceId: string, distance: number): PushPullResult {
  const r = pushTopology(data(m), faceId, distance);
  return { model: wrap(r.topology), distance: r.distance, createdFaceIds: r.createdFaceIds, removedFaceIds: r.removedFaceIds };
}

/** Erase faces and edges with SketchUp's rules. Returns the same model when nothing was erased. */
export function erase(m: Model, faceIds: readonly string[], edgeIds: readonly string[]): { model: Model; removedFaceIds: string[] } {
  const r = eraseTopology(data(m), faceIds, edgeIds);
  return { model: wrap(r.topology), removedFaceIds: r.removedFaceIds };
}

/**
 * Split selected faces and edges out of a model (for groups and components).
 * Edges also used by unselected faces are copied, so both models keep them.
 */
export function extractGeometry(m: Model, faceIds: readonly string[], edgeIds: readonly string[]): { remaining: Model; extracted: Model } {
  const r = extractTopology(data(m), faceIds, edgeIds);
  return { remaining: wrap(r.remaining), extracted: wrap(r.extracted) };
}

/** A copy of the model moved rigidly: points through mapPoint, normals through mapVector. */
export function transformGeometry(m: Model, mapPoint: (p: Point3) => Point3, mapVector: (v: Vec3) => Vec3): Model {
  return wrap(transformTopology(data(m), mapPoint, mapVector));
}

/**
 * Insert `source` (in the target's coordinates) into `target` through the planar
 * engine (exploding a group, copying geometry). Coplanar regions merge.
 */
export function mergeGeometry(target: Model, source: Model): { model: Model; faceIds: string[] } {
  const r = mergeTopology(data(target), data(source));
  return { model: wrap(r.topology), faceIds: r.faceIds };
}

/** Load a saved model: version 2 topology, or a version 1 face-loop model (converted). */
export function deserialize(json: unknown): Model | null {
  const t = deserializeTopology(json);
  return t && wrap(t);
}

/* ---------- read-only queries ---------- */

export const serialize = (m: Model): SerializedTopology => serializeTopology(data(m));
export const listFaces = (m: Model) => q.listFaces(data(m));
export const getFace = (m: Model, id: string) => q.getFace(data(m), id);
export const hasFace = (m: Model, id: string): boolean => data(m).faces.has(id);
export const faceCount = (m: Model) => data(m).faces.size;
export const faceArea = (m: Model, id: string) => q.faceArea(data(m), id);
export const faceTriangles = (m: Model, id: string) => triangles(data(m), id);
export const faceMeshes = (m: Model) => meshes(data(m));
export const listEdges = (m: Model) => q.listEdges(data(m));
export const getEdge = (m: Model, id: string) => q.getEdge(data(m), id);
export const hasEdge = (m: Model, id: string): boolean => data(m).edges.has(id);
export const edgeCount = (m: Model) => data(m).edges.size;
export const edgeLength = (m: Model, id: string) => q.edgeLength(data(m), id);
/** An edge's whole curve, or just the edge: what selecting or erasing it affects. */
export const edgeGroup = (m: Model, id: string) => q.edgeGroup(data(m), id);
export const snapPoints = (m: Model) => q.snapPoints(data(m));
export const bounds = (m: Model) => q.bounds(data(m));
/** Problems with the model's topology; empty when valid. For tests and debugging. */
export const checkModel = (m: Model) => validate(data(m));
/** Corners of a rectangle as drawRectangle would create it; used for previews. */
export const previewRectangle = rectangleCorners;
/** Corners of a circle or polygon as drawRegularPolygon would create it; used for previews. */
export const previewRegularPolygon = regularPolygonPoints;
