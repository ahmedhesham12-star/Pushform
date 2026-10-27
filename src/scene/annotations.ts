/**
 * Annotations: dimensions (milestone 4) a definition holds next to its
 * geometry, in its local mm. Their ends are anchors, attached to a vertex or
 * to a point along an edge of the definition's geometry or of a nested
 * group or component, so they follow when that geometry moves. Like guides,
 * they never split or join geometry.
 */
import { edgeThrough, snapPoint, VERTEX_TOLERANCE, vertexAt, vertexPoint, type Point3, type Vec3 } from '../kernel';
import { newId, placedInstances, type Definition, type DefinitionId, type InstanceId, type Scene } from './scene';
import { applyPoint, applyVector, compose, IDENTITY, inverse, type Transform } from './transform';

export type AnnotationId = string;

/**
 * What an anchor is attached to, in the definition at `path` (instance ids
 * from the annotation's definition down; [] is its own geometry): vertex `a`,
 * or the point a fraction `t` of the way from vertex `a` to vertex `b`.
 * `definitionId` tells a stale path apart: ids are only unique within one
 * model, so a vertex id found in another definition's model means nothing.
 */
export interface AnchorRef {
  readonly path: readonly InstanceId[];
  readonly definitionId: DefinitionId;
  readonly a: string;
  readonly b?: string;
  readonly t?: number;
}

/** A point in the annotation's definition, attached to geometry or not. */
export interface Anchor {
  readonly point: Point3;
  readonly ref?: AnchorRef;
}

/** An aligned dimension: the distance between two anchors, drawn `offset` to the side. */
export interface Dimension {
  readonly kind: 'dimension';
  readonly start: Anchor;
  readonly end: Anchor;
  readonly offset: Vec3;
}

export type Annotation = Dimension;

/** The local space at the end of `path`, below a definition: its transform into that definition and its definition id. */
function below(s: Scene, from: DefinitionId, path: readonly InstanceId[]): { transform: Transform; definitionId: DefinitionId } | null {
  let transform = IDENTITY;
  let definitionId = from;
  for (const id of path) {
    const i = s.definitions.get(definitionId)?.instances.get(id);
    if (!i) return null;
    transform = compose(transform, i.transform);
    definitionId = i.definitionId;
  }
  return { transform, definitionId };
}

/** Where a reference is now, in the coordinates of `from`, or null when it no longer resolves. */
function resolve(s: Scene, from: DefinitionId, ref: AnchorRef): Point3 | null {
  const at = below(s, from, ref.path);
  const model = at?.definitionId === ref.definitionId ? s.definitions.get(ref.definitionId)?.model : undefined;
  if (!at || !model) return null;
  const a = vertexPoint(model, ref.a);
  if (!a) return null;
  if (ref.b === undefined) return snapPoint(applyPoint(at.transform, a));
  const b = vertexPoint(model, ref.b);
  if (!b) return null;
  const t = ref.t ?? 0.5;
  return snapPoint(applyPoint(at.transform, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]));
}

/**
 * An anchor at a point of a definition: attached to the vertex there, else
 * to the edge through it, looking first at the definition's own geometry and
 * then at nested groups and components; free when there is neither.
 */
export function attachAnchor(s: Scene, definitionId: DefinitionId, point: Point3): Anchor {
  const p = snapPoint(point);
  const def = s.definitions.get(definitionId);
  if (!def) return { point: p };
  const places = [{ path: [] as readonly InstanceId[], definitionId, world: IDENTITY }];
  for (const placed of placedInstances(s, definitionId)) places.push({ path: placed.path, definitionId: placed.instance.definitionId, world: placed.world });
  const local = (world: Transform, q: Point3): Point3 => applyPoint(inverse(world), q);
  for (const place of places) {
    const model = s.definitions.get(place.definitionId)!.model;
    const v = vertexAt(model, local(place.world, p), VERTEX_TOLERANCE);
    if (v) return { point: p, ref: { path: place.path, definitionId: place.definitionId, a: v } };
  }
  for (const place of places) {
    const model = s.definitions.get(place.definitionId)!.model;
    const e = edgeThrough(model, local(place.world, p), VERTEX_TOLERANCE);
    if (e) return { point: p, ref: { path: place.path, definitionId: place.definitionId, a: e.a, b: e.b, t: e.t } };
  }
  return { point: p };
}

/**
 * An anchor brought up to date: where its geometry is now, or attached again
 * by position when its reference no longer resolves (the geometry was made
 * into a group, exploded or rebuilt); free when nothing is there any more.
 * The same anchor when nothing changed.
 */
function follow(s: Scene, definitionId: DefinitionId, anchor: Anchor): Anchor {
  if (!anchor.ref) return anchor;
  const p = resolve(s, definitionId, anchor.ref);
  if (p) return samePoint(p, anchor.point) ? anchor : { ...anchor, point: p };
  return attachAnchor(s, definitionId, anchor.point);
}

const samePoint = (a: Point3, b: Point3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * Every annotation's anchors brought up to date after a change: attached
 * ends follow their geometry. The same scene when nothing moved.
 */
export function followAnchors(s: Scene): Scene {
  let definitions: Map<DefinitionId, Definition> | null = null;
  for (const d of s.definitions.values()) {
    if (!d.annotations.size) continue;
    let annotations: Map<AnnotationId, Annotation> | null = null;
    for (const [id, a] of d.annotations) {
      const start = follow(s, d.id, a.start);
      const end = follow(s, d.id, a.end);
      if (start === a.start && end === a.end) continue;
      annotations ??= new Map(d.annotations);
      annotations.set(id, { ...a, start, end });
    }
    if (!annotations) continue;
    definitions ??= new Map(s.definitions);
    definitions.set(d.id, { ...d, annotations });
  }
  return definitions ? { ...s, definitions } : s;
}

/** A dimension's measured length, in its definition's mm. */
export const dimensionLength = (d: Dimension) =>
  Math.hypot(d.end.point[0] - d.start.point[0], d.end.point[1] - d.start.point[1], d.end.point[2] - d.start.point[2]);

/** An annotation placed with a transform (into a parent's space, or the world). References are kept. */
export function transformAnnotation(t: Transform, a: Annotation): Annotation {
  const anchor = (x: Anchor): Anchor => ({ ...x, point: snapPoint(applyPoint(t, x.point)) });
  return { ...a, start: anchor(a.start), end: anchor(a.end), offset: applyVector(t, a.offset) };
}

/** Add an annotation to a definition; returns its id and the new scene. */
export function addAnnotation(s: Scene, definitionId: DefinitionId, annotation: Annotation): [AnnotationId, Scene] {
  const [id, next] = newId(s, 'a');
  const d = next.definitions.get(definitionId)!;
  const annotations = new Map(d.annotations).set(id, annotation);
  return [id, { ...next, definitions: new Map(next.definitions).set(d.id, { ...d, annotations }) }];
}

/** Remove annotations from a definition; the same scene when none go. */
export function removeAnnotations(s: Scene, definitionId: DefinitionId, ids: Iterable<AnnotationId>): Scene {
  const d = s.definitions.get(definitionId);
  if (!d || !d.annotations.size) return s;
  const annotations = new Map(d.annotations);
  for (const id of ids) annotations.delete(id);
  if (annotations.size === d.annotations.size) return s;
  return { ...s, definitions: new Map(s.definitions).set(d.id, { ...d, annotations }) };
}
