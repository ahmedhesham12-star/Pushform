/**
 * Moving, rotating, scaling and mirroring loose geometry, as the Move, Rotate
 * and Scale tools and Flip do. The selected faces and edges go through an
 * affine map with their vertices;
 * geometry made only of moving vertices goes along. Geometry connected to the
 * selection stretches; a stretched face bent out of its plane folds into flat
 * pieces, as in SketchUp. A move that would turn a face over or run it into
 * other geometry is refused.
 */
import { EPSILON, VERTEX_TOLERANCE, snapPoint } from './precision';
import { add, cleanNormal, dot, length, normalize, sub, type Vec3 } from './vec';
import { Draft } from './draft';
import { onPlane, planeThrough, polygonNormal, samePlane, type Plane } from './geometry';
import { extract, merge, placeCurve, transformTopology, type PlaceOptions } from './assembly';
import { foldFace } from './fold';
import { faceShapeProblems, planeProblems } from './validate';
import { GROUND } from './shapes';
import type { EdgeId, FaceId, Point3, Topology, VertexId } from './types';

/** moveCrosses: a face would turn over or run into other geometry; tooSmall: an edge would shrink to nothing. */
export type MoveError = 'moveCrosses' | 'tooSmall';

export type MoveResult =
  | {
      ok: true;
      topology: Topology;
      /** The moved faces and edges in the result (their ids change when the move merged them). */
      faceIds: FaceId[];
      edgeIds: EdgeId[];
    }
  | { ok: false; error: MoveError };

/**
 * Where points go, and face normals (the inverse transpose, for a scale). A
 * mirror reverses the loops of faces that move whole; see PlaceOptions.
 */
export interface AffineMap extends PlaceOptions {
  readonly mapPoint: (p: Point3) => Point3;
  readonly mapNormal: (v: Vec3) => Vec3;
}

export function moveGeometry(
  t: Topology,
  faceIds: readonly FaceId[],
  edgeIds: readonly EdgeId[],
  vector: Vec3,
  vertexIds: readonly VertexId[] = [],
): MoveResult {
  return transformSelection(t, faceIds, edgeIds, { mapPoint: (p) => add(p, vector), mapNormal: (v) => v }, vertexIds);
}

/** Faces, edges and single vertices (a corner moved on its own) through an affine map. */
export function transformSelection(
  t: Topology,
  faceIds: readonly FaceId[],
  edgeIds: readonly EdgeId[],
  map: AffineMap,
  vertexIds: readonly VertexId[] = [],
): MoveResult {
  const d = new Draft(t);
  const moving = new Set<VertexId>(vertexIds.filter((v) => t.vertices.has(v)));
  for (const f of faceIds) {
    const face = t.faces.get(f);
    if (face) for (const v of [face.outer, ...face.holes].flat()) moving.add(v);
  }
  for (const e of edgeIds) for (const v of t.edges.get(e)?.v ?? []) moving.add(v);
  const target = new Map([...moving].map((v) => [v, snapPoint(map.mapPoint(t.vertices.get(v)!.p))] as const));
  // A mirror changes orientation even when every point stays (a flat face flipped along its normal).
  if (!moving.size || (!map.mirror && [...moving].every((v) => length(sub(target.get(v)!, t.vertices.get(v)!.p)) < EPSILON))) {
    return { ok: true, topology: t, faceIds: faceIds.filter((f) => t.faces.has(f)), edgeIds: edgeIds.filter((e) => t.edges.has(e)) };
  }

  // Everything made only of moving vertices moves rigidly; edges with one moving end stretch.
  const rigidFaces = [...t.faces].filter(([, f]) => [f.outer, ...f.holes].flat().every((v) => moving.has(v))).map(([id]) => id);
  const rigidEdges: EdgeId[] = [];
  const stretched: EdgeId[] = [];
  for (const [id, e] of t.edges) {
    const n = e.v.filter((v) => moving.has(v)).length;
    if (n === 2) rigidEdges.push(id);
    else if (n === 1) stretched.push(id);
  }
  // A scale that shrinks an edge to nothing would need its ends merged.
  for (const e of rigidEdges) {
    const [a, b] = t.edges.get(e)!.v.map((v) => target.get(v)!);
    if (length(sub(a!, b!)) <= VERTEX_TOLERANCE) return { ok: false, error: 'tooSmall' };
  }
  // Free only when no edge and no other face (a hole around it, for one) holds on to a moving vertex.
  const rigidSet = new Set(rigidFaces);
  const held = [...t.faces].some(([id, f]) => !rigidSet.has(id) && [f.outer, ...f.holes].flat().some((v) => moving.has(v)));
  if (!stretched.length && !held) return moveIsland(t, d, target, rigidFaces, rigidEdges, map);

  applyRigid(d, target, rigidFaces, rigidEdges, map);
  // A stretched point landing on another point would need the two merged: not supported, so refused.
  if ([...moving].some((v) => landsOnOther(d, v))) return { ok: false, error: 'moveCrosses' };
  for (const e of stretched) {
    const [a, b] = d.edge(e).v;
    if (length(sub(d.point(a), d.point(b))) <= VERTEX_TOLERANCE) return { ok: false, error: 'moveCrosses' };
  }

  // Stretched faces keep their orientation and take their new plane's normal; bent ones fold into flat pieces.
  const touched = new Set<FaceId>();
  for (const v of moving) for (const f of d.facesOfVertex(v)) touched.add(f);
  const folds: EdgeId[] = [];
  for (const f of [...touched]) {
    if (rigidSet.has(f)) continue;
    const face = d.face(f);
    const n = polygonNormal(face.outer.map((v) => d.point(v)));
    const plane = n && planeThrough(n, d.point(face.outer[0]!));
    if (plane && [face.outer, ...face.holes].flat().every((v) => onPlane(plane, d.point(v)))) {
      if (dot(n, face.normal) <= 0) return { ok: false, error: 'moveCrosses' };
      d.setFace(f, { ...face, normal: cleanNormal(n) });
      continue;
    }
    const fold = foldFace(d, t, f);
    if (!fold) return { ok: false, error: 'moveCrosses' };
    for (const p of fold.faceIds) touched.add(p);
    folds.push(...fold.edgeIds);
  }

  // A hole moved out of the face around it (in one jump, so no edges cross) is refused too.
  if ([...touched].some((f) => faceShapeProblems(d, f).length)) return { ok: false, error: 'moveCrosses' };
  if (conflicts(d, touched, [...rigidEdges, ...stretched, ...folds], moving)) return { ok: false, error: 'moveCrosses' };
  const topology = d.commit();
  return { ok: true, topology, faceIds: faceIds.filter((f) => topology.faces.has(f)), edgeIds: edgeIds.filter((e) => topology.edges.has(e)) };
}

