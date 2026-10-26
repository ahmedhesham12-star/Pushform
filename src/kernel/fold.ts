/**
 * Folding a face whose corners were moved out of its plane into flat pieces,
 * as SketchUp does (checked in SketchUp 2023, see PROJECT.md "Verified in
 * SketchUp"). The face is triangulated where it was, diagonals are flipped
 * until every fold is a ridge seen from the face's front (the surface stays
 * convex outward), and triangles left in one plane join back into one piece.
 * Fold edges are soft when the face is part of a smooth surface (it has a soft
 * edge), and plain otherwise.
 */
import { VERTEX_TOLERANCE } from './precision';
import { cleanNormal, cross, dot, length, newell, normalize, sub, type Vec3 } from './vec';
import { Draft } from './draft';
import { planeBasis, segmentCrossing, to2, type Vec2 } from './geometry';
import { faceTriangleIds } from './triangulate';
import type { EdgeId, FaceId, Topology, VertexId } from './types';

type Tri = [VertexId, VertexId, VertexId];

/** Each triangle's directed edges, keyed "a>b". */
const directed = (t: Tri): [VertexId, VertexId][] => [
  [t[0], t[1]],
  [t[1], t[2]],
  [t[2], t[0]],
];
const key = (a: VertexId, b: VertexId) => `${a}>${b}`;

export interface Fold {
  /** The pieces, the largest first (it keeps the face's id). */
  readonly faceIds: FaceId[];
  /** The fold edges added between pieces. */
  readonly edgeIds: EdgeId[];
}

/**
 * Fold face f in the draft, whose vertices have already moved; `before` holds
 * the face where it was. Null when the folded pieces would turn over.
 */
export function foldFace(d: Draft, before: Topology, f: FaceId): Fold | null {
  const was = before.faces.get(f)!;
  const basis = planeBasis(was.normal);
  const flat = (v: VertexId): Vec2 => to2(basis, before.vertices.get(v)!.p);
  const P = (v: VertexId) => d.point(v);
  const tris: Tri[] = faceTriangleIds(before, f).map((t) => [...t] as Tri);
  const loopEdges = new Set<string>();
  for (const loop of [was.outer, ...was.holes]) {
    loop.forEach((v, i) => {
      const w = loop[(i + 1) % loop.length]!;
      loopEdges.add(key(v, w));
      loopEdges.add(key(w, v));
    });
  }

  /** How far q lies in front of triangle t's plane (positive: in front, so the fold at their shared edge is a valley). */
  const above = (t: Tri, q: VertexId): number | null => {
    const n = cross(sub(P(t[1]), P(t[0])), sub(P(t[2]), P(t[0])));
    const l = length(n);
    return l < 1e-9 ? null : dot(n, sub(P(q), P(t[0]))) / l;
  };

  /** The triangle holding directed edge a>b, with the third corner. */
  const owner = () => {
    const m = new Map<string, number>();
    tris.forEach((t, i) => directed(t).forEach(([a, b]) => m.set(key(a, b), i)));
    return m;
  };
  const third = (t: Tri, a: VertexId, b: VertexId) => t.find((v) => v !== a && v !== b)!;

  // Flip valleys into ridges where the quad around the diagonal is convex where the face was.
  for (let guard = tris.length * tris.length + 10, flipped = true; flipped && guard > 0; guard--) {
    flipped = false;
    const own = owner();
    for (const [k, i] of own) {
      const [x, y] = k.split('>') as [VertexId, VertexId];
      if (loopEdges.has(k)) continue;
      const j = own.get(key(y, x));
      if (j === undefined || j < i) continue;
      const p = third(tris[i]!, x, y);
      const q = third(tris[j]!, x, y);
      const h = above(tris[i]!, q);
      if (h === null || h <= VERTEX_TOLERANCE) continue;
      if (loopEdges.has(key(p, q)) || !segmentCrossing(flat(x), flat(y), flat(p), flat(q))) continue;
      // Quad x, q, y, p (counter-clockwise); the new diagonal p-q.
      tris[i] = [x, q, p];
      tris[j] = [q, y, p];
      flipped = true;
      break;
    }
  }

  // Join triangles across diagonals where they stay in one plane, keeping each piece a simple region.
  const piece = tris.map((_, i) => i);
  const find = (i: number): number => (piece[i] === i ? i : (piece[i] = find(piece[i]!)));
  const members = (root: number) => tris.filter((_, i) => find(i) === root);
  const own = owner();
  for (const [k, i] of own) {
    const [x, y] = k.split('>') as [VertexId, VertexId];
    const j = own.get(key(y, x));
    if (loopEdges.has(k) || j === undefined || find(i) === find(j)) continue;
    const h = above(tris[i]!, third(tris[j]!, x, y));
    if (h !== null && Math.abs(h) > VERTEX_TOLERANCE) continue;
    const [a, b] = [find(i), find(j)];
    if (!loopsOf([...members(a), ...members(b)])) continue;
    piece[b] = a;
  }

  const groups = new Map<number, Tri[]>();
  tris.forEach((t, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), t]));
  const soft = d.faceEdges(f).some((e) => d.edge(e).soft);
  const pieces: { normal: Vec3; outer: VertexId[]; holes: VertexId[][]; area: number }[] = [];
  for (const g of groups.values()) {
    const loops = loopsOf(g)!;
    const sum = g.reduce<Vec3>((s, t) => {
      const n = cross(sub(P(t[1]), P(t[0])), sub(P(t[2]), P(t[0])));
      return [s[0] + n[0], s[1] + n[1], s[2] + n[2]];
    }, [0, 0, 0]);
    if (length(sum) < 1e-9) return null;
    const normal = cleanNormal(normalize(sum));
    if (dot(normal, was.normal) <= 0) return null;
    const outers = loops.filter((l) => dot(newell(l.map(P)), normal) > 0);
    if (outers.length !== 1) return null;
    pieces.push({ normal, outer: outers[0]!, holes: loops.filter((l) => l !== outers[0]), area: length(sum) / 2 });
  }
  pieces.sort((a, b) => b.area - a.area);

  const edgeIds: EdgeId[] = [];
  for (const pc of pieces) {
    for (const loop of [pc.outer, ...pc.holes]) {
      loop.forEach((v, i) => {
        const w = loop[(i + 1) % loop.length]!;
        if (!d.edgeBetween(v, w)) edgeIds.push(d.addEdge(v, w, { soft }));
      });
    }
  }
  const faceIds = pieces.map((pc, i) => d.addFace(pc.normal, pc.outer, pc.holes, i === 0 ? f : undefined));
  return { faceIds, edgeIds };
}

/**
 * The boundary loops of a set of triangles (counter-clockwise around the
 * face), or null when the region touches itself at a vertex.
 */
function loopsOf(tris: readonly Tri[]): VertexId[][] | null {
  const all = new Set(tris.flatMap((t) => directed(t).map(([a, b]) => key(a, b))));
  const next = new Map<VertexId, VertexId>();
  for (const t of tris) {
    for (const [a, b] of directed(t)) {
      if (all.has(key(b, a))) continue;
      if (next.has(a)) return null;
      next.set(a, b);
    }
  }
  const loops: VertexId[][] = [];
  const seen = new Set<VertexId>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: VertexId[] = [];
    for (let v: VertexId | undefined = start; v !== undefined && !seen.has(v); v = next.get(v)) {
      seen.add(v);
      loop.push(v);
    }
    loops.push(loop);
  }
  return loops;
}
