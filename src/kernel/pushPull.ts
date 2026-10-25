import { CLAMP_MARGIN, EPSILON, VERTEX_TOLERANCE } from './precision';
import { add, cross, dot, negate, normalize, scale, sub } from './vec';
import { Draft } from './draft';
import { parallel, planeBasis, planeThrough, pointInPolygon, pointSegment, samePlane, to2, type Plane, type Vec2 } from './geometry';
import { rebuildPlane } from './planar';
import { faceTriangles } from './triangulate';
import type { CurveId, EdgeId, FaceId, Topology, VertexId } from './types';

export interface PushPullResult {
  topology: Topology;
  /** Distance actually applied after clamping, in mm. 0 means nothing changed. */
  distance: number;
  /** Faces created: walls, the bottom left behind by a lone face, merge leftovers. */
  createdFaceIds: FaceId[];
  /** Faces removed, for example by a push through. */
  removedFaceIds: FaceId[];
}

/** Normals with |dot| below this are perpendicular: the face contains the push direction. */
const PERPENDICULAR = 1e-6;

/**
 * Move a face along its normal by `requested` mm, generalizing the prototype
 * rules to any planar face:
 * - A vertex of the face moves (stretching the faces around it) when every
 *   other face at it contains the push direction and all the face's edges at it
 *   can stretch. Every other edge gets a new wall.
 * - A lone face (sharing no edge) leaves a reversed copy behind as its bottom.
 * - Walls between consecutive segments of a circle or arc are joined by soft
 *   edges, so a pushed circle shades like a cylinder. Polygons stay faceted.
 * - A wall that ends up coplanar with the face next to it merges into it.
 * - The distance is clamped so stretched faces never collapse, and so the face
 *   stops at a parallel face of the same solid ahead of it. Reaching that face
 *   exactly, inside its boundary, pushes through: both faces are removed.
 * Returns the input unchanged when the face is missing or the distance is 0.
 */
