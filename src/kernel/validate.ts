import { VERTEX_TOLERANCE } from './precision';
import { dot, length, newell, normalize, sub } from './vec';
import {
  onPlane,
  planeBasis,
  planeThrough,
  pointInPolygon,
  pointSegment,
  samePlane,
  segmentCrossing,
  to2,
  type Plane,
  type Vec2,
} from './geometry';
import { faceTriangles } from './triangulate';
import type { FaceId, Point3, Topology, VertexId } from './types';

const pairKey = (a: VertexId, b: VertexId) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const GROUND: Plane = { n: [0, 1, 0], d: 0 };

/**
 * Check the topology invariants. Returns human-readable problems; an empty
 * list means the topology is valid. Meant for tests and debugging: it is
 * quadratic in places.
 */
export function validate(t: Topology): string[] {
  const problems: string[] = [];
  const bad = (msg: string) => problems.push(msg);
  const P = (v: VertexId) => t.vertices.get(v)!.p;

  /* vertices */
  const used = new Set<VertexId>();
  const verts = [...t.vertices];
  for (const [id, v] of verts) if (!v.p.every(Number.isFinite)) bad(`vertex ${id} has a non-finite coordinate`);
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      if (length(sub(verts[i]![1].p, verts[j]![1].p)) <= VERTEX_TOLERANCE) {
        bad(`vertices ${verts[i]![0]} and ${verts[j]![0]} coincide`);
      }
    }
  }

  /* edges */
  const pairs = new Map<string, string>();
  for (const [id, e] of t.edges) {
    const [a, b] = e.v;
    if (!t.vertices.has(a) || !t.vertices.has(b)) {
      bad(`edge ${id} uses a missing vertex`);
      continue;
    }
    used.add(a);
    used.add(b);
    if (a === b) bad(`edge ${id} is a loop on one vertex`);
    else if (length(sub(P(a), P(b))) <= VERTEX_TOLERANCE) bad(`edge ${id} has zero length`);
    const k = pairKey(a, b);
    if (pairs.has(k)) bad(`edges ${pairs.get(k)} and ${id} join the same vertices`);
    pairs.set(k, id);
    if (e.curve) {
      const c = t.curves.get(e.curve);
      if (!c) bad(`edge ${id} refers to missing curve ${e.curve}`);
      else if (!c.edges.includes(id)) bad(`curve ${e.curve} does not list its edge ${id}`);
    }
  }
  for (const id of t.vertices.keys()) if (!used.has(id)) bad(`vertex ${id} has no edges`);

  /* curves */
  for (const [id, c] of t.curves) {
    if (!c.edges.length) bad(`curve ${id} has no edges`);
    if (!(c.segments >= 1)) bad(`curve ${id} has an invalid segment count`);
    for (const e of c.edges) if (t.edges.get(e)?.curve !== id) bad(`curve ${id} lists edge ${e} that is not its own`);
  }

  /* faces */
  const planes: { plane: Plane; faces: FaceId[] }[] = [];
  for (const [id, f] of t.faces) {
    const loops = [f.outer, ...f.holes];
    const all = loops.flat();
    if (Math.abs(length(f.normal) - 1) > 1e-9) bad(`face ${id} normal is not a unit vector`);
    if (loops.some((l) => l.length < 3)) {
      bad(`face ${id} has a loop with fewer than 3 vertices`);
      continue;
    }
    if (all.some((v) => !t.vertices.has(v))) {
      bad(`face ${id} uses a missing vertex`);
      continue;
    }
    // A hole may touch the outer loop or another hole at a single vertex, but no loop visits a vertex twice.
    if (loops.some((l) => new Set(l).size !== l.length)) bad(`face ${id} has a loop that visits a vertex twice`);
    for (const loop of loops) {
      for (let i = 0; i < loop.length; i++) {
        if (!pairs.has(pairKey(loop[i]!, loop[(i + 1) % loop.length]!))) bad(`face ${id} has a loop step without an edge`);
      }
    }
    const plane = planeThrough(f.normal, P(f.outer[0]!));
    if (all.some((v) => !onPlane(plane, P(v)))) bad(`face ${id} is not planar`);
    const outerN = newell(f.outer.map(P));
    if (dot(normalize(outerN), f.normal) < 1 - 1e-6) bad(`face ${id} outer loop is not counter-clockwise around its normal`);
    for (const h of f.holes) if (dot(newell(h.map(P)), f.normal) >= 0) bad(`face ${id} has a hole that is not clockwise`);

    const b = planeBasis(f.normal);
    const outer2 = f.outer.map((v) => to2(b, P(v)));
    const holes2 = f.holes.map((h) => h.map((v) => to2(b, P(v))));
    const outerSet = new Set(f.outer);
    f.holes.forEach((h, i) => {
      const probe = h.findIndex((v) => !outerSet.has(v));
      if (probe >= 0 && !pointInPolygon(holes2[i]![probe]!, outer2)) bad(`face ${id} has a hole outside its outer loop`);
    });
    const segs: [Vec2, Vec2][] = [outer2, ...holes2].flatMap((l) => l.map((p, i) => [p, l[(i + 1) % l.length]!] as [Vec2, Vec2]));
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        if (segmentCrossing(segs[i]![0], segs[i]![1], segs[j]![0], segs[j]![1])) bad(`face ${id} loops cross themselves`);
      }
    }
    const group = planes.find((g) => samePlane(g.plane, plane));
    if (group) group.faces.push(id);
    else planes.push({ plane, faces: [id] });
  }

  /* planes: edges never cross, vertices never sit inside edges, faces never overlap */
  if (!planes.some((g) => samePlane(g.plane, GROUND))) planes.push({ plane: GROUND, faces: [] });
  for (const { plane } of planes) problems.push(...planeProblems(t, plane));
  return problems;
}

