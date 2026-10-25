/**
 * Planar operations: inserting segments into a plane (splitting edges where
 * they cross or touch) and rebuilding the faces of a plane from its edges.
 * Every drawing operation (rectangle, line, circle, polygon) and the merge of
 * coplanar faces when an edge is erased go through here.
 */
import earcut from 'earcut';
import { VERTEX_TOLERANCE } from '../precision';
import { add, scale, sub, type Vec3 } from '../vec';
import type { Draft } from './draft';
import {
  onPlane,
  planeBasis,
  planeThrough,
  pointInPolygon,
  pointSegment,
  samePlane,
  segmentCrossing,
  signedArea,
  to2,
  type Basis,
  type Plane,
  type Vec2,
} from './geometry';
import type { CurveId, EdgeId, FaceId, Point3, VertexId } from './types';

const inPlaneEdges = (d: Draft, pl: Plane) =>
  [...d.edges].filter(([, e]) => onPlane(pl, d.point(e.v[0])) && onPlane(pl, d.point(e.v[1])));

/**
 * The vertex at p: an existing one within the tolerance, or a new one. A new
 * vertex that lands on an edge in the plane splits that edge.
 */
export function vertexInPlane(d: Draft, pl: Plane, p: Point3): VertexId {
  const near = d.findVertex(p);
  if (near) return near;
  const b = planeBasis(pl.n);
  const p2 = to2(b, p);
  for (const [id, e] of inPlaneEdges(d, pl)) {
    const r = pointSegment(p2, to2(b, d.point(e.v[0])), to2(b, d.point(e.v[1])));
    if (r.distance <= VERTEX_TOLERANCE && r.t > 0 && r.t < 1) {
      const v = d.addVertex(p);
      d.splitEdge(id, v);
      return v;
    }
  }
  return d.addVertex(p);
}

/**
 * Insert the segment p-q lying in plane pl. Existing edges it crosses are
 * split, vertices it passes through become its vertices, and parts that run
 * along existing edges reuse them. Returns the edges that now make up p-q.
 */
export function insertSegment(
  d: Draft,
  pl: Plane,
  p: Point3,
  q: Point3,
  opts: { soft?: boolean; curve?: CurveId | null } = {},
): EdgeId[] {
  const va = vertexInPlane(d, pl, p);
  const vb = vertexInPlane(d, pl, q);
  if (va === vb) return [];
  const b = planeBasis(pl.n);
  const A = d.point(va);
  const B = d.point(vb);
  const a2 = to2(b, A);
  const b2 = to2(b, B);
  const hits: { t: number; v: VertexId }[] = [
    { t: 0, v: va },
    { t: 1, v: vb },
  ];

  // Vertices the segment passes through.
  for (const [vid, vx] of d.vertices) {
    if (vid === va || vid === vb || !onPlane(pl, vx.p)) continue;
    const r = pointSegment(to2(b, vx.p), a2, b2);
    if (r.distance <= VERTEX_TOLERANCE && r.t > 0 && r.t < 1) hits.push({ t: r.t, v: vid });
  }
  // Edges the segment crosses.
  const crossings: { e: EdgeId; t: number; s: number }[] = [];
  for (const [id, e] of inPlaneEdges(d, pl)) {
    const c = segmentCrossing(a2, b2, to2(b, d.point(e.v[0])), to2(b, d.point(e.v[1])));
    if (c) crossings.push({ e: id, ...c });
  }
  for (const c of crossings) {
    const [e0, e1] = d.edge(c.e).v;
    const X = add(d.point(e0), scale(sub(d.point(e1), d.point(e0)), c.s));
    const v = d.findVertex(X) ?? d.addVertex(X);
    d.splitEdge(c.e, v);
    hits.push({ t: c.t, v });
  }

  hits.sort((x, y) => x.t - y.t);
  const chain = hits.map((h) => h.v).filter((v, i, all) => i === 0 || v !== all[i - 1]);
  const out: EdgeId[] = [];
  for (let i = 0; i + 1 < chain.length; i++) out.push(d.addEdge(chain[i]!, chain[i + 1]!, opts));
  return out;
}

/* ---------- rebuilding the faces of a plane ---------- */

