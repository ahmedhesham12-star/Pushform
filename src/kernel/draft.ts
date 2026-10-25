import { snapPoint, VERTEX_TOLERANCE } from './precision';
import { dot, length, newell, sub } from './vec';
import type { Curve, CurveId, Edge, EdgeId, Face, FaceId, Point3, Topology, Vertex, VertexId } from './types';
import type { Vec3 } from './vec';

const pairKey = (a: VertexId, b: VertexId) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Mutable working copy of a Topology, used inside one operation. It keeps
 * adjacency indexes up to date as entities change. Entities are replaced, never
 * edited, so the Topology it came from is unaffected. Call commit() once.
 */
export class Draft {
  readonly vertices: Map<VertexId, Vertex>;
  readonly edges: Map<EdgeId, Edge>;
  readonly faces: Map<FaceId, Face>;
  readonly curves: Map<CurveId, Curve>;
  next: number;
  private readonly vEdges = new Map<VertexId, Set<EdgeId>>();
  private readonly pairs = new Map<string, EdgeId>();
  private readonly eFaces = new Map<EdgeId, Set<FaceId>>();

  constructor(t: Topology) {
    this.vertices = new Map(t.vertices);
    this.edges = new Map(t.edges);
    this.faces = new Map(t.faces);
    this.curves = new Map(t.curves);
    this.next = t.next;
    for (const v of this.vertices.keys()) this.vEdges.set(v, new Set());
    for (const [id, e] of this.edges) this.indexEdge(id, e);
    for (const [id, f] of this.faces) this.indexFace(id, f, true);
  }

  commit(): Topology {
    return { vertices: this.vertices, edges: this.edges, faces: this.faces, curves: this.curves, next: this.next };
  }

  newId(prefix: 'v' | 'e' | 'f' | 'c'): string {
    return `${prefix}${this.next++}`;
  }

  /* ---------- vertices ---------- */

  point(v: VertexId): Point3 {
    const vx = this.vertices.get(v);
    if (!vx) throw new Error(`no vertex ${v}`);
    return vx.p;
  }

  addVertex(p: Point3): VertexId {
    const id = this.newId('v');
    this.vertices.set(id, { p: snapPoint(p) });
    this.vEdges.set(id, new Set());
    return id;
  }