export function pushPull(t: Topology, faceId: FaceId, requested: number): PushPullResult {
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
  const steps: { a: VertexId; b: VertexId; e: EdgeId; loop: number }[] = [];
  loops.forEach((loop, li) =>
    loop.forEach((a, i) => {
      const b = loop[(i + 1) % loop.length]!;
      steps.push({ a, b, e: d.edgeBetween(a, b)!, loop: li });
    }),
  );
  const free = steps.every((s) => other(d.facesOf(s.e)).length === 0);

  // Which edges stretch and which vertices move: shrink to a fixed point.
  const stretchable = new Set(
    steps.filter((s) => {
      const os = other(d.facesOf(s.e));
      return !free && os.length > 0 && os.every(isPerp);
    }).map((s) => s.e),
  );
  const fvs = new Set(loops.flat());
  const movable = new Set([...fvs].filter((v) => !free && other(d.facesOfVertex(v)).every(isPerp)));
  for (let changed = true; changed; ) {
    changed = false;
    for (const s of steps) {
      if (stretchable.has(s.e) && !(movable.has(s.a) && movable.has(s.b))) {
        stretchable.delete(s.e);
        changed = true;
      }
      if (!stretchable.has(s.e)) {
        for (const v of [s.a, s.b]) if (movable.delete(v)) changed = true;
      }
    }
  }

  // Clamp.
  let lo = -Infinity;
  let hi = Infinity;
  for (const s of steps) {
    for (const g of other(d.facesOf(s.e)).filter(isPerp)) {
      const gv = [d.face(g).outer, ...d.face(g).holes].flat().filter((v) => !movable.has(v) && !fvs.has(v));
      const ext = gv.map((v) => dot(sub(P(v), P(s.a)), n)).filter((x) => Math.abs(x) > EPSILON);
      const pos = ext.filter((x) => x > 0);
      const neg = ext.filter((x) => x < 0);
      if (stretchable.has(s.e)) {
        if (pos.length) hi = Math.min(hi, Math.min(...pos) - CLAMP_MARGIN);
        if (neg.length) lo = Math.max(lo, Math.max(...neg) + CLAMP_MARGIN);
      } else {
        // A wall must not grow into a perpendicular face it cannot stretch.
        if (pos.length) hi = Math.min(hi, 0);
        if (neg.length) lo = Math.max(lo, 0);
      }
    }
  }
  let distance = Math.min(hi, Math.max(lo, requested));
  const ahead = oppositeFace(d, faceId, Math.sign(distance));
  let through: FaceId | null = null;
  if (ahead && Math.abs(distance) >= Math.abs(ahead.offset) - VERTEX_TOLERANCE) {
    if (ahead.inside) {
      distance = ahead.offset;
      through = ahead.id;
    } else {
      distance = ahead.offset - Math.sign(ahead.offset) * CLAMP_MARGIN;
    }
  }
  if (Math.abs(distance) < EPSILON) return none;

  const off = scale(n, distance);
  const created: FaceId[] = [];
  const target = (v: VertexId) => add(P(v), off);

  // New positions: movable vertices move; the others get a moved copy and a rail.
  const moved = new Map<VertexId, VertexId>();
  for (const v of fvs) {
    if (movable.has(v)) moved.set(v, v);
    else moved.set(v, d.findVertex(target(v)) ?? d.addVertex(target(v)));
  }
  /** A rail between two walls from consecutive segments of a smooth curve (circle or arc) is soft. */
  const smoothAt = (v: VertexId): boolean => {
    const at = steps.filter((s) => s.a === v || s.b === v).map((s) => d.edge(s.e).curve);
    const c = at.length === 2 && at[0] && at[0] === at[1] ? d.curves.get(at[0]) : undefined;
    return !!c && c.kind !== 'polygon';
  };
  for (const v of fvs) {
    if (!movable.has(v)) d.addEdge(v, moved.get(v)!, { soft: smoothAt(v) });
  }
  for (const v of movable) d.moveVertex(v, target(v));

  // Edges of the moved face; curve segments get a copy of their curve.
  const curveCopies = new Map<CurveId, CurveId>();
  const copyCurve = (c: CurveId | null) => {
    if (!c) return null;
    let copy = curveCopies.get(c);
    if (!copy) {
      const src = d.curves.get(c)!;
      copy = d.addCurve({ kind: src.kind, segments: src.segments, center: add(src.center, off), normal: src.normal, radius: src.radius });
      curveCopies.set(c, copy);
    }
    return copy;
  };
  const walls: { e: EdgeId; wall: FaceId }[] = [];
  for (const s of steps) {
    if (stretchable.has(s.e)) continue;
    const a2 = moved.get(s.a)!;
    const b2 = moved.get(s.b)!;
    d.addEdge(a2, b2, { curve: copyCurve(d.edge(s.e).curve) });
    const wallNormal = normalize(cross(sub(P(s.b), P(s.a)), free ? n : off));
    // The wall is built from the original (unmoved) positions of a and b.
    const wall = d.addFace(wallNormal, [s.a, s.b, b2, a2]);
    walls.push({ e: s.e, wall });
    created.push(wall);
  }

  const newLoops = loops.map((l) => l.map((v) => moved.get(v)!));
  if (free) {
    const keepN = distance > 0 ? negate(n) : n;
    const newN = distance > 0 ? n : negate(n);
    created.push(d.addFace(keepN, F.outer, F.holes));
    d.setFace(faceId, { normal: newN, outer: d.wind(newLoops[0]!, newN, true), holes: newLoops.slice(1).map((h) => d.wind(h, newN, false)) });
  } else {
    d.setFace(faceId, { normal: n, outer: newLoops[0]!, holes: newLoops.slice(1) });
  }

  // A wall coplanar with the face it was built next to merges into it.
  const touched = new Set<VertexId>();
  for (const { e, wall } of walls) {
    if (!d.faces.has(wall) || !d.edges.has(e)) continue;
    const fs = d.facesOf(e);
    if (fs.length !== 2) continue;
    const g = fs.find((f) => f !== wall)!;
    const pw = planeOf(d, wall);
    if (!samePlane(pw, planeOf(d, g)) || dot(d.face(wall).normal, d.face(g).normal) <= 0) continue;
    rebuildPlane(d, pw, d.face(g).normal, new Set(), { into: g, from: [g, wall] }, new Set([e]));
    for (const v of d.edge(e).v) touched.add(v);
    d.removeEdge(e);
    created.splice(created.indexOf(wall), 1);
  }
  for (const v of touched) if (d.vertices.has(v)) d.healVertex(v);

  const removed: FaceId[] = [];
  if (through) {
    const gPlane = planeOf(d, through);
    const region = newLoops.map((l) => l.map((v) => d.point(v)));
    d.removeFace(faceId);
    removed.push(faceId);
    const r = rebuildPlane(d, gPlane, d.face(through).normal, new Set());
    created.push(...r.created);
    // Remove the piece of the opposite face that the pushed face landed on.
    const basis = planeBasis(gPlane.n);
    const outer2 = region[0]!.map((p) => to2(basis, p));
    const holes2 = region.slice(1).map((h) => h.map((p) => to2(basis, p)));
    for (const f of [...d.faces.keys()]) {
      if (!samePlane(planeOf(d, f), gPlane)) continue;
      const tri = faceTriangles(d, f)[0];
      if (!tri) continue;
      const c = to2(basis, scale(add(add(tri[0], tri[1]), tri[2]), 1 / 3));
      if (pointInPolygon(c, outer2) && !holes2.some((h) => pointInPolygon(c, h))) {
        d.removeFace(f);
        removed.push(f);
        const i = created.indexOf(f);
        if (i >= 0) created.splice(i, 1);
      }
    }
  }

  return { topology: d.commit(), distance, createdFaceIds: created, removedFaceIds: removed };
}

