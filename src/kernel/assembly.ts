/**
 * Moving geometry between models: extracting a selection into its own model
 * (making a group or component), transforming a whole model, and merging one
 * model's geometry into another (exploding, copying loose geometry).
 */
import { snapPoint } from './precision';
import { cleanNormal, normalize, type Vec3 } from './vec';
import { Draft } from './draft';
import { onPlane, planeBasis, planeThrough, pointInPolygon, samePlane, to2, type Plane, type Vec2 } from './geometry';
import { insertSegment, rebuildPlane, type RegionRule } from './planar';
import { insertSegment3d } from './lines';
import { withRadius, type Curve, type CurveId, type Edge, type EdgeId, type Face, type FaceId, type Point3, type Topology, type Vertex, type VertexId } from './types';

export interface ExtractResult {
  /** The source without the extracted geometry (edges still used by its faces stay). */
  remaining: Topology;
  /** The extracted faces and edges, with the same ids as in the source. */
  extracted: Topology;
}

/**
 * Split selected faces and edges out of a model. Every edge and vertex of a
 * selected face goes with it; an edge also bounding an unselected face is
 * copied, so both models keep it. Curves keep the segments that were taken.
 */
export function extract(t: Topology, faceIds: readonly FaceId[], edgeIds: readonly EdgeId[]): ExtractResult {
  const faces = new Set(faceIds.filter((f) => t.faces.has(f)));
  const d = new Draft(t);
  const taken = new Set<EdgeId>(edgeIds.filter((e) => t.edges.has(e)));
  for (const f of faces) for (const e of d.faceEdges(f)) taken.add(e);

  const vertices = new Map<VertexId, Vertex>();
  const edges = new Map<EdgeId, Edge>();
  for (const e of taken) {
    const edge = t.edges.get(e)!;
    edges.set(e, edge);
    for (const v of edge.v) vertices.set(v, t.vertices.get(v)!);
  }
  const outFaces = new Map<FaceId, Face>([...faces].map((f) => [f, t.faces.get(f)!]));
  const curves = new Map<CurveId, Curve>();
  for (const [id, c] of t.curves) {
    const kept = c.edges.filter((e) => taken.has(e));
    if (kept.length) curves.set(id, { ...c, edges: kept });
  }
  // Edges whose curve was not taken (cannot happen with whole curves) lose the reference.
  for (const [id, e] of edges) if (e.curve && !curves.has(e.curve)) edges.set(id, { ...e, curve: null });
  const extracted: Topology = { vertices, edges, faces: outFaces, curves, next: t.next };

  for (const f of faces) d.removeFace(f);
  for (const e of taken) if (d.edges.has(e) && d.facesOf(e).length === 0) d.removeEdge(e);
  return { remaining: d.commit(), extracted };
}

/**
 * Apply a rigid motion to a whole model: points through mapPoint, directions
 * (normals) through mapVector. Coordinates are rounded to the stored precision.
 */
export interface PlaceOptions {
  /** The map turns space inside out (a mirror): face loops are reversed so faces keep facing the same way. */
  readonly mirror?: boolean;
  /** Curve radii are multiplied by this; null drops them (a non-uniform scale makes circles ellipses). */
  readonly radiusScale?: number | null;
}

/**
 * A copy of a topology placed with an affine map: points through mapPoint,
 * face and curve normals through mapNormal (normalized here).
 */
export function transformTopology(t: Topology, mapPoint: (p: Point3) => Point3, mapNormal: (v: Vec3) => Vec3, options: PlaceOptions = {}): Topology {
  const unit = (v: Vec3) => cleanNormal(normalize(mapNormal(v)));
  const reversed = (loop: readonly VertexId[]) => (options.mirror ? [...loop].reverse() : loop);
  const vertices = new Map<VertexId, Vertex>([...t.vertices].map(([id, v]) => [id, { p: snapPoint(mapPoint(v.p)) }]));
  const faces = new Map<FaceId, Face>(
    [...t.faces].map(([id, f]) => [id, { normal: unit(f.normal), outer: reversed(f.outer), holes: f.holes.map(reversed) }]),
  );
  const scale = options.radiusScale === undefined ? 1 : options.radiusScale;
  const curves = new Map<CurveId, Curve>(
    [...t.curves].map(([id, c]) => {
      const { radius, ...rest } = c;
      const placed = { ...rest, center: snapPoint(mapPoint(c.center)), normal: unit(c.normal) };
      return [id, scale === null || radius === undefined ? placed : { ...placed, radius: radius * Math.abs(scale) }];
    }),
  );
  return { vertices, edges: t.edges, faces, curves, next: t.next };
}


