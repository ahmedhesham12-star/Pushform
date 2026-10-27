/**
 * The scene seen from the world: where every definition's geometry is placed,
 * and the snap points and edges of all of it in world coordinates. Tools snap
 * to everything visible, inside the editing context or not.
 */
import { listEdges, snapPoints, type Model, type Point3, type SnapKind } from '../kernel';
import { dimensionLength, transformAnnotation, type Annotation, type AnnotationId } from './annotations';
import { transformGuide, type Guide, type GuideId } from './guides';
import { placedInstances, rootDefinition, type Definition, type InstanceId, type Scene } from './scene';
import { applyPoint, IDENTITY, type Transform } from './transform';

export interface Placement {
  /** Instance path from the root to this placement ([] for the root's own geometry). */
  readonly path: readonly InstanceId[];
  readonly definition: Definition;
  /** Local space of the definition to world space. */
  readonly world: Transform;
}

/** The root's geometry, then every instance's geometry, depth first. */
export function placements(s: Scene): Placement[] {
  const out: Placement[] = [{ path: [], definition: rootDefinition(s), world: IDENTITY }];
  for (const p of placedInstances(s)) out.push({ path: p.path, definition: s.definitions.get(p.instance.definitionId)!, world: p.world });
  return out;
}

/**
 * How geometry placed at `path` relates to the editing context open at
 * `context`: it is the context's own (editable) geometry, inside the context
 * (a nested instance, selectable as a whole), or outside it (faded).
 */
export function contextRelation(path: readonly InstanceId[], context: readonly InstanceId[]): 'context' | 'inside' | 'outside' {
  if (path.length < context.length || context.some((id, i) => path[i] !== id)) return 'outside';
  return path.length === context.length ? 'context' : 'inside';
}

export interface WorldSnap {
  readonly point: Point3;
  readonly kind: SnapKind;
  readonly path: readonly InstanceId[];
  /** The vertex at an endpoint, in its definition's model. */
  readonly vertex?: string;
}

export interface WorldEdge {
  readonly edgeId: string;
  readonly a: Point3;
  readonly b: Point3;
  readonly path: readonly InstanceId[];
}

/** Endpoints and midpoints of the visible edges of every placement, in world coordinates. */
export function worldSnapPoints(s: Scene): WorldSnap[] {
  const local = new Map<Model, ReturnType<typeof snapPoints>>();
  const out: WorldSnap[] = [];
  for (const p of placements(s)) {
    const m = p.definition.model;
    if (!local.has(m)) local.set(m, snapPoints(m));
    for (const sp of local.get(m)!) out.push({ point: applyPoint(p.world, sp.point), kind: sp.kind, path: p.path, ...(sp.vertex ? { vertex: sp.vertex } : {}) });
  }
  return out;
}

/** The visible (not soft) edges of every placement, in world coordinates. */
export function worldEdges(s: Scene): WorldEdge[] {
  const local = new Map<Model, ReturnType<typeof listEdges>>();
  const out: WorldEdge[] = [];
  for (const p of placements(s)) {
    const m = p.definition.model;
    if (!local.has(m)) local.set(m, listEdges(m).filter((e) => !e.soft));
    for (const e of local.get(m)!) out.push({ edgeId: e.id, a: applyPoint(p.world, e.a), b: applyPoint(p.world, e.b), path: p.path });
  }
  return out;
}

export interface WorldGuide {
  readonly guideId: GuideId;
  /** The guide in world coordinates. */
  readonly guide: Guide;
  readonly path: readonly InstanceId[];
}

/** The guides of every placement, in world coordinates. */
export function worldGuides(s: Scene): WorldGuide[] {
  const out: WorldGuide[] = [];
  for (const p of placements(s)) {
    for (const [guideId, g] of p.definition.guides) out.push({ guideId, guide: transformGuide(p.world, g), path: p.path });
  }
  return out;
}

export interface WorldAnnotation {
  readonly annotationId: AnnotationId;
  /** The annotation in world coordinates. */
  readonly annotation: Annotation;
  /** What a dimension shows: its length in its own definition's mm. */
  readonly length: number;
  readonly path: readonly InstanceId[];
}

/** The annotations of every placement, in world coordinates. */
export function worldAnnotations(s: Scene): WorldAnnotation[] {
  const out: WorldAnnotation[] = [];
  for (const p of placements(s)) {
    for (const [annotationId, a] of p.definition.annotations) {
      out.push({ annotationId, annotation: transformAnnotation(p.world, a), length: dimensionLength(a), path: p.path });
    }
  }
  return out;
}
