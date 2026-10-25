import { Draft } from './draft';
import { planeThrough, samePlane } from './geometry';
import { rebuildPlane } from './planar';
import { faceArea } from './query';
import type { EdgeId, FaceId, Topology, VertexId } from './types';

export interface EraseResult {
  topology: Topology;
  /** Faces that no longer exist (removed, or merged into another face). */
  removedFaceIds: FaceId[];
}

/**
 * Erase faces and edges, following SketchUp:
 * - Erasing a face removes only the face; its edges stay.
 * - Erasing an edge between exactly two coplanar faces merges them (the larger
 *   face keeps its id and orientation). Otherwise every face the edge bounds is
 *   removed with it.
 * - An edge that belongs to a curve erases the whole curve.
 * - Straight vertices left between two edges are healed.
 * Returns the same topology instance when nothing was erased.
 */
export function erase(t: Topology, faceIds: readonly FaceId[], edgeIds: readonly EdgeId[]): EraseResult {
  const d = new Draft(t);
  const before = new Set(t.faces.keys());

  for (const f of faceIds) d.removeFace(f);

  const edges = new Set<EdgeId>();
  for (const e of edgeIds) {
    const curve = d.edges.get(e)?.curve;
    const c = curve ? d.curves.get(curve) : undefined;
    for (const x of c ? c.edges : [e]) if (d.edges.has(x)) edges.add(x);
  }

  const touched = new Set<VertexId>();
  for (const e of edges) {
    if (!d.edges.has(e)) continue;
    for (const v of d.edge(e).v) touched.add(v);
    eraseEdge(d, e);
  }
  for (const v of touched) if (d.vertices.has(v)) d.healVertex(v);

  if (!faceIds.some((f) => t.faces.has(f)) && !edges.size) return { topology: t, removedFaceIds: [] };
  const topology = d.commit();
  return { topology, removedFaceIds: [...before].filter((f) => !topology.faces.has(f)) };
}

function eraseEdge(d: Draft, e: EdgeId): void {
  const faces = d.facesOf(e);
  if (faces.length === 2) {
    const [a, b] = faces as [FaceId, FaceId];
    const fa = d.face(a);
    const fb = d.face(b);
    const pa = planeThrough(fa.normal, d.point(fa.outer[0]!));
    const pb = planeThrough(fb.normal, d.point(fb.outer[0]!));
    if (samePlane(pa, pb)) {
      // A Draft has the shape of a Topology, so queries can read it directly.
      const into = faceArea(d, a) >= faceArea(d, b) ? a : b;
      rebuildPlane(d, pa, fa.normal, new Set(), { into, from: [a, b] }, new Set([e]));
      d.removeEdge(e);
      return;
    }
  }
  for (const f of faces) d.removeFace(f);
  d.removeEdge(e);
}
