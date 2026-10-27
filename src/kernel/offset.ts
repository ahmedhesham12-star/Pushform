/**
 * Offset, as the Offset tool does: a copy of a face's loops (its outer
 * boundary and its holes), or of a chain of edges in one plane, at a distance
 * in that plane. An inward offset shrinks the outer boundary and grows the
 * holes; an outward one does the opposite. Straight edges keep sharp
 * (mitered) corners; circle and polygon edges come out as a new curve with
 * the same segment count around the same center. The new edges go through
 * the planar engine, so the face splits into the offset face and rings.
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
import { insertSegment, rebuildPlane, type RegionRule } from './planar';
import { GROUND, GROUND_NORMAL } from './shapes';
import { withRadius, type CurveId, type EdgeId, type FaceId, type Point3, type Topology, type VertexId } from './types';

export type OffsetError = 'offsetTooLarge' | 'offsetNotChain' | 'noSuchFace';

/** A loop or chain of points, with the curve of each segment (points[i] to points[i + 1]), if any. */
export interface OffsetLoop {
  readonly points: readonly Point3[];
  readonly curves: readonly (CurveId | null)[];
}

/**
 * What is offset, in one plane: a main loop or chain (a closed loop is
 * counter-clockwise around the normal) and, for a face, its holes (clockwise).
 * Positive distances go to the left of every loop: into the face.
 */
export interface OffsetPath extends OffsetLoop {
  readonly plane: Plane;
  /** Orientation of new faces, and the side convention. */
  readonly normal: Vec3;
  readonly closed: boolean;
  readonly holes: readonly OffsetLoop[];
  /** The face whose loops these are, if any. */
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
    const asLoop = (loop: readonly VertexId[]): OffsetLoop => ({
      points: loop.map(P),
      curves: loop.map((v, i) => curveOf(v, loop[(i + 1) % loop.length]!)),
    });
    return {
      ok: true,
      path: { plane: planeThrough(f.normal, P(f.outer[0]!)), normal: f.normal, ...asLoop(f.outer), closed: true, holes: f.holes.map(asLoop), faceId },
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
  return { ok: true, path: { plane, normal: normal!, points, closed, curves, holes: [], faceId: null } };
}

const left = (d: Vec2): Vec2 => [-d[1], d[0]];
const unit2 = (d: Vec2): Vec2 => {
  const l = Math.hypot(d[0], d[1]);
  return [d[0] / l, d[1] / l];
};

/** The path's loops in the plane's 2D basis: the main one first, then the holes. */
function flat(path: OffsetPath): { basis: Basis; loops: Vec2[][]; level: number } {
  const basis = planeBasis(path.normal);
  const loops = [path, ...path.holes].map((l) => l.points.map((p) => to2(basis, p)));
  return { basis, loops, level: dot(path.points[0]!, path.normal) };
}

/** Whether a 2D point is inside a face with these loops (inside the outer one, outside every hole). */
const insideLoops = (q: Vec2, loops: readonly Vec2[][]) => pointInPolygon(q, loops[0]!) && !loops.slice(1).some((h) => pointInPolygon(q, h));

/**
 * Signed distance from a point (projected into the path's plane) to the
 * nearest loop: positive inside the face (or to the left of an open chain),
 * as the offset distance that would pass through the point.
 */
export function offsetDistance(path: OffsetPath, p: Point3): number {
  const { basis, loops } = flat(path);
  const q = to2(basis, p);
  let best = { distance: Infinity, a: q, b: q };
  loops.forEach((pts, k) => {
    const n = path.closed || k > 0 ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const r = pointSegment(q, a, b);
      if (r.distance < best.distance) best = { distance: r.distance, a, b };
    }
  });
  if (path.closed) return insideLoops(q, loops) ? best.distance : -best.distance;
  const { a, b } = best;
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
  // A closed loop keeps its winding (counter-clockwise outer loops, clockwise holes).
  if (closed && signedArea(out) * Math.sign(signedArea(pts)) <= 0) return null;
  return out;
}

