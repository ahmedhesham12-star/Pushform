import { CLAMP_MARGIN, EPSILON } from './precision';
import { add, cross, dot, negate, normalize, scale, sub, type Vec3 } from './vec';
import { Draft } from './draft';
import { parallel, planeBasis, planeThrough, pointInPolygon, samePlane, to2, type Plane, type Vec2 } from './geometry';
import { vertexAt3d } from './lines';
import { insertSegment, rebuildPlane, type RegionRule } from './planar';
import { faceTriangles } from './triangulate';
import type { CurveId, EdgeId, FaceId, Point3, Topology, VertexId } from './types';

export interface PushPullResult {
  topology: Topology;
  /** Distance actually applied after clamping, in mm. 0 means nothing changed. */
  distance: number;
  /** Faces created: walls, the bottom left behind by a lone face, pieces of split faces. */
  createdFaceIds: FaceId[];
  /** Faces removed: cut away by the push (a notch or a push through), or merged. */
  removedFaceIds: FaceId[];
}

/** Normals with |dot| below this are perpendicular: the face contains the push direction. */
const PERPENDICULAR = 1e-6;

interface Wall {
  /** Corners in order: the edge's ends a and b, then their moved positions b' and a'. */
  points: [Point3, Point3, Point3, Point3];
  normal: Vec3;
  plane: Plane;
}

/**
 * Move a face along its normal by `requested` mm.
 *
 * A vertex of the face moves (stretching the faces around it) only when every
 * other edge at it is parallel to the push direction and the face's edges at
 * it can stretch. Every other edge of the face gets a wall, built through the
 * planar engine in the wall's plane:
 * - where the wall overlaps an existing face and the push carves into the
 *   solid, that part of the face is cut away (a notch or a slot);
 * - where the push adds to the solid next to an existing face, that face stays
 *   as the shared face;
 * - elsewhere the wall becomes a new face. A new wall coplanar with the face
 *   beside it merges into it.
 * The moved face lands in its target plane the same way: on a back-to-back
 * face of the same solid both are cut away (a push through), on a face with
 * the same orientation they merge.
 *
 * Only a lone face (sharing no edge) leaves a bottom behind. Walls between
 * consecutive circle or arc segments are joined by soft edges, so a pushed
 * circle shades like a cylinder; polygons stay faceted. The distance is
 * clamped so stretched faces never collapse and the face stops at the first
 * parallel face of the same solid ahead of it.
 *
 * Returns the input unchanged when the face is missing or the distance is 0.
 */
export function pushPull(t: Topology, faceId: FaceId, requested: number): PushPullResult {
  return push(t, faceId, requested, true);
}

