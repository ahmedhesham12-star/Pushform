/**
 * Offset, as the Offset tool does: a copy of a face's outer boundary, or of a
 * chain of edges in one plane, at a distance in that plane. Straight edges
 * keep sharp (mitered) corners; circle and polygon edges come out as a new
 * curve with the same segment count around the same center. The new edges go
 * through the planar engine, so an inward offset splits the face into an
 * inner face and a ring, and an outward one closes a ring around it.
 */
import { snapPoint, VERTEX_TOLERANCE } from './precision';
import { add, dot, length, scale, sub, type Vec3 } from './vec';
import { Draft } from './draft';
import {
  onPlane,
  planeBasis,
  planeThrough,
  pointInPolygon,
  pointSegment,
  polygonNormal,
  samePlane,
  segmentCrossing,
  signedArea,
  to2,
  type Basis,
  type Plane,
  type Vec2,
} from './geometry';
import { insertSegment, rebuildPlane } from './planar';
import { GROUND, GROUND_NORMAL } from './shapes';
import type { CurveId, EdgeId, FaceId, Point3, Topology, VertexId } from './types';

export type OffsetError = 'offsetTooLarge' | 'offsetNotChain' | 'noSuchFace';

/** What is offset: points in order (a closed loop is counter-clockwise around the normal), in one plane. */
export interface OffsetPath {
  readonly plane: Plane;
  /** Orientation of new faces, and the side convention: positive distances go to the left, inward for a loop. */
  readonly normal: Vec3;
  readonly points: readonly Point3[];
  readonly closed: boolean;
  /** Curve of each segment (points[i] to points[i + 1]), if it belongs to one. */
  readonly curves: readonly (CurveId | null)[];
  /** The face whose boundary this is, if any; its holes limit an inward offset. */
  readonly faceId: FaceId | null;
}

const key = (a: VertexId, b: VertexId) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** The path to offset: a face's outer loop, or a chain of connected edges in one plane. */
export function offsetPath(t: Topology, faceId: FaceId | null, edgeIds: readonly EdgeId[]): { ok: true; path: OffsetPath } | { ok: false; error: OffsetError } {
  const P = (v: VertexId) => t.vertices.get(v)!.p;
  const byEnds = new Map<string, EdgeId>();
  for (const [id, e] of t.edges) byEnds.set(key(e.v[0], e.v[1]), id);
  const curveOf = (a: VertexId, b: VertexId) => t.edges.get(byEnds.get(key(a, b)) ?? '')?.curve ?? null;

  if (faceId !== null) {
    const f = t.faces.get(faceId);
    if (!f) return { ok: false, error: 'noSuchFace' };
    const loop = f.outer;
    return {
      ok: true,
      path: {
        plane: planeThrough(f.normal, P(loop[0]!)),
        normal: f.normal,
        points: loop.map(P),
        closed: true,
        curves: loop.map((v, i) => curveOf(v, loop[(i + 1) % loop.length]!)),
        faceId,
      },
    };
  }

  // Edges: a single path or loop, each vertex used by at most two of them.
  const edges = [...new Set(edgeIds)].filter((e) => t.edges.has(e));
  if (!edges.length) return { ok: false, error: 'offsetNotChain' };
  const around = new Map<VertexId, EdgeId[]>();
  for (const e of edges) for (const v of t.edges.get(e)!.v) around.set(v, [...(around.get(v) ?? []), e]);
  if ([...around.values()].some((es) => es.length > 2)) return { ok: false, error: 'offsetNotChain' };
  const ends = [...around].filter(([, es]) => es.length === 1).map(([v]) => v);
  if (ends.length !== 0 && ends.length !== 2) return { ok: false, error: 'offsetNotChain' };
  const closed = ends.length === 0;
  let v = closed ? t.edges.get(edges[0]!)!.v[0] : ends[0]!;
  const order: VertexId[] = [v];
  const used = new Set<EdgeId>();
  for (;;) {
    const next = (around.get(v) ?? []).find((e) => !used.has(e));
    if (!next) break;
    used.add(next);
    const [a, b] = t.edges.get(next)!.v;
    v = a === v ? b : a;
    if (closed && v === order[0]) break;
    order.push(v);
  }
  if (used.size !== edges.length) return { ok: false, error: 'offsetNotChain' };

  // The plane: a face's plane holding every point, the ground, or the plane the points span.
  const pts = order.map(P);
  let plane: Plane | null = null;
  let normal: Vec3 | null = null;
  for (const f of t.faces.values()) {
    const pl = planeThrough(f.normal, P(f.outer[0]!));
    if (pts.every((p) => onPlane(pl, p))) {
      plane = pl;
      normal = f.normal;
      break;
    }
  }
  if (!plane && pts.every((p) => onPlane(GROUND, p))) [plane, normal] = [GROUND, GROUND_NORMAL];
  if (!plane) {
    const n = polygonNormal(pts);
    if (!n) return { ok: false, error: 'offsetNotChain' };
    plane = planeThrough(n, pts[0]!);
    if (!pts.every((p) => onPlane(plane!, p))) return { ok: false, error: 'offsetNotChain' };
    normal = n;
  }
  // A closed chain runs counter-clockwise around the normal, so positive distances go inward.
  if (closed && dot(polygonNormal(pts) ?? normal!, normal!) < 0) order.reverse();
  const points = order.map(P);
  const segments = closed ? order.length : order.length - 1;
  const curves = Array.from({ length: segments }, (_, i) => curveOf(order[i]!, order[(i + 1) % order.length]!));
  return { ok: true, path: { plane, normal: normal!, points, closed, curves, faceId: null } };
}

