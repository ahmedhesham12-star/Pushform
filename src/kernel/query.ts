import { cross, dot, length, midpoint, newell, sub, type Vec3 } from './vec';
import { faceTriangles } from './triangulate';
import type { CurveId, EdgeId, FaceId, Point3, Topology, VertexId } from './types';

export interface FacePoints {
  readonly outer: Point3[];
  readonly holes: Point3[][];
}

export interface FaceView extends FacePoints {
  readonly id: FaceId;
  readonly normal: Vec3;
}

export interface EdgeView {
  readonly id: EdgeId;
  readonly a: Point3;
  readonly b: Point3;
  /** Hidden in the default style. */
  readonly soft: boolean;
  readonly curve: CurveId | null;
}

export type SnapKind = 'end' | 'mid';

export interface SnapPoint {
  readonly point: Point3;
  readonly kind: SnapKind;
}

export interface Bounds {
  readonly min: Point3;
  readonly max: Point3;
}

export function facePoints(t: Topology, id: FaceId): FacePoints | undefined {
  const f = t.faces.get(id);
  if (!f) return undefined;
  const P = (v: VertexId) => t.vertices.get(v)!.p;
  return { outer: f.outer.map(P), holes: f.holes.map((h) => h.map(P)) };
}

export function getFace(t: Topology, id: FaceId): FaceView | undefined {
  const f = t.faces.get(id);
  const pts = facePoints(t, id);
  return f && pts && { id, normal: f.normal, ...pts };
}

export function listFaces(t: Topology): FaceView[] {
  return [...t.faces.keys()].map((id) => getFace(t, id)!);
}

/** Face area in mm², holes subtracted. */
export function faceArea(t: Topology, id: FaceId): number {
  const pts = facePoints(t, id);
  if (!pts) return 0;
  let s = length(newell(pts.outer)) / 2;
  for (const h of pts.holes) s -= length(newell(h)) / 2;
  return s;
}

export function getEdge(t: Topology, id: EdgeId): EdgeView | undefined {
  const e = t.edges.get(id);
  if (!e) return undefined;
  return { id, a: t.vertices.get(e.v[0])!.p, b: t.vertices.get(e.v[1])!.p, soft: e.soft, curve: e.curve };
}

export function listEdges(t: Topology): EdgeView[] {
  return [...t.edges.keys()].map((id) => getEdge(t, id)!);
}

export function edgeLength(t: Topology, id: EdgeId): number {
  const e = getEdge(t, id);
  return e ? length(sub(e.b, e.a)) : 0;
}

/** The edges selected together with an edge: its whole curve, or just itself. */
export function edgeGroup(t: Topology, id: EdgeId): EdgeId[] {
  const c = t.edges.get(id)?.curve;
  const curve = c ? t.curves.get(c) : undefined;
  return curve ? [...curve.edges] : t.edges.has(id) ? [id] : [];
}

/** Endpoints (each shared vertex once) and midpoints of the visible edges. */
/**
 * The volume a model encloses when it is a solid, or null when it is not. A
 * solid has faces, and every edge bounds exactly two faces that run along it
 * in opposite directions (a closed, consistently oriented surface). Loose or
 * open edges, and edges shared by more than two faces, make it not a solid.
 */
export function solidVolume(t: Topology): number | null {
  if (!t.faces.size) return null;
  const byEnds = new Map<string, EdgeId>();
  for (const [id, e] of t.edges) byEnds.set(e.v[0] < e.v[1] ? `${e.v[0]}|${e.v[1]}` : `${e.v[1]}|${e.v[0]}`, id);
  const uses = new Map<EdgeId, { count: number; direction: number }>();
  for (const f of t.faces.values()) {
    for (const loop of [f.outer, ...f.holes]) {
      loop.forEach((a, i) => {
        const b = loop[(i + 1) % loop.length]!;
        const id = byEnds.get(a < b ? `${a}|${b}` : `${b}|${a}`);
        if (!id) return;
        const u = uses.get(id) ?? { count: 0, direction: 0 };
        uses.set(id, { count: u.count + 1, direction: u.direction + (a < b ? 1 : -1) });
      });
    }
  }
  for (const id of t.edges.keys()) {
    const u = uses.get(id);
    if (!u || u.count !== 2 || u.direction !== 0) return null;
  }
  // Divergence theorem over triangles wound counter-clockwise around their face normals.
  let six = 0;
  for (const id of t.faces.keys()) for (const [a, b, c] of faceTriangles(t, id)) six += dot(a, cross(b, c));
  return Math.abs(six) / 6;
}

export function snapPoints(t: Topology): SnapPoint[] {
  const out: SnapPoint[] = [];
  const ends = new Set<VertexId>();
  for (const e of t.edges.values()) {
    if (e.soft) continue;
    for (const v of e.v) ends.add(v);
    out.push({ point: midpoint(t.vertices.get(e.v[0])!.p, t.vertices.get(e.v[1])!.p), kind: 'mid' });
  }
  for (const v of ends) out.push({ point: t.vertices.get(v)!.p, kind: 'end' });
  return out;
}

/** Bounding box of all vertices, or null for an empty model. */
export function bounds(t: Topology): Bounds | null {
  if (!t.vertices.size) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of t.vertices.values()) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, v.p[i]!);
      max[i] = Math.max(max[i]!, v.p[i]!);
    }
  }
  return { min: min as unknown as Point3, max: max as unknown as Point3 };
}