function push(t: Topology, faceId: FaceId, requested: number, stretch: boolean): PushPullResult {
  const none = { topology: t, distance: 0, createdFaceIds: [], removedFaceIds: [] };
  const F = t.faces.get(faceId);
  if (!F || Math.abs(requested) < EPSILON) return none;
  const d = new Draft(t);
  const n = F.normal;
  const loops = [F.outer, ...F.holes];
  const P = (v: VertexId) => d.point(v);
  const other = (fs: FaceId[]) => fs.filter((f) => f !== faceId);
  const isPerp = (f: FaceId) => Math.abs(dot(d.face(f).normal, n)) < PERPENDICULAR;

  // Edges of the face, in loop order.
  const steps: { a: VertexId; b: VertexId; e: EdgeId }[] = [];
  for (const loop of loops) loop.forEach((a, i) => steps.push({ a, b: loop[(i + 1) % loop.length]!, e: d.edgeBetween(a, loop[(i + 1) % loop.length]!)! }));
  const faceEdges = new Set(steps.map((s) => s.e));
  const fvs = new Set(loops.flat());
  const free = steps.every((s) => other(d.facesOf(s.e)).length === 0);

  // Which vertices move and which edges stretch: shrink to a fixed point.
  const alongPush = (e: EdgeId) => {
    const [p, q] = d.edge(e).v;
    return Math.abs(dot(normalize(sub(P(q), P(p))), n)) > 1 - 1e-9;
  };
  const movable = new Set(free || !stretch ? [] : [...fvs].filter((v) => d.edgesOf(v).every((e) => faceEdges.has(e) || alongPush(e))));
  const stretchable = new Set(
    free || !stretch
      ? []
      : steps.filter((s) => {
          const os = other(d.facesOf(s.e));
          return os.length > 0 && os.every(isPerp);
        }).map((s) => s.e),
  );
  for (let changed = true; changed; ) {
    changed = false;
    for (const s of steps) {
      if (stretchable.has(s.e) && !(movable.has(s.a) && movable.has(s.b))) {
        stretchable.delete(s.e);
        changed = true;
      }
      if (!stretchable.has(s.e)) for (const v of [s.a, s.b]) if (movable.delete(v)) changed = true;
    }
  }

  // Clamp: stretched edges and faces must not collapse.
  let lo = -Infinity;
  let hi = Infinity;
  const limit = (ext: number) => {
    if (ext > EPSILON) hi = Math.min(hi, ext - CLAMP_MARGIN);
    else if (ext < -EPSILON) lo = Math.max(lo, ext + CLAMP_MARGIN);
  };
  for (const v of movable) {
    for (const e of d.edgesOf(v)) {
      if (faceEdges.has(e)) continue;
      const [p, q] = d.edge(e).v;
      const w = p === v ? q : p;
      if (!movable.has(w)) limit(dot(sub(P(w), P(v)), n));
    }
  }
  for (const s of steps) {
    if (!stretchable.has(s.e)) continue;
    for (const g of other(d.facesOf(s.e))) {
      for (const v of [d.face(g).outer, ...d.face(g).holes].flat()) if (!movable.has(v)) limit(dot(sub(P(v), P(s.a)), n));
    }
  }
  let distance = Math.min(hi, Math.max(lo, requested));
  // Stop at the first parallel face of the same solid ahead; landing on it pushes through.
  const ahead = oppositeFace(d, faceId, Math.sign(requested));
  if (ahead && Math.abs(requested) >= Math.abs(ahead.offset) - EPSILON) {
    if (Math.abs(distance) >= Math.abs(ahead.offset) - EPSILON) distance = ahead.offset;
    else if (stretch && !ahead.coversAll && Math.abs(ahead.offset) - Math.abs(distance) <= CLAMP_MARGIN + EPSILON) {
      // Only stretching keeps the face from cutting through (re-pushing a slot to the bottom):
      // build walls instead, so the stretched faces are cut rather than collapsed.
      return push(t, faceId, requested, false);
    }
  }
  if (Math.abs(distance) < EPSILON) return none;

  const off = scale(n, distance);
  const inward = !free && distance < 0;
  const newN = free && distance < 0 ? negate(n) : n;
  const created = new Set<FaceId>();
  const removed = new Set<FaceId>();
  const record = (r: { created: FaceId[]; removed: FaceId[] }) => {
    for (const f of r.created) created.add(f);
    for (const f of r.removed) {
      removed.add(f);
      created.delete(f);
    }
  };

  // Rails between circle or arc segments are soft.
  const smoothAt = (v: VertexId): boolean => {
    const at = steps.filter((s) => s.a === v || s.b === v).map((s) => d.edge(s.e).curve);
    const c = at.length === 2 && at[0] && at[0] === at[1] ? d.curves.get(at[0]) : undefined;
    return !!c && c.kind !== 'polygon';
  };
  const softRails = new Set([...fvs].filter((v) => !movable.has(v) && smoothAt(v)));

  // Bottom of a lone face, before anything moves.
  if (free) created.add(d.addFace(distance > 0 ? negate(n) : n, F.outer, F.holes));

  // Move what stretches; give every other vertex a moved copy (splitting any edge it lands on).
  const targets = new Map([...fvs].map((v) => [v, add(P(v), off)] as const));
  for (const v of movable) d.moveVertex(v, targets.get(v)!);
  const moved = new Map<VertexId, VertexId>();
  for (const v of fvs) moved.set(v, movable.has(v) ? v : vertexAt3d(d, targets.get(v)!));
  const newLoops = loops.map((l) => l.map((v) => moved.get(v)!));

  // Walls, grouped by plane.
  const walls: Wall[] = [];
  for (const s of steps) {
    if (stretchable.has(s.e)) continue;
    const pa = P(s.a);
    const pb = P(s.b);
    const normal = normalize(cross(sub(pb, pa), free ? n : off));
    walls.push({ points: [pa, pb, P(moved.get(s.b)!), P(moved.get(s.a)!)], normal, plane: planeThrough(normal, pa) });
  }
  const touchedEdges = new Set<EdgeId>(faceEdges);
  const curveCopies = new Map<CurveId, CurveId>();
  const copyCurve = (c: CurveId) => {
    let copy = curveCopies.get(c);
    if (!copy) {
      const src = d.curves.get(c)!;
      copy = d.addCurve({ kind: src.kind, segments: src.segments, center: add(src.center, off), normal: src.normal, radius: src.radius });
      curveCopies.set(c, copy);
    }
    return copy;
  };
  // Edges of the moved face: the new edge for each wall, with a copy of its curve.
  steps.forEach((s) => {
    if (stretchable.has(s.e)) return;
    const c = d.edges.get(s.e)?.curve;
    const a2 = moved.get(s.a)!;
    const b2 = moved.get(s.b)!;
    const pl = planeThrough(normalize(cross(sub(P(b2), P(a2)), n)), P(a2));
    for (const e of insertSegment(d, pl, P(a2), P(b2))) {
      touchedEdges.add(e);
      if (c) d.assignCurve(e, copyCurve(c));
    }
  });

  const groups: { plane: Plane; walls: Wall[] }[] = [];
  for (const w of walls) {
    const g = groups.find((x) => samePlane(x.plane, w.plane));
    if (g) g.walls.push(w);
    else groups.push({ plane: w.plane, walls: [w] });
  }
  for (const { plane, walls: ws } of groups) {
    for (const w of ws) {
      const [pa, pb, pb2, pa2] = w.points;
      for (const [p, q] of [
        [pb, pb2],
        [pb2, pa2],
        [pa2, pa],
      ] as const) {
        for (const e of insertSegment(d, plane, p, q)) touchedEdges.add(e);
      }
    }
    const basis = planeBasis(plane.n);
    const quads = ws.map((w) => ({ poly: w.points.map((p) => to2(basis, p)), normal: w.normal }));
    const rule: RegionRule = (sample, covers) => {
      const q = quads.find((x) => pointInPolygon(sample, x.poly));
      if (!q) return undefined;
      if (!covers.length) return { owner: null, normal: q.normal };
      // Carving into the solid cuts the covered face away; adding beside it keeps the face as the shared one.
      if (inward) return { drop: true };
      return { owner: covers[0]!, normal: d.face(covers[0]!).normal };
    };
    record(rebuildPlane(d, plane, n, new Set(), null, new Set(), rule));
  }
  for (const v of softRails) {
    const e = d.edgeBetween(v, moved.get(v)!);
    if (e) d.setEdge(e, { soft: true });
  }

  // Land the moved face in its target plane.
  const target = planeThrough(newN, P(newLoops[0]![0]!));
  for (const loop of newLoops) {
    loop.forEach((v, i) => {
      for (const e of insertSegment(d, target, P(v), P(loop[(i + 1) % loop.length]!))) touchedEdges.add(e);
    });
  }
  d.removeFace(faceId);
  const tb = planeBasis(target.n);
  const landed = { outer: newLoops[0]!.map((v) => to2(tb, P(v))), holes: newLoops.slice(1).map((h) => h.map((v) => to2(tb, P(v)))) };
  const inLanded = (p: Vec2) => pointInPolygon(p, landed.outer) && !landed.holes.some((h) => pointInPolygon(p, h));
  const landRule: RegionRule = (sample, covers) => {
    if (!inLanded(sample)) return undefined;
    // Back-to-back with a face of the same solid: both go (a push through).
    if (covers.some((c) => dot(d.face(c).normal, newN) < 0)) return { drop: true };
    if (covers.length) return { owner: covers[0]!, normal: d.face(covers[0]!).normal };
    return { owner: null, normal: newN, id: faceId };
  };
  record(rebuildPlane(d, target, newN, new Set(), null, new Set(), landRule));

  // A new wall coplanar with the face beside it, with the same orientation, merges into it.
  for (const s of steps) {
    if (!d.edges.has(s.e)) continue;
    const fs = d.facesOf(s.e);
    if (fs.length !== 2) continue;
    const [x, y] = fs as [FaceId, FaceId];
    const wall = created.has(x) ? x : created.has(y) ? y : null;
    if (!wall) continue;
    const g = wall === x ? y : x;
    const pw = planeOf(d, wall);
    if (!samePlane(pw, planeOf(d, g)) || dot(d.face(wall).normal, d.face(g).normal) <= 0) continue;
    record(rebuildPlane(d, pw, d.face(g).normal, new Set(), { into: g, from: [g, wall] }, new Set([s.e])));
    d.removeEdge(s.e);
  }

  // Edges the push left without faces go, and straight vertices are healed.
  const ends = new Set<VertexId>();
  for (const e of touchedEdges) {
    if (!d.edges.has(e) || d.facesOf(e).length) continue;
    for (const v of d.edge(e).v) ends.add(v);
    d.removeEdge(e);
  }
  for (const v of [...ends, ...fvs]) if (d.vertices.has(v)) d.healVertex(v);

  const faceIds = new Set(d.faces.keys());
  created.delete(faceId);
  if (!faceIds.has(faceId)) removed.add(faceId);
  return {
    topology: d.commit(),
    distance,
    createdFaceIds: [...created].filter((f) => faceIds.has(f)),
    removedFaceIds: [...removed].filter((f) => !faceIds.has(f)),
  };
}