/**
 * Move the vertices to their targets, and place the faces and curves that move
 * whole: normals turned, loops reversed under a mirror, radii scaled.
 */
function applyRigid(d: Draft, target: ReadonlyMap<VertexId, Point3>, faces: readonly FaceId[], edges: readonly EdgeId[], map: AffineMap): void {
  const unit = (v: Vec3) => cleanNormal(normalize(map.mapNormal(v)));
  const reversed = (loop: readonly VertexId[]) => (map.mirror ? [...loop].reverse() : loop);
  for (const [v, p] of target) d.moveVertex(v, p);
  for (const f of faces) {
    const face = d.face(f);
    d.setFace(f, { normal: unit(face.normal), outer: reversed(face.outer), holes: face.holes.map(reversed) });
  }
  const moved = new Set(edges);
  for (const [id, c] of d.curves) {
    if (c.edges.length && c.edges.every((e) => moved.has(e))) d.curves.set(id, placeCurve(c, map.mapPoint, unit, map));
  }
}

/**
 * Geometry not connected to anything else. It moves in place, keeping its ids,
 * unless it lands on other geometry; then it is taken out and merged back at
 * its new place, so points landing on points join and coplanar faces merge.
 */
function moveIsland(
  t: Topology,
  d: Draft,
  target: ReadonlyMap<VertexId, Point3>,
  faceIds: FaceId[],
  edgeIds: EdgeId[],
  map: AffineMap,
): MoveResult {
  applyRigid(d, target, faceIds, edgeIds, map);
  if (![...target.keys()].some((v) => landsOnOther(d, v)) && !conflicts(d, new Set(faceIds), edgeIds, target.keys())) {
    return { ok: true, topology: d.commit(), faceIds, edgeIds };
  }
  const x = extract(t, faceIds, edgeIds);
  const r = merge(x.remaining, transformTopology(x.extracted, map.mapPoint, map.mapNormal, map));
  return { ok: true, topology: r.topology, faceIds: r.faceIds, edgeIds: r.edgeIds };
}

/** Whether another vertex lies within the tolerance of v (findVertex may return v itself on a tie). */
function landsOnOther(d: Draft, v: VertexId): boolean {
  const p = d.point(v);
  for (const [id, x] of d.vertices) if (id !== v && length(sub(x.p, p)) <= VERTEX_TOLERANCE) return true;
  return false;
}

/**
 * Whether the planes of the given faces, or any face plane (or the ground)
 * holding one of the given edges or moved vertices, break the planar
 * invariants. A moved point can land inside an edge that stayed put.
 */
function conflicts(d: Draft, faces: ReadonlySet<FaceId>, edges: readonly EdgeId[], vertices: Iterable<VertexId>): boolean {
  const planes: Plane[] = [];
  const addPlane = (pl: Plane) => {
    if (!planes.some((x) => samePlane(x, pl))) planes.push(pl);
  };
  for (const f of faces) addPlane(planeThrough(d.face(f).normal, d.point(d.face(f).outer[0]!)));
  const candidates = [GROUND, ...[...d.faces.values()].map((f) => planeThrough(f.normal, d.point(f.outer[0]!)))];
  for (const e of edges) {
    if (!d.edges.has(e)) continue;
    const [a, b] = d.edge(e).v.map((v) => d.point(v));
    for (const pl of candidates) if (onPlane(pl, a!) && onPlane(pl, b!)) addPlane(pl);
  }
  for (const v of vertices) {
    const p = d.point(v);
    for (const pl of candidates) if (onPlane(pl, p)) addPlane(pl);
  }
  return planes.some((pl) => planeProblems(d, pl).length > 0);
}