  /** Existing vertex within the tolerance of p, or null. */
  findVertex(p: Point3, tol = VERTEX_TOLERANCE): VertexId | null {
    let best: VertexId | null = null;
    let bestD = tol;
    for (const [id, v] of this.vertices) {
      const d = length(sub(v.p, p));
      if (d <= bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  moveVertex(v: VertexId, p: Point3): void {
    this.vertices.set(v, { p: snapPoint(p) });
  }

  edgesOf(v: VertexId): EdgeId[] {
    return [...(this.vEdges.get(v) ?? [])];
  }

  facesOfVertex(v: VertexId): FaceId[] {
    const out = new Set<FaceId>();
    for (const e of this.vEdges.get(v) ?? []) for (const f of this.eFaces.get(e) ?? []) out.add(f);
    return [...out];
  }

  /** Remove a vertex that no edge uses. Returns true when removed. */
  removeVertexIfUnused(v: VertexId): boolean {
    if (!this.vertices.has(v) || (this.vEdges.get(v)?.size ?? 0) > 0) return false;
    this.vertices.delete(v);
    this.vEdges.delete(v);
    return true;
  }

  /* ---------- edges ---------- */

  edge(e: EdgeId): Edge {
    const ed = this.edges.get(e);
    if (!ed) throw new Error(`no edge ${e}`);
    return ed;
  }

  edgeBetween(a: VertexId, b: VertexId): EdgeId | undefined {
    return this.pairs.get(pairKey(a, b));
  }

  /** Edge from a to b, reusing an existing one. */
  addEdge(a: VertexId, b: VertexId, opts: { soft?: boolean; curve?: CurveId | null } = {}): EdgeId {
    if (a === b) throw new Error('edge needs two distinct vertices');
    const existing = this.edgeBetween(a, b);
    if (existing) return existing;
    const id = this.newId('e');
    const e: Edge = { v: [a, b], soft: opts.soft ?? false, curve: opts.curve ?? null };
    this.edges.set(id, e);
    this.indexEdge(id, e);
    if (e.curve) {
      const c = this.curves.get(e.curve);
      if (c) this.curves.set(e.curve, { ...c, edges: [...c.edges, id] });
    }
    return id;
  }

  setEdge(e: EdgeId, patch: Partial<Pick<Edge, 'soft' | 'curve'>>): void {
    this.edges.set(e, { ...this.edge(e), ...patch });
  }

  facesOf(e: EdgeId): FaceId[] {
    return [...(this.eFaces.get(e) ?? [])];
  }

  /** Remove an edge that no face uses, and drop it from its curve. */
  removeEdge(e: EdgeId, pruneVertices = true): void {
    const ed = this.edge(e);
    if ((this.eFaces.get(e)?.size ?? 0) > 0) throw new Error(`edge ${e} still bounds a face`);
    this.edges.delete(e);
    this.eFaces.delete(e);
    this.pairs.delete(pairKey(ed.v[0], ed.v[1]));
    for (const v of ed.v) this.vEdges.get(v)?.delete(e);
    if (ed.curve) this.dropFromCurve(ed.curve, [e]);
    if (pruneVertices) for (const v of ed.v) this.removeVertexIfUnused(v);
  }

  /**
   * Split edge e at vertex v (which must lie on it). Every face loop through e
   * gets v inserted, and curves keep both halves. Returns the two new edges.
   */
  splitEdge(e: EdgeId, v: VertexId): [EdgeId, EdgeId] {
    const ed = this.edge(e);
    const [a, b] = ed.v;
    const faces = this.facesOf(e);
    // Unhook e first so the halves are new edges even if (a, v) or (v, b) existed.
    this.edges.delete(e);
    this.eFaces.delete(e);
    this.pairs.delete(pairKey(a, b));
    this.vEdges.get(a)?.delete(e);
    this.vEdges.get(b)?.delete(e);
    const opts = { soft: ed.soft, curve: null };
    const e1 = this.addEdge(a, v, opts);
    const e2 = this.addEdge(v, b, opts);
    for (const f of faces) {
      const face = this.faces.get(f)!;
      const fix = (loop: readonly VertexId[]) => {
        const out: VertexId[] = [];
        for (let i = 0; i < loop.length; i++) {
          const p = loop[i]!;
          const q = loop[(i + 1) % loop.length]!;
          out.push(p);
          if ((p === a && q === b) || (p === b && q === a)) out.push(v);
        }
        return out;
      };
      this.setFace(f, { ...face, outer: fix(face.outer), holes: face.holes.map(fix) });
    }
    if (ed.curve) {
      for (const half of [e1, e2]) this.edges.set(half, { ...this.edge(half), curve: ed.curve });
      const c = this.curves.get(ed.curve);
      if (c) this.curves.set(ed.curve, { ...c, edges: c.edges.flatMap((x) => (x === e ? [e1, e2] : [x])) });
    }
    return [e1, e2];
  }

  /**
   * Remove a vertex between two collinear edges that bound the same faces,
   * joining the edges into one. Returns true when the vertex was healed.
   */
  healVertex(v: VertexId): boolean {
    const es = this.edgesOf(v);
    if (es.length !== 2) return false;
    const [e1, e2] = es as [EdgeId, EdgeId];
    const d1 = this.edge(e1);
    const d2 = this.edge(e2);
    if (d1.soft !== d2.soft || d1.curve !== d2.curve) return false;
    const a = d1.v[0] === v ? d1.v[1] : d1.v[0];
    const b = d2.v[0] === v ? d2.v[1] : d2.v[0];
    if (a === b || this.edgeBetween(a, b)) return false;
    const fa = this.facesOf(e1).sort();
    const fb = this.facesOf(e2).sort();
    if (fa.join() !== fb.join()) return false;
    const pa = this.point(a);
    const pb = this.point(b);
    const pv = this.point(v);
    const ab = sub(pb, pa);
    const len = length(ab);
    const t = dot(sub(pv, pa), ab) / (len * len);
    const off = length(sub(pv, [pa[0] + ab[0] * t, pa[1] + ab[1] * t, pa[2] + ab[2] * t]));
    if (t <= 0 || t >= 1 || off > VERTEX_TOLERANCE) return false;

    for (const f of fa) {
      const face = this.faces.get(f)!;
      const drop = (loop: readonly VertexId[]) => loop.filter((x) => x !== v);
      this.unindexFace(f, face);
      this.faces.set(f, { ...face, outer: drop(face.outer), holes: face.holes.map(drop) });
    }
    for (const [e, d] of [[e1, d1], [e2, d2]] as const) {
      this.edges.delete(e);
      this.eFaces.delete(e);
      this.pairs.delete(pairKey(d.v[0], d.v[1]));
      for (const x of d.v) this.vEdges.get(x)?.delete(e);
    }
    const joined = this.addEdge(a, b, { soft: d1.soft });
    if (d1.curve) {
      this.edges.set(joined, { ...this.edge(joined), curve: d1.curve });
      const c = this.curves.get(d1.curve);
      if (c) {
        const edges = c.edges.flatMap((x) => (x === e1 ? [joined] : x === e2 ? [] : [x]));
        this.curves.set(d1.curve, { ...c, edges });
      }
    }
    for (const f of fa) this.indexFace(f, this.faces.get(f)!, false);
    this.removeVertexIfUnused(v);
    return true;
  }

  /* ---------- faces ---------- */

  face(f: FaceId): Face {
    const fc = this.faces.get(f);
    if (!fc) throw new Error(`no face ${f}`);
    return fc;
  }

  /**
   * Add a face. Loops are re-wound: outer counter-clockwise around the normal,
   * holes clockwise. Every consecutive vertex pair must already have an edge.
   */
  addFace(normal: Vec3, outer: readonly VertexId[], holes: readonly (readonly VertexId[])[] = [], id?: FaceId): FaceId {
    const fid = id ?? this.newId('f');
    this.setFace(fid, { normal, outer: this.wind(outer, normal, true), holes: holes.map((h) => this.wind(h, normal, false)) });
    return fid;
  }

  /** Replace a face's data, keeping indexes in sync. */
  setFace(f: FaceId, face: Face): void {
    const old = this.faces.get(f);
    if (old) this.unindexFace(f, old);
    this.faces.set(f, face);
    this.indexFace(f, face, false);
  }

  removeFace(f: FaceId): void {
    const old = this.faces.get(f);
    if (!old) return;
    this.unindexFace(f, old);
    this.faces.delete(f);
  }

  /** Every edge a face uses, outer loop first. */
  faceEdges(f: FaceId): EdgeId[] {
    const face = this.face(f);
    const out: EdgeId[] = [];
    for (const loop of [face.outer, ...face.holes]) {
      for (let i = 0; i < loop.length; i++) out.push(this.edgeBetween(loop[i]!, loop[(i + 1) % loop.length]!)!);
    }
    return out;
  }

  loopPoints(loop: readonly VertexId[]): Point3[] {
    return loop.map((v) => this.point(v));
  }

  /** The loop wound counter-clockwise (ccw) or clockwise around n. */
  wind(loop: readonly VertexId[], n: Vec3, ccw: boolean): VertexId[] {
    const d = dot(newell(this.loopPoints(loop)), n);
    return (ccw ? d < 0 : d > 0) ? loop.slice().reverse() : loop.slice();
  }

  /* ---------- curves ---------- */

  addCurve(curve: Omit<Curve, 'edges'>): CurveId {
    const id = this.newId('c');
    this.curves.set(id, { ...curve, edges: [] });
    return id;
  }

  private dropFromCurve(c: CurveId, edges: EdgeId[]): void {
    const curve = this.curves.get(c);
    if (!curve) return;
    const rest = curve.edges.filter((x) => !edges.includes(x));
    if (rest.length) this.curves.set(c, { ...curve, edges: rest });
    else this.curves.delete(c);
  }

  /* ---------- indexes ---------- */

  private indexEdge(id: EdgeId, e: Edge): void {
    this.pairs.set(pairKey(e.v[0], e.v[1]), id);
    for (const v of e.v) {
      let s = this.vEdges.get(v);
      if (!s) this.vEdges.set(v, (s = new Set()));
      s.add(id);
    }
    if (!this.eFaces.has(id)) this.eFaces.set(id, new Set());
  }

  private indexFace(f: FaceId, face: Face, lenient: boolean): void {
    for (const loop of [face.outer, ...face.holes]) {
      for (let i = 0; i < loop.length; i++) {
        const e = this.edgeBetween(loop[i]!, loop[(i + 1) % loop.length]!);
        if (!e) {
          if (lenient) continue;
          throw new Error(`face ${f} uses missing edge ${loop[i]}-${loop[(i + 1) % loop.length]}`);
        }
        this.eFaces.get(e)!.add(f);
      }
    }
  }

  private unindexFace(f: FaceId, face: Face): void {
    for (const loop of [face.outer, ...face.holes]) {
      for (let i = 0; i < loop.length; i++) {
        const e = this.edgeBetween(loop[i]!, loop[(i + 1) % loop.length]!);
        if (e) this.eFaces.get(e)?.delete(f);
      }
    }
  }
}
