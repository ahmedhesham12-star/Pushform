import { VERTEX_TOLERANCE } from './precision';
import { cross, dot, length, normalize, sub, type Vec3 } from './vec';
import { Draft } from './draft';
import { onPlane, planeThrough, samePlane, type Plane } from './geometry';
import { insertSegment, rebuildPlane } from './planar';
import { GROUND, GROUND_NORMAL } from './shapes';
import type { EdgeId, FaceId, Point3, Topology, VertexId } from './types';

export interface LineResult {
  topology: Topology;
  /** Edges that now make up the line (split where it met other geometry). */
  edgeIds: EdgeId[];
  /** Faces created: regions the line closed, and pieces of faces it split. */
  faceIds: FaceId[];
}

const planeOfFace = (d: Draft, f: FaceId): Plane => planeThrough(d.face(f).normal, d.point(d.face(f).outer[0]!));

/** Normal for a new face in a plane with no faces: its largest component points the positive way. */
function defaultNormal(n: Vec3): Vec3 {
  const i = [0, 1, 2].reduce((best, k) => (Math.abs(n[k]!) > Math.abs(n[best]!) ? k : best), 0);
  return n[i]! < 0 ? [-n[0], -n[1], -n[2]] : n;
}

/** The vertex at p in 3D: an existing one, or a new one that splits an edge it lands on. */
export function vertexAt3d(d: Draft, p: Point3): VertexId {
  const near = d.findVertex(p);
  if (near) return near;
  for (const [id, e] of d.edges) {
    const a = d.point(e.v[0]);
    const b = d.point(e.v[1]);
    const ab = sub(b, a);
    const len = length(ab);
    const t = dot(sub(p, a), ab) / (len * len);
    if (t <= 0 || t >= 1) continue;
    const off = length(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
    if (off <= VERTEX_TOLERANCE) {
      const v = d.addVertex(p);
      d.splitEdge(id, v);
      return v;
    }
  }
  return d.addVertex(p);
}

/** Insert a segment that lies in no plane with geometry: through existing vertices on it, no crossings. */
function insertSegment3d(d: Draft, p: Point3, q: Point3): EdgeId[] {
  const va = vertexAt3d(d, p);
  const vb = vertexAt3d(d, q);
  if (va === vb) return [];
  const A = d.point(va);
  const AB = sub(d.point(vb), A);
  const len = length(AB);
  const hits: { t: number; v: VertexId }[] = [
    { t: 0, v: va },
    { t: 1, v: vb },
  ];
  for (const [id, vx] of d.vertices) {
    if (id === va || id === vb) continue;
    const t = dot(sub(vx.p, A), AB) / (len * len);
    if (t <= 0 || t >= 1) continue;
    const off = length(sub(vx.p, [A[0] + AB[0] * t, A[1] + AB[1] * t, A[2] + AB[2] * t]));
    if (off <= VERTEX_TOLERANCE) hits.push({ t, v: id });
  }
  hits.sort((x, y) => x.t - y.t);
  const out: EdgeId[] = [];
  for (let i = 0; i + 1 < hits.length; i++) out.push(d.addEdge(hits[i]!.v, hits[i + 1]!.v));
  return out;
}

/**
 * Draw a straight line from start to end. Where it lies in the ground or in
 * the plane of a face, it splits the edges it crosses and the faces it cuts
 * across. Any planar loop the line closes, together with existing edges,
 * becomes a face (automatic faces).
 */
export function drawLine(t: Topology, start: Point3, end: Point3): LineResult {
  const d = new Draft(t);
  // Planes with geometry that contain the whole line.
  const containing: Plane[] = [];
  const addPlane = (pl: Plane) => {
    if (!containing.some((x) => samePlane(x, pl))) containing.push(pl);
  };
  if (onPlane(GROUND, start) && onPlane(GROUND, end)) addPlane(GROUND);
  for (const f of d.faces.keys()) {
    const pl = planeOfFace(d, f);
    if (onPlane(pl, start) && onPlane(pl, end)) addPlane(pl);
  }

  const drawn = new Set<EdgeId>();
  if (containing.length) {
    for (const pl of containing) for (const e of insertSegment(d, pl, start, end)) drawn.add(e);
  } else {
    for (const e of insertSegment3d(d, start, end)) drawn.add(e);
  }
  if (!drawn.size) return { topology: t, edgeIds: [], faceIds: [] };

  // Planes where the line may close a loop: those containing it, and those it
  // spans with each edge meeting it.
  const dir = normalize(sub(end, start));
  const planes = [...containing];
  const chain = new Set([...drawn].flatMap((e) => d.edge(e).v));
  for (const v of chain) {
    for (const e of d.edgesOf(v)) {
      if (drawn.has(e)) continue;
      const [a, b] = d.edge(e).v;
      const other = d.point(a === v ? b : a);
      const n = cross(dir, sub(other, d.point(v)));
      if (length(n) < 1e-9 * length(sub(other, d.point(v)))) continue;
      const pl = planeThrough(normalize(n), d.point(v));
      if (!planes.some((x) => samePlane(x, pl))) planes.push(pl);
    }
  }

  const created = new Set<FaceId>();
  for (const pl of planes) {
    const existing = [...d.faces.keys()].find((f) => samePlane(planeOfFace(d, f), pl));
    const normal = samePlane(pl, GROUND) ? GROUND_NORMAL : existing ? d.face(existing).normal : defaultNormal(pl.n);
    const r = rebuildPlane(d, pl, normal, drawn);
    for (const f of r.created) created.add(f);
    for (const f of r.removed) created.delete(f);
  }
  return { topology: d.commit(), edgeIds: [...drawn].filter((e) => d.edges.has(e)), faceIds: [...created].filter((f) => d.faces.has(f)) };
}