export interface MergeResult {
  topology: Topology;
  /** Faces created in the target for the source's faces (new ids). */
  faceIds: FaceId[];
  /** Edges the source's edges became in the target, split where they met other geometry. */
  edgeIds: EdgeId[];
}

/**
 * Insert the geometry of `source` (already in the target's coordinates) into
 * `target`, through the planar engine: edges split where they meet, and faces
 * in a common plane are resolved region by region. A region inside a source
 * face that an existing face already covers stays that existing face (they
 * merge); a new region becomes a face with the source face's orientation.
 * Soft edges stay soft and curves come along as new curves.
 */
export function merge(target: Topology, source: Topology): MergeResult {
  const d = new Draft(target);
  const P = (v: VertexId) => source.vertices.get(v)!.p;
  const planeOfSource = (f: Face) => planeThrough(f.normal, P(f.outer[0]!));

  // Planes of the source faces, with the faces in each.
  const sourcePlanes: { plane: Plane; faces: Face[] }[] = [];
  for (const f of source.faces.values()) {
    const pl = planeOfSource(f);
    const g = sourcePlanes.find((x) => samePlane(x.plane, pl));
    if (g) g.faces.push(f);
    else sourcePlanes.push({ plane: pl, faces: [f] });
  }

  // New curves for the source's curves.
  const curveMap = new Map<CurveId, CurveId>();
  for (const [id, c] of source.curves) curveMap.set(id, d.addCurve({ kind: c.kind, segments: c.segments, center: c.center, normal: c.normal, ...withRadius(c.radius) }));

  // Insert every source edge into a plane that contains it (a source face's plane first), or into open space.
  const inserted: EdgeId[] = [];
  const planes: Plane[] = sourcePlanes.map((g) => g.plane);
  const facePlaneOf = (a: Point3, b: Point3): Plane | null => {
    for (const g of sourcePlanes) if (onPlane(g.plane, a) && onPlane(g.plane, b)) return g.plane;
    for (const f of d.faces.values()) {
      const pl = planeThrough(f.normal, d.point(f.outer[0]!));
      if (onPlane(pl, a) && onPlane(pl, b)) return pl;
    }
    return null;
  };
  for (const e of source.edges.values()) {
    const a = P(e.v[0]);
    const b = P(e.v[1]);
    const pl = facePlaneOf(a, b);
    const pieces = pl ? insertSegment(d, pl, a, b) : insertSegment3d(d, a, b);
    for (const x of pieces) {
      inserted.push(x);
      if (e.soft) d.setEdge(x, { soft: true });
      if (e.curve) d.assignCurve(x, curveMap.get(e.curve)!);
    }
  }

  // Every plane holding an inserted edge is rebuilt: source planes with the source faces' regions,
  // the others (target faces the new edges run across) with the default rule, which splits them.
  for (const x of inserted) {
    if (!d.edges.has(x)) continue;
    const [p, q] = d.edge(x).v.map((v) => d.point(v)) as [Point3, Point3];
    for (const f of d.faces.values()) {
      const pl = planeThrough(f.normal, d.point(f.outer[0]!));
      if (onPlane(pl, p) && onPlane(pl, q) && !planes.some((y) => samePlane(y, pl))) planes.push(pl);
    }
  }
  const created = new Set<FaceId>();
  for (const pl of planes) {
    const group = sourcePlanes.find((g) => samePlane(g.plane, pl));
    let rule: RegionRule | undefined;
    if (group) {
      const basis = planeBasis(pl.n);
      const regions = group.faces.map((f) => ({
        normal: f.normal,
        outer: f.outer.map((v) => to2(basis, P(v))),
        holes: f.holes.map((h) => h.map((v) => to2(basis, P(v)))),
      }));
      const inside = (s: Vec2, r: (typeof regions)[number]) => pointInPolygon(s, r.outer) && !r.holes.some((h) => pointInPolygon(s, h));
      rule = (sample, covers) => {
        const r = regions.find((x) => inside(sample, x));
        if (!r) return undefined;
        if (covers.length) return { owner: covers[0]!, normal: d.face(covers[0]!).normal };
        return { owner: null, normal: r.normal };
      };
    }
    const res = rebuildPlane(d, pl, pl.n, new Set(), null, new Set(), rule);
    for (const f of res.created) created.add(f);
    for (const f of res.removed) created.delete(f);
  }
  const topology = d.commit();
  return { topology, faceIds: [...created].filter((f) => topology.faces.has(f)), edgeIds: [...new Set(inserted)].filter((e) => topology.edges.has(e)) };
}