function planeOf(d: Draft, f: FaceId): Plane {
  const face = d.face(f);
  return planeThrough(face.normal, d.point(face.outer[0]!));
}

/**
 * The nearest face of the same solid ahead of the pushed face: parallel,
 * facing away from it (so the pushed face approaches its back), and
 * overlapping it when seen along the normal. `offset` is the distance along
 * the normal; `coversAll` is true when the pushed face covers all of it, so
 * landing there would flatten the solid rather than cut a hole.
 */
function oppositeFace(d: Draft, faceId: FaceId, sign: number): { offset: number; coversAll: boolean } | null {
  if (!sign) return null;
  const F = d.face(faceId);
  const n = F.normal;
  const dir = scale(n, sign);
  const origin = d.point(F.outer[0]!);
  const basis = planeBasis(n);
  const region = (f: FaceId) => {
    const face = d.face(f);
    const to = (v: VertexId) => to2(basis, d.point(v));
    return { outer: face.outer.map(to), holes: face.holes.map((h) => h.map(to)) };
  };
  const inRegion = (p: Vec2, r: { outer: Vec2[]; holes: Vec2[][] }) => pointInPolygon(p, r.outer) && !r.holes.some((h) => pointInPolygon(p, h));
  const centroids = (f: FaceId) => faceTriangles(d, f).map((tri) => to2(basis, scale(add(add(tri[0], tri[1]), tri[2]), 1 / 3)));

  const fr = region(faceId);
  const fc = centroids(faceId);
  let best: { offset: number; coversAll: boolean } | null = null;
  for (const [id, g] of d.faces) {
    if (id === faceId || !parallel(g.normal, n) || dot(g.normal, dir) <= 0) continue;
    const offset = dot(sub(d.point(g.outer[0]!), origin), n);
    if (offset * sign <= EPSILON) continue;
    const gr = region(id);
    const gc = centroids(id);
    if (!fc.some((c) => inRegion(c, gr)) && !gc.some((c) => inRegion(c, fr))) continue;
    if (best && Math.abs(best.offset) <= Math.abs(offset)) continue;
    best = { offset, coversAll: gc.every((c) => inRegion(c, fr)) };
  }
  return best;
}
