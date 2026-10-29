/**
 * Shared topology ("edge uses"): vertices, edges, faces and curves that refer
 * to each other by id. Vertices and edges are shared between faces; a face
 * loop is a cycle of vertex ids and every consecutive pair is an existing edge.
 *
 * Unlike a strict half-edge structure, an edge may bound any number of faces:
 * zero (a loose line), one (an open edge), two, or more (a partition inside a
 * solid). Adjacency (edge to faces, vertex to edges) is derived, not stored.
 *
 * Topologies are immutable. Operations work on a Draft and produce a new
 * Topology that shares unchanged entities with the old one, so undo snapshots
 * stay cheap. All lengths are millimeters.
 */
import type { Vec3 } from './vec';

export type Point3 = Vec3;
export type VertexId = string;
export type EdgeId = string;
export type FaceId = string;
export type CurveId = string;

export interface Vertex {
  readonly p: Point3;
}

export interface Edge {
  readonly v: readonly [VertexId, VertexId];
  /** Hidden in the default style; faces across it are shaded smoothly. */
  readonly soft: boolean;
  /** Curve this edge is a segment of, if any. */
  readonly curve: CurveId | null;
}

export interface Face {
  /** Unit normal; the front side. */
  readonly normal: Vec3;
  /** Counter-clockwise around the normal. */
  readonly outer: readonly VertexId[];
  /** Clockwise around the normal. */
  readonly holes: readonly (readonly VertexId[])[];
  /** What each side is painted with; absent when neither is. */
  readonly paint?: Paint;
}

/**
 * Paint on a face's front and back: material ids, opaque to the kernel (as
 * curve ids are to the scene). Paint follows the face through edits: pieces
 * of a split keep it, a merge keeps the larger face's, and push/pull walls
 * take the pushed face's (all checked in SketchUp).
 */
export interface Paint {
  readonly front?: string;
  readonly back?: string;
}

export type FaceSide = 'front' | 'back';

export type CurveKind = 'circle' | 'polygon' | 'arc';

/**
 * Edges drawn as one shape (a circle, a polygon, later an arc). They are
 * selected and erased together. `segments` is the edge count the shape was
 * drawn with; `edges` can hold more when segments were split by other geometry.
 */
export interface Curve {
  readonly kind: CurveKind;
  readonly edges: readonly EdgeId[];
  readonly segments: number;
  readonly center: Point3;
  readonly normal: Vec3;
  /** Absent once a non-uniform scale has made a circle or arc an ellipse. */
  readonly radius?: number;
}

/** A curve's radius field, left out when it has none. */
export const withRadius = (radius: number | undefined): { radius?: number } => (radius === undefined ? {} : { radius });

/** A face's paint field, left out when neither side is painted. */
export const paintField = (p: Paint | undefined): { paint?: Paint } =>
  p && (p.front || p.back) ? { paint: { ...(p.front ? { front: p.front } : {}), ...(p.back ? { back: p.back } : {}) } } : {};

/**
 * Paint for a face facing `to` that takes it from a face facing `from` in the
 * same plane: the same sides when they face the same way, swapped when not,
 * so each color stays on the side of the plane it was on.
 */
export function orientPaint(p: Paint | undefined, from: readonly number[], to: readonly number[]): Paint | undefined {
  if (!p || from[0]! * to[0]! + from[1]! * to[1]! + from[2]! * to[2]! >= 0) return p;
  return { ...(p.back ? { front: p.back } : {}), ...(p.front ? { back: p.front } : {}) };
}

export interface Topology {
  readonly vertices: ReadonlyMap<VertexId, Vertex>;
  readonly edges: ReadonlyMap<EdgeId, Edge>;
  readonly faces: ReadonlyMap<FaceId, Face>;
  readonly curves: ReadonlyMap<CurveId, Curve>;
  /** Next id number; one counter for all entity kinds. */
  readonly next: number;
}

export function emptyTopology(): Topology {
  return { vertices: new Map(), edges: new Map(), faces: new Map(), curves: new Map(), next: 1 };
}