interface HalfEdge {
  from: VertexId;
  to: VertexId;
  edge: EdgeId;
}

/**
 * Trace the boundary cycles of the planar graph: for each half-edge, the face
 * on its left. Bounded regions come out counter-clockwise (positive area).
 */
function traceCycles(edges: { id: EdgeId; a: VertexId; b: VertexId }[], P: (v: VertexId) => Vec2): HalfEdge[][] {
  const out = new Map<VertexId, HalfEdge[]>();
  const halves: HalfEdge[] = [];
  for (const e of edges) {
    for (const h of [
      { from: e.a, to: e.b, edge: e.id },
      { from: e.b, to: e.a, edge: e.id },
    ]) {
      halves.push(h);
      let list = out.get(h.from);
      if (!list) out.set(h.from, (list = []));
      list.push(h);
    }
  }
  const angle = (h: HalfEdge) => {
    const a = P(h.from);
    const b = P(h.to);
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  for (const list of out.values()) list.sort((x, y) => angle(x) - angle(y));
  const next = (h: HalfEdge): HalfEdge => {
    const list = out.get(h.to)!;
    const i = list.findIndex((x) => x.edge === h.edge && x.to === h.from);
    return list[(i - 1 + list.length) % list.length]!;
  };
  const seen = new Set<HalfEdge>();
  const cycles: HalfEdge[][] = [];
  for (const h of halves) {
    if (seen.has(h)) continue;
    const cycle: HalfEdge[] = [];
    let c = h;
    while (!seen.has(c)) {
      seen.add(c);
      cycle.push(c);
      c = next(c);
    }
    cycles.push(cycle);
  }
  return cycles;
}

/** Split a closed vertex walk at repeated vertices into simple cycles. */
function simpleCycles(walk: VertexId[]): VertexId[][] {
  const out: VertexId[][] = [];
  const path: VertexId[] = [];
  const at = new Map<VertexId, number>();
  for (const v of walk) {
    const k = at.get(v);
    if (k !== undefined) {
      const loop = path.splice(k);
      for (const x of loop) at.delete(x);
      if (loop.length >= 3) out.push(loop);
    }
    at.set(v, path.length);
    path.push(v);
  }
  if (path.length >= 3) out.push(path);
  return out;
}

interface Region {
  outer: VertexId[];
  holes: VertexId[][];
  area: number;
}

/** A point strictly inside a region: the centroid of its largest triangle. */
function interiorPoint(r: Region, P: (v: VertexId) => Vec2): Vec2 {
  const pts = [r.outer, ...r.holes].flat().map(P);
  const starts: number[] = [];
  let n = r.outer.length;
  for (const h of r.holes) {
    starts.push(n);
    n += h.length;
  }
  const idx = earcut(pts.flat(), starts, 2);
  let best: Vec2 = pts[0]!;
  let bestArea = -1;
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [pts[idx[i]!]!, pts[idx[i + 1]!]!, pts[idx[i + 2]!]!];
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
    if (area > bestArea) {
      bestArea = area;
      best = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    }
  }
  return best;
}

export interface RebuildResult {
  /** Faces with new ids (new regions and split-off pieces). */
  created: FaceId[];
  /** Ids of faces that existed before and were removed (merged away or no longer covered). */
  removed: FaceId[];
}

/**
 * Recompute the faces of plane pl from the edges lying in it.
 * A region becomes a face when an old face covered it (keeping that face's
 * orientation, and its id for the largest piece) or when one of the `drawn`
 * edges is on its outer boundary (an automatic face, oriented by newNormal).
 * Edges that do not separate regions (loose lines, lines dangling into a face)
 * stay as edges. `merge` lists old faces whose ids should be treated as one
 * owner, and `ignore` lists edges to leave out of the region graph; together
 * they join two faces across an edge that is about to be erased.
 */