export type OffsetResult =
  | { ok: true; topology: Topology; faceIds: FaceId[]; edgeIds: EdgeId[] }
  | { ok: false; error: OffsetError };

/** Whether two closed loops cross or touch (a vertex of one on an edge of the other). */
function loopsMeet(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  const segs = (l: readonly Vec2[]) => l.map((p, i) => [p, l[(i + 1) % l.length]!] as const);
  for (const [p, q] of segs(a)) for (const [r, s] of segs(b)) if (segmentCrossing(p, q, r, s)) return true;
  const touches = (pts: readonly Vec2[], other: readonly Vec2[]) =>
    pts.some((p) => segs(other).some(([r, s]) => pointSegment(p, r, s).distance <= VERTEX_TOLERANCE));
  return touches(a, b) || touches(b, a);
}

/**
 * Offset a face's loops (faceId) or a chain of edges by a signed distance:
 * positive into the face (the outer loop shrinks, holes grow) or to the left
 * of a chain. Refused when a loop would collapse, or loops would cross or touch.
 */
export function offset(t: Topology, faceId: FaceId | null, edgeIds: readonly EdgeId[], distance: number): OffsetResult {
  const found = offsetPath(t, faceId, edgeIds);
  if (!found.ok) return found;
  const path = found.path;
  const { basis, loops, level } = flat(path);
  const outs: Vec2[][] = [];
  for (const [k, pts] of loops.entries()) {
    const out = offsetFlat(pts, path.closed || k > 0, distance);
    if (!out) return { ok: false, error: 'offsetTooLarge' };
    outs.push(out);
  }
  // The new holes stay inside the new outer loop, apart from it and from each other.
  for (let i = 1; i < outs.length; i++) {
    if (!pointInPolygon(outs[i]![0]!, outs[0]!)) return { ok: false, error: 'offsetTooLarge' };
    for (let j = 0; j < i; j++) {
      if (loopsMeet(outs[i]!, outs[j]!)) return { ok: false, error: 'offsetTooLarge' };
      if (j > 0 && (pointInPolygon(outs[i]![0]!, outs[j]!) || pointInPolygon(outs[j]![0]!, outs[i]!))) return { ok: false, error: 'offsetTooLarge' };
    }
  }

  const to3 = (q: Vec2): Point3 => snapPoint(add(add(scale(basis.u, q[0]), scale(basis.v, q[1])), scale(path.normal, level)));
  const d = new Draft(t);
  // Each source curve gets one new curve around the same center.
  const newCurves = new Map<CurveId, CurveId>();
  const curveFor = (c: CurveId | null, at: Point3): CurveId | null => {
    if (!c) return null;
    const src = t.curves.get(c);
    if (!src) return null;
    if (!newCurves.has(c)) newCurves.set(c, d.addCurve({ kind: src.kind, segments: src.segments, center: src.center, normal: src.normal, ...withRadius(src.radius === undefined ? undefined : length(sub(at, src.center))) }));
    return newCurves.get(c)!;
  };
  const drawn = new Set<EdgeId>();
  [path, ...path.holes].forEach((loop, k) => {
    const points = outs[k]!.map(to3);
    const segs = path.closed || k > 0 ? points.length : points.length - 1;
    for (let i = 0; i < segs; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      const curve = curveFor(loop.curves[i] ?? null, a);
      for (const e of insertSegment(d, path.plane, a, b, { curve })) drawn.add(e);
    }
  });
  // For a face, every region of the offset shape is a face, also a ring inside a hole that shrank;
  // the new holes stay open.
  const rule: RegionRule | undefined = path.faceId
    ? (sample, covers) => {
        if (covers.length) return undefined;
        if (insideLoops(sample, outs)) return { owner: null, normal: path.normal };
        return pointInPolygon(sample, outs[0]!) ? { drop: true } : undefined;
      }
    : undefined;
  const created = new Set(rebuildPlane(d, path.plane, path.normal, drawn, null, new Set(), rule).created);
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