const left = (d: Vec2): Vec2 => [-d[1], d[0]];
const unit2 = (d: Vec2): Vec2 => {
  const l = Math.hypot(d[0], d[1]);
  return [d[0] / l, d[1] / l];
};

/** The path's points in the plane's 2D basis. */
function flat(path: OffsetPath): { basis: Basis; pts: Vec2[]; level: number } {
  const basis = planeBasis(path.normal);
  return { basis, pts: path.points.map((p) => to2(basis, p)), level: dot(path.points[0]!, path.normal) };
}

/**
 * Signed distance from a point (projected into the path's plane) to the path:
 * positive inside a loop or to the left of an open chain, as the offset
 * distance that would pass through the point.
 */
export function offsetDistance(path: OffsetPath, p: Point3): number {
  const { basis, pts } = flat(path);
  const q = to2(basis, p);
  const n = path.closed ? pts.length : pts.length - 1;
  let best = { distance: Infinity, i: 0 };
  for (let i = 0; i < n; i++) {
    const r = pointSegment(q, pts[i]!, pts[(i + 1) % pts.length]!);
    if (r.distance < best.distance) best = { distance: r.distance, i };
  }
  if (path.closed) return pointInPolygon(q, pts) ? best.distance : -best.distance;
  const a = pts[best.i]!;
  const b = pts[best.i + 1]!;
  const side = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
  return side >= 0 ? best.distance : -best.distance;
}

/** The offset points in 2D, or null when the offset would collapse, reverse or cross itself. */
function offsetFlat(pts: readonly Vec2[], closed: boolean, distance: number): Vec2[] | null {
  const n = closed ? pts.length : pts.length - 1;
  const lines = Array.from({ length: n }, (_, i) => {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const dir = unit2([b[0] - a[0], b[1] - a[1]]);
    const off = left(dir);
    return { p: [a[0] + off[0] * distance, a[1] + off[1] * distance] as Vec2, dir, off };
  });
  /** Where offset lines i and j meet; on a straight continuation, the offset point of the shared vertex. */
  const meet = (i: number, j: number, at: Vec2): Vec2 => {
    const A = lines[i]!;
    const B = lines[j]!;
    const den = A.dir[0] * B.dir[1] - A.dir[1] * B.dir[0];
    if (Math.abs(den) < 1e-12) return [at[0] + B.off[0] * distance, at[1] + B.off[1] * distance];
    const s = ((B.p[0] - A.p[0]) * B.dir[1] - (B.p[1] - A.p[1]) * B.dir[0]) / den;
    return [A.p[0] + A.dir[0] * s, A.p[1] + A.dir[1] * s];
  };
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (!closed && i === 0) out.push(lines[0]!.p);
    else if (!closed && i === pts.length - 1) {
      const L = lines[n - 1]!;
      out.push([pts[i]![0] + L.off[0] * distance, pts[i]![1] + L.off[1] * distance]);
    } else out.push(meet((i - 1 + n) % n, i % n, pts[i]!));
  }
  // Every segment keeps its direction and some length; the result does not cross itself.
  const segs = closed ? out.length : out.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = out[i]!;
    const b = out[(i + 1) % out.length]!;
    const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
    if (Math.hypot(d[0], d[1]) <= VERTEX_TOLERANCE || d[0] * lines[i]!.dir[0] + d[1] * lines[i]!.dir[1] <= 0) return null;
  }
  for (let i = 0; i < segs; i++) {
    for (let j = i + 1; j < segs; j++) {
      if (segmentCrossing(out[i]!, out[(i + 1) % out.length]!, out[j]!, out[(j + 1) % out.length]!)) return null;
    }
  }
  if (closed && signedArea(out) <= 0) return null;
  return out;
}

