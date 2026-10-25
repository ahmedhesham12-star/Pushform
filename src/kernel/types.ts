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
}

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
  readonly radius: number;
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