export function rebuildPlane(
  d: Draft,
  pl: Plane,
  newNormal: Vec3,
  drawn: ReadonlySet<EdgeId>,
  merge: { into: FaceId; from: FaceId[] } | null = null,
  ignore: ReadonlySet<EdgeId> = new Set(),
): RebuildResult {
  const basis: Basis = planeBasis(pl.n);
  const P = (v: VertexId) => to2(basis, d.point(v));

  const old = [...d.faces]
    .filter(([, f]) => samePlane(planeThrough(f.normal, d.point(f.outer[0]!)), pl))
    .map(([id, f]) => ({ id, normal: f.normal, outer: f.outer.map(P), holes: f.holes.map((h) => h.map(P)) }));
  const ownerId = (id: FaceId) => (merge && merge.from.includes(id) ? merge.into : id);

  // Edges that separate regions: drop, repeatedly, those with the same region on both sides.
  let edges = inPlaneEdges(d, pl)
    .filter(([id]) => !ignore.has(id))
    .map(([id, e]) => ({ id, a: e.v[0], b: e.v[1] }));
  let cycles: HalfEdge[][];
  for (;;) {
    cycles = traceCycles(edges, P);
    const inner = new Set<EdgeId>();
    for (const c of cycles) {
      const seen = new Set<EdgeId>();
      for (const h of c) {
        if (seen.has(h.edge)) inner.add(h.edge);
        seen.add(h.edge);
      }
    }
    if (!inner.size) break;
    edges = edges.filter((e) => !inner.has(e.id));
  }

  const outers: { loop: VertexId[]; area: number; poly: Vec2[] }[] = [];
  const holes: { loop: VertexId[]; area: number }[] = [];
  for (const c of cycles) {
    for (const loop of simpleCycles(c.map((h) => h.from))) {
      const poly = loop.map(P);
      const area = signedArea(poly);
      if (Math.abs(area) <= VERTEX_TOLERANCE * VERTEX_TOLERANCE) continue;
      if (area > 0) outers.push({ loop, area, poly });
      else holes.push({ loop, area: -area });
    }
  }

  const regions: Region[] = outers.map((o) => ({ outer: o.loop, holes: [], area: o.area }));
  for (const h of holes) {
    let best = -1;
    for (let i = 0; i < outers.length; i++) {
      const o = outers[i]!;
      if (o.area <= h.area) continue;
      const own = new Set(o.loop);
      const probe = h.loop.find((v) => !own.has(v));
      if (!probe || !pointInPolygon(P(probe), o.poly)) continue;
      if (best < 0 || o.area < outers[best]!.area) best = i;
    }
    if (best >= 0) {
      regions[best]!.holes.push(h.loop);
      regions[best]!.area -= h.area;
    }
  }

  // Decide which regions are faces, and who owns them.
  const edgeOf = (a: VertexId, b: VertexId) => d.edgeBetween(a, b)!;
  const faces: { region: Region; owner: FaceId | null; normal: Vec3 }[] = [];
  for (const r of regions) {
    const sample = interiorPoint(r, P);
    const owner = old.find((f) => pointInPolygon(sample, f.outer) && !f.holes.some((h) => pointInPolygon(sample, h)));
    const isDrawn = r.outer.some((v, i) => drawn.has(edgeOf(v, r.outer[(i + 1) % r.outer.length]!)));
    if (owner) faces.push({ region: r, owner: ownerId(owner.id), normal: owner.normal });
    else if (isDrawn) faces.push({ region: r, owner: null, normal: newNormal });
  }
  // A merge keeps the orientation of the face it merges into.
  if (merge) {
    const into = old.find((f) => f.id === merge.into);
    if (into) for (const f of faces) if (f.owner === merge.into) f.normal = into.normal;
  }

  const keeps = new Map<FaceId, (typeof faces)[number]>();
  for (const f of faces) {
    if (!f.owner) continue;
    const cur = keeps.get(f.owner);
    if (!cur || f.region.area > cur.region.area) keeps.set(f.owner, f);
  }

  for (const f of old) d.removeFace(f.id);
  const created: FaceId[] = [];
  for (const f of faces) {
    const keepId = f.owner && keeps.get(f.owner) === f ? f.owner : undefined;
    const id = d.addFace(f.normal, f.region.outer, f.region.holes, keepId);
    if (!keepId) created.push(id);
  }
  const kept = new Set(keeps.keys());
  return { created, removed: old.map((f) => f.id).filter((id) => !kept.has(id)) };
}