function planeOf(d: Draft, f: FaceId): Plane {
  const face = d.face(f);
  return planeThrough(face.normal, d.point(face.outer[0]!));
}

/**
 * The nearest face of the same solid ahead of the pushed face: parallel, facing
 * away from it (so the pushed face is approaching its back), and overlapping it
 * when seen along the normal. `inside` is true when the pushed face lies
 * strictly inside that face, so a push through can cut a clean hole.
 */
function oppositeFace(d: Draft, faceId: FaceId, sign: number): { id: FaceId; offset: number; inside: boolean } | null {
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
  const nearBoundary = (p: Vec2, r: { outer: Vec2[]; holes: Vec2[][] }) =>
    [r.outer, ...r.holes].some((l) => l.some((q, i) => pointSegment(p, q, l[(i + 1) % l.length]!).distance <= VERTEX_TOLERANCE));
  const centroids = (f: FaceId) => faceTriangles(d, f).map((tri) => to2(basis, scale(add(add(tri[0], tri[1]), tri[2]), 1 / 3)));

  const fr = region(faceId);
  const fc = centroids(faceId);
  let best: { id: FaceId; offset: number; inside: boolean } | null = null;
  for (const [id, g] of d.faces) {
    if (id === faceId || !parallel(g.normal, n) || dot(g.normal, dir) <= 0) continue;
    const offset = dot(sub(d.point(g.outer[0]!), origin), n);
    if (offset * sign <= EPSILON) continue;
    const gr = region(id);
    const overlap = fc.some((c) => inRegion(c, gr)) || centroids(id).some((c) => inRegion(c, fr));
    if (!overlap) continue;
    if (best && Math.abs(best.offset) <= Math.abs(offset)) continue;
    const allPoints = [fr.outer, ...fr.holes].flat();
    const inside = fc.every((c) => inRegion(c, gr)) && allPoints.every((p) => inRegion(p, gr) && !nearBoundary(p, gr));
    best = { id, offset, inside };
  }
  return best;
}