/**
 * The planar invariants for one plane: no two edges in it cross, no vertex in
 * it sits inside one of its edges, and no two of its faces overlap. Cheap
 * enough to run on the few planes an operation touched.
 */
export function planeProblems(t: Topology, plane: Plane): string[] {
  const problems: string[] = [];
  const bad = (msg: string) => problems.push(msg);
  const P = (v: VertexId) => t.vertices.get(v)!.p;
  const b = planeBasis(plane.n);
  const faces = [...t.faces]
    .filter(([, f]) => samePlane(planeThrough(f.normal, P(f.outer[0]!)), plane))
    .map(([id]) => id);
  const inPlane = [...t.edges].filter(([, e]) => e.v.every((v) => t.vertices.has(v) && onPlane(plane, P(v))));
  const vs = [...t.vertices].filter(([, v]) => onPlane(plane, v.p));
  const seg = inPlane.map(([id, e]) => ({ id, e, a: to2(b, P(e.v[0])), b: to2(b, P(e.v[1])) }));
  for (let i = 0; i < seg.length; i++) {
    for (let j = i + 1; j < seg.length; j++) {
      if (segmentCrossing(seg[i]!.a, seg[i]!.b, seg[j]!.a, seg[j]!.b)) bad(`edges ${seg[i]!.id} and ${seg[j]!.id} cross`);
    }
    for (const [vid, v] of vs) {
      if (seg[i]!.e.v.includes(vid)) continue;
      const r = pointSegment(to2(b, v.p), seg[i]!.a, seg[i]!.b);
      if (r.distance <= VERTEX_TOLERANCE && r.t > 0 && r.t < 1) bad(`vertex ${vid} lies inside edge ${seg[i]!.id}`);
    }
  }
  for (let i = 0; i < faces.length; i++) {
    for (let j = 0; j < faces.length; j++) {
      if (i !== j && overlaps(t, faces[i]!, faces[j]!)) bad(`faces ${faces[i]} and ${faces[j]} overlap`);
    }
  }
  return problems;
}

/** Whether some triangle of face a has its centroid strictly inside face b. */
function overlaps(t: Topology, a: FaceId, b: FaceId): boolean {
  const fb = t.faces.get(b)!;
  const basis = planeBasis(fb.normal);
  const P = (v: VertexId) => to2(basis, t.vertices.get(v)!.p);
  const outer = fb.outer.map(P);
  const holes = fb.holes.map((h) => h.map(P));
  const inside = (p: Vec2) => {
    if (!pointInPolygon(p, outer) || holes.some((h) => pointInPolygon(p, h))) return false;
    // Ignore points on b's boundary.
    return ![outer, ...holes].some((l) => l.some((q, i) => pointSegment(p, q, l[(i + 1) % l.length]!).distance <= VERTEX_TOLERANCE));
  };
  for (const tri of faceTriangles(t, a)) {
    const c: Point3 = [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3, (tri[0][2] + tri[1][2] + tri[2][2]) / 3];
    if (inside(to2(basis, c))) return true;
  }
  return false;
}
