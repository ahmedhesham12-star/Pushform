/**
 * Annotations: dimensions and text (milestone 4) a definition holds next to
 * its geometry, in its local mm. Dimension ends and the point a text's
 * leader points at are anchors, attached to a vertex or to a point along an
 * edge of the definition's geometry or of a nested group or component, so
 * they follow when that geometry moves. Like guides, they never split or
 * join geometry.
 */
import { edgeThrough, snapPoint, VERTEX_TOLERANCE, vertexAt, vertexPoint, type Model, type Point3, type Vec3 } from '../kernel';
import { newId, placedInstances, type Definition, type DefinitionId, type InstanceId, type Scene } from './scene';
import { AFFINE_IDENTITY, applyPoint, applyVector, invert, multiply, type Affine, type AnyTransform } from './transform';

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

/** Text with a leader line from an anchor; the text sits at the anchor plus `leader`. */
export interface LeaderText {
  readonly kind: 'text';
  readonly anchor: Anchor;
  readonly leader: Vec3;
  readonly text: string;
}

/**
 * Text fixed on the screen, not in the model: `position` is the fraction of
 * the view's width and height from its top left corner to the text's.
 */
export interface ScreenText {
  readonly kind: 'screenText';
  readonly position: readonly [number, number];
  readonly text: string;
}

export type Annotation = Dimension | LeaderText | ScreenText;

