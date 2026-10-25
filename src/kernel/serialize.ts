import { dot } from './vec';
import { Draft } from './draft';
import { parallel } from './geometry';
import { emptyTopology, type Curve, type CurveKind, type Edge, type Face, type Point3, type Topology, type Vertex } from './types';

/** On-disk form of the topology. Bump the version on any breaking change. */
export interface SerializedTopology {
  kind: 'topology';
  version: 2;
  next: number;
  vertices: Record<string, number[]>;
  edges: Record<string, { v: [string, string]; soft?: true; curve?: string }>;
  faces: Record<string, { normal: number[]; outer: string[]; holes: string[][] }>;
  curves: Record<string, { kind: CurveKind; edges: string[]; segments: number; center: number[]; normal: number[]; radius: number }>;
}

export function serializeTopology(t: Topology): SerializedTopology {
  const out: SerializedTopology = { kind: 'topology', version: 2, next: t.next, vertices: {}, edges: {}, faces: {}, curves: {} };
  for (const [id, v] of t.vertices) out.vertices[id] = [...v.p];
  for (const [id, e] of t.edges) {
    out.edges[id] = { v: [e.v[0], e.v[1]], ...(e.soft ? { soft: true as const } : {}), ...(e.curve ? { curve: e.curve } : {}) };
  }
  for (const [id, f] of t.faces) out.faces[id] = { normal: [...f.normal], outer: [...f.outer], holes: f.holes.map((h) => [...h]) };
  for (const [id, c] of t.curves) {
    out.curves[id] = { kind: c.kind, edges: [...c.edges], segments: c.segments, center: [...c.center], normal: [...c.normal], radius: c.radius };
  }
  return out;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPoint = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const CURVE_KINDS: readonly CurveKind[] = ['circle', 'polygon', 'arc'];

/**
 * Load a saved model. Accepts version 2 topology, and converts version 1
 * face-loop models (milestone 1 autosaves). Returns null for invalid data.
 */
export function deserializeTopology(data: unknown): Topology | null {
  if (!isObject(data)) return null;
  if (data.kind === 'face-loop' && data.version === 1) return convertFaceLoop(data);
  if (data.kind !== 'topology' || data.version !== 2 || !Number.isInteger(data.next)) return null;
  const { vertices, edges, faces, curves } = data;
  if (!isObject(vertices) || !isObject(edges) || !isObject(faces) || !isObject(curves)) return null;

  const vs = new Map<string, Vertex>();
  for (const [id, p] of Object.entries(vertices)) {
    if (!isPoint(p)) return null;
    vs.set(id, { p });
  }
  const es = new Map<string, Edge>();
  for (const [id, e] of Object.entries(edges)) {
    if (!isObject(e) || !isIds(e.v) || e.v.length !== 2 || !e.v.every((v) => vs.has(v))) return null;
    if (e.curve !== undefined && (typeof e.curve !== 'string' || !(e.curve in curves))) return null;
    es.set(id, { v: [e.v[0]!, e.v[1]!], soft: e.soft === true, curve: (e.curve as string | undefined) ?? null });
  }
  const pairs = new Set([...es.values()].map((e) => [...e.v].sort().join('|')));
  const loopOk = (l: string[]) => l.length >= 3 && l.every((v, i) => pairs.has([v, l[(i + 1) % l.length]!].sort().join('|')));
  const fs = new Map<string, Face>();
  for (const [id, f] of Object.entries(faces)) {
    if (!isObject(f) || !isPoint(f.normal) || !isIds(f.outer) || !Array.isArray(f.holes) || !f.holes.every(isIds)) return null;
    if (!loopOk(f.outer) || !f.holes.every(loopOk)) return null;
    fs.set(id, { normal: f.normal, outer: f.outer, holes: f.holes });
  }
  const cs = new Map<string, Curve>();
  for (const [id, c] of Object.entries(curves)) {
    if (!isObject(c) || !CURVE_KINDS.includes(c.kind as CurveKind) || !isIds(c.edges) || !c.edges.every((e) => es.has(e))) return null;
    if (typeof c.segments !== 'number' || !isPoint(c.center) || !isPoint(c.normal) || typeof c.radius !== 'number') return null;
    cs.set(id, { kind: c.kind as CurveKind, edges: c.edges, segments: c.segments, center: c.center, normal: c.normal, radius: c.radius });
  }
  return { vertices: vs, edges: es, faces: fs, curves: cs, next: data.next as number };
}

/**
 * Convert a version 1 face-loop model. Faces keep their ids and normals;
 * corners at the same position become one shared vertex, and every loop side
 * becomes a shared edge. Seams between coplanar push/pull walls, which version
 * 1 hid, become soft edges so they stay hidden.
 */
export function convertFaceLoop(data: Record<string, unknown>): Topology | null {
  if (!Number.isInteger(data.next) || !isObject(data.faces)) return null;
  const faces: { id: string; outer: Point3[]; holes: Point3[][]; normal: Point3; side: boolean }[] = [];
  for (const [id, raw] of Object.entries(data.faces)) {
    if (!isObject(raw) || !isPoint(raw.normal) || typeof raw.side !== 'boolean' || !Array.isArray(raw.holes)) return null;
    const loops = [raw.outer, ...raw.holes];
    if (!loops.every((l) => Array.isArray(l) && l.length >= 3 && l.every(isPoint))) return null;
    faces.push({ id, outer: raw.outer as Point3[], holes: raw.holes as Point3[][], normal: raw.normal, side: raw.side });
  }

  const d = new Draft({ ...emptyTopology(), next: data.next as number });
  const toIds = (loop: Point3[]) => {
    const ids = loop.map((p) => d.findVertex(p) ?? d.addVertex(p));
    return ids.filter((v, i) => v !== ids[(i + 1) % ids.length]);
  };
  for (const f of faces) {
    const loops = [f.outer, ...f.holes].map(toIds);
    if (loops.some((l) => l.length < 3)) continue;
    for (const l of loops) l.forEach((v, i) => d.addEdge(v, l[(i + 1) % l.length]!));
    d.addFace(f.normal, loops[0]!, loops.slice(1), f.id);
  }
  const side = new Set(faces.filter((f) => f.side).map((f) => f.id));
  for (const e of d.edges.keys()) {
    const fs = d.facesOf(e);
    if (fs.length !== 2 || !fs.every((f) => side.has(f))) continue;
    const [a, b] = fs.map((f) => d.face(f).normal) as [Point3, Point3];
    if (parallel(a, b) && dot(a, b) > 0) d.setEdge(e, { soft: true });
  }
  return d.commit();
}