export type OffsetResult =
  | { ok: true; topology: Topology; faceIds: FaceId[]; edgeIds: EdgeId[] }
  | { ok: false; error: OffsetError };

/** Offset a face's outer boundary (faceId) or a chain of edges by a signed distance: positive inward or to the left. */
export function offset(t: Topology, faceId: FaceId | null, edgeIds: readonly EdgeId[], distance: number): OffsetResult {
  const found = offsetPath(t, faceId, edgeIds);
  if (!found.ok) return found;
  const path = found.path;
  const { basis, pts, level } = flat(path);
  const out = offsetFlat(pts, path.closed, distance);
  if (!out) return { ok: false, error: 'offsetTooLarge' };

  // Inward, the new loop must not run across a hole of the face.
  const face = path.faceId ? t.faces.get(path.faceId) : undefined;
  if (face && distance > 0) {
    const holes = face.holes.map((h) => h.map((v) => to2(basis, t.vertices.get(v)!.p)));
    for (const h of holes) {
      for (let i = 0; i < out.length; i++) {
        for (let j = 0; j < h.length; j++) {
          if (segmentCrossing(out[i]!, out[(i + 1) % out.length]!, h[j]!, h[(j + 1) % h.length]!)) return { ok: false, error: 'offsetTooLarge' };
        }
      }
      // A hole partly inside the new loop means crossing too; a loop inside a hole is off the face.
      if (h.some((q) => pointInPolygon(q, out)) && !h.every((q) => pointInPolygon(q, out))) return { ok: false, error: 'offsetTooLarge' };
      if (out.some((q) => pointInPolygon(q, h))) return { ok: false, error: 'offsetTooLarge' };
    }
  }

  const to3 = (q: Vec2): Point3 => snapPoint(add(add(scale(basis.u, q[0]), scale(basis.v, q[1])), scale(path.normal, level)));
  const points = out.map(to3);
  const d = new Draft(t);
  // Each source curve gets one new curve around the same center.
  const newCurves = new Map<CurveId, CurveId>();
  const curveFor = (c: CurveId | null, at: Point3): CurveId | null => {
    if (!c) return null;
    const src = t.curves.get(c);
    if (!src) return null;
    if (!newCurves.has(c)) newCurves.set(c, d.addCurve({ kind: src.kind, segments: src.segments, center: src.center, normal: src.normal, radius: length(sub(at, src.center)) }));
    return newCurves.get(c)!;
  };
  const drawn = new Set<EdgeId>();
  const segs = path.closed ? points.length : points.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const curve = curveFor(path.curves[i] ?? null, a);
    for (const e of insertSegment(d, path.plane, a, b, { curve })) drawn.add(e);
  }
  const created = new Set(rebuildPlane(d, path.plane, path.normal, drawn).created);
  // New edges can also lie in another face's plane (an offset along a wall): rebuild those too.
  for (const f of [...d.faces.values()]) {
    const pl = planeThrough(f.normal, d.point(f.outer[0]!));
    if (samePlane(pl, path.plane)) continue;
    if (![...drawn].some((e) => d.edges.has(e) && d.edge(e).v.every((v) => onPlane(pl, d.point(v))))) continue;
    const r = rebuildPlane(d, pl, f.normal, drawn);
    for (const x of r.created) created.add(x);
    for (const x of r.removed) created.delete(x);
  }
  const topology = d.commit();
  return {
    ok: true,
    topology,
    faceIds: [...created].filter((f) => topology.faces.has(f)),
    edgeIds: [...drawn].filter((e) => topology.edges.has(e)),
  };
}