/** The local space at the end of `path`, below a definition: its transform into that definition and its definition id. */
function below(s: Scene, from: DefinitionId, path: readonly InstanceId[]): { transform: Affine; definitionId: DefinitionId } | null {
  let transform = AFFINE_IDENTITY;
  let definitionId = from;
  for (const id of path) {
    const i = s.definitions.get(definitionId)?.instances.get(id);
    if (!i) return null;
    transform = multiply(transform, i.transform);
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
 * then at nested groups and components; free when there is neither. An
 * attached anchor takes the exact position of what it is attached to (the
 * point may be off it by up to the vertex tolerance), so following it again
 * changes nothing.
 */
export function attachAnchor(s: Scene, definitionId: DefinitionId, point: Point3): Anchor {
  const p = snapPoint(point);
  const def = s.definitions.get(definitionId);
  if (!def) return { point: p };
  const places = [{ path: [] as readonly InstanceId[], definitionId, world: AFFINE_IDENTITY }];
  for (const placed of placedInstances(s, definitionId)) places.push({ path: placed.path, definitionId: placed.instance.definitionId, world: placed.world });
  const local = (world: Affine, q: Point3): Point3 => applyPoint(invert(world), q);
  for (const place of places) {
    const model = s.definitions.get(place.definitionId)!.model;
    const v = vertexAt(model, local(place.world, p), VERTEX_TOLERANCE);
    if (v) return attached(s, definitionId, p, { path: place.path, definitionId: place.definitionId, a: v });
  }
  for (const place of places) {
    const model = s.definitions.get(place.definitionId)!.model;
    const e = edgeThrough(model, local(place.world, p), VERTEX_TOLERANCE);
    if (e) return attached(s, definitionId, p, { path: place.path, definitionId: place.definitionId, a: e.a, b: e.b, t: e.t });
  }
  return { point: p };
}

const attached = (s: Scene, definitionId: DefinitionId, p: Point3, ref: AnchorRef): Anchor => ({ point: resolve(s, definitionId, ref) ?? p, ref });

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
      const next = withAnchors(a, (x) => follow(s, d.id, x));
      if (next === a) continue;
      annotations ??= new Map(d.annotations);
      annotations.set(id, next);
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

/** An annotation with each anchor mapped; the same annotation when none changed. */
function withAnchors(a: Annotation, map: (x: Anchor) => Anchor): Annotation {
  if (a.kind === 'dimension') {
    const [start, end] = [map(a.start), map(a.end)];
    return start === a.start && end === a.end ? a : { ...a, start, end };
  }
  if (a.kind === 'text') {
    const anchor = map(a.anchor);
    return anchor === a.anchor ? a : { ...a, anchor };
  }
  return a;
}

/** An annotation placed with a transform (into a parent's space, or the world). References are kept. */
export function transformAnnotation(t: AnyTransform, a: Annotation): Annotation {
  const moved = withAnchors(a, (x) => ({ ...x, point: snapPoint(applyPoint(t, x.point)) }));
  if (moved.kind === 'dimension') return { ...moved, offset: applyVector(t, moved.offset) };
  if (moved.kind === 'text') return { ...moved, leader: applyVector(t, moved.leader) };
  return moved;
}

/** Change the text of a text annotation; the same scene when it is not one or the text is unchanged. */
export function setAnnotationText(s: Scene, definitionId: DefinitionId, id: AnnotationId, text: string): Scene {
  const d = s.definitions.get(definitionId);
  const a = d?.annotations.get(id);
  if (!d || !a || a.kind === 'dimension' || a.text === text) return s;
  const annotations = new Map(d.annotations).set(id, { ...a, text });
  return { ...s, definitions: new Map(s.definitions).set(d.id, { ...d, annotations }) };
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

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const plus = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** The part of v square to the line from a to b. */
function across(v: Vec3, a: Vec3, b: Vec3): Vec3 {
  const d = sub(b, a);
  const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const k = l2 ? (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / l2 : 0;
  return [v[0] - d[0] * k, v[1] - d[1] * k, v[2] - d[2] * k];
}

/**
 * Move or turn annotations of a definition with a rigid transform, after
 * the geometry the same command changed. Attached ends go where their
 * geometry went and free ends go with the transform. The text and the
 * dimension line go with the transform, and the leader or offset is
 * measured again from where the ends are now: a dimension moved on its own
 * slides square to its measured line, and one moved with its geometry keeps
 * its offset. Screen text does not move. The scene returned has every
 * anchor followed.
 */
export function transformAnnotations(s: Scene, definitionId: DefinitionId, ids: Iterable<AnnotationId>, t: AnyTransform): Scene {
  const followed = followAnchors(s);
  const before = s.definitions.get(definitionId);
  const d = followed.definitions.get(definitionId);
  if (!before || !d) return followed;
  const moved = (a0: Anchor, a1: Anchor): Anchor => (a1.ref ? a1 : { point: snapPoint(applyPoint(t, a0.point)) });
  let annotations: Map<AnnotationId, Annotation> | null = null;
  for (const id of ids) {
    const a0 = before.annotations.get(id);
    const a1 = d.annotations.get(id);
    if (!a0 || !a1 || a0.kind === 'screenText' || a1.kind === 'screenText') continue;
    let next: Annotation;
    if (a0.kind === 'text' && a1.kind === 'text') {
      const anchor = moved(a0.anchor, a1.anchor);
      next = { ...a1, anchor, leader: sub(applyPoint(t, plus(a0.anchor.point, a0.leader)), anchor.point) };
    } else if (a0.kind === 'dimension' && a1.kind === 'dimension') {
      const [start, end] = [moved(a0.start, a1.start), moved(a0.end, a1.end)];
      const line = applyPoint(t, plus(a0.start.point, across(a0.offset, a0.start.point, a0.end.point)));
      next = { ...a1, start, end, offset: across(sub(line, start.point), start.point, end.point) };
    } else continue;
    annotations ??= new Map(d.annotations);
    annotations.set(id, next);
  }
  if (!annotations) return followed;
  return { ...followed, definitions: new Map(followed.definitions).set(d.id, { ...d, annotations }) };
}

/**
 * Annotations moved into a new definition (Make Group, Make Component),
 * with `toLocal` taking points there. References to the parent's own
 * geometry now name the new definition when it holds those vertices (the
 * geometry went with them, keeping its ids); others attach again by position
 * or come loose when the session follows them.
 */
export function rehomeAnnotations(
  annotations: ReadonlyMap<AnnotationId, Annotation>,
  from: DefinitionId,
  to: DefinitionId,
  model: Model,
  toLocal: AnyTransform,
): Map<AnnotationId, Annotation> {
  const out = new Map<AnnotationId, Annotation>();
  const rehome = (x: Anchor): Anchor => {
    const r = x.ref;
    if (!r || r.path.length || r.definitionId !== from) return x;
    if (!vertexPoint(model, r.a) || (r.b !== undefined && !vertexPoint(model, r.b))) return x;
    return { ...x, ref: { ...r, definitionId: to } };
  };
  for (const [id, a] of annotations) out.set(id, transformAnnotation(toLocal, withAnchors(a, rehome)));
  return out;
}
