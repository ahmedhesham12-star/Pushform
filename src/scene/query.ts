/**
 * The scene seen from the world: where every definition's geometry is placed,
 * and the snap points and edges of all of it in world coordinates. Tools snap
 * to everything visible, inside the editing context or not. What a hidden tag
 * hides is left out; the open editing context (and the instances leading to
 * it) is always shown, so it can still be edited.
 */
import { listEdges, snapPoints, type Bounds, type Model, type Point3, type SnapKind } from '../kernel';
import { dimensionLength, transformAnnotation, type Annotation, type AnnotationId } from './annotations';
import { transformGuide, type Guide, type GuideId } from './guides';
import { meshSnapPoints, meshPoint, snapsToEdges, type MeshData } from './mesh';
import { ownBounds, placedInstances, rootDefinition, transformBounds, union, type Definition, type InstanceId, type Scene } from './scene';
import { tagShown } from './tags';
import { AFFINE_IDENTITY, applyPoint, type Affine } from './transform';

export interface Placement {
  /** Instance path from the root to this placement ([] for the root's own geometry). */
  readonly path: readonly InstanceId[];
  readonly definition: Definition;
  /** Local space of the definition to world space. */
  readonly world: Affine;
}

/** Whether an instance path leads to (or is) the open context. */
const onContextPath = (path: readonly InstanceId[], context: readonly InstanceId[]) => path.length <= context.length && path.every((id, i) => context[i] === id);

/** The root's geometry, then every shown instance's geometry, depth first. */
export function placements(s: Scene, context: readonly InstanceId[] = []): Placement[] {
  const out: Placement[] = [{ path: [], definition: rootDefinition(s), world: AFFINE_IDENTITY }];
  const hidden = (i: { readonly tag?: string }, path: readonly InstanceId[]) => !tagShown(s, i.tag) && !onContextPath(path, context);
  for (const p of placedInstances(s, s.rootId, AFFINE_IDENTITY, [], hidden)) out.push({ path: p.path, definition: s.definitions.get(p.instance.definitionId)!, world: p.world });
  return out;
}

/** The box around everything shown, for Zoom extents: what a hidden tag hides is left out, as in SketchUp. */
export function shownBounds(s: Scene, context: readonly InstanceId[] = []): Bounds | null {
  let out: Bounds | null = null;
  for (const p of placements(s, context)) out = union(out, transformBounds(p.world, ownBounds(p.definition)));
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

/** Edge ids of a reference mesh's feature edges start with this; they name no kernel edge. */
export const MESH_EDGE = 'mesh:';

export interface WorldEdge {
  readonly edgeId: string;
  readonly a: Point3;
  readonly b: Point3;
  readonly path: readonly InstanceId[];
}

/** Endpoints and midpoints of the visible edges of every placement (feature edges for reference meshes), in world coordinates. */
export function worldSnapPoints(s: Scene, context: readonly InstanceId[] = []): WorldSnap[] {
  const local = new Map<Model, ReturnType<typeof snapPoints>>();
  const meshes = new Map<MeshData, ReturnType<typeof meshSnapPoints>>();
  const out: WorldSnap[] = [];
  for (const p of placements(s, context)) {
    const mesh = p.definition.mesh;
    if (mesh) {
      if (!meshes.has(mesh)) meshes.set(mesh, snapsToEdges(mesh) ? meshSnapPoints(mesh) : []);
      for (const sp of meshes.get(mesh)!) out.push({ point: applyPoint(p.world, sp.point), kind: sp.kind, path: p.path });
      continue;
    }
    const m = p.definition.model;
    if (!local.has(m)) local.set(m, snapPoints(m));
    for (const sp of local.get(m)!) out.push({ point: applyPoint(p.world, sp.point), kind: sp.kind, path: p.path, ...(sp.vertex ? { vertex: sp.vertex } : {}) });
  }
  return out;
}

/** The visible (not soft) edges of every placement, and the feature edges of reference meshes, in world coordinates. */
export function worldEdges(s: Scene, context: readonly InstanceId[] = []): WorldEdge[] {
  const local = new Map<Model, ReturnType<typeof listEdges>>();
  const out: WorldEdge[] = [];
  for (const p of placements(s, context)) {
    const mesh = p.definition.mesh;
    if (mesh) {
      for (let e = 0; snapsToEdges(mesh) && e < mesh.edges.length; e += 2) {
        out.push({ edgeId: MESH_EDGE + e / 2, a: applyPoint(p.world, meshPoint(mesh, mesh.edges[e]!)), b: applyPoint(p.world, meshPoint(mesh, mesh.edges[e + 1]!)), path: p.path });
      }
      continue;
    }
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

/** The shown guides of every placement, in world coordinates. */
export function worldGuides(s: Scene, context: readonly InstanceId[] = []): WorldGuide[] {
  const out: WorldGuide[] = [];
  for (const p of placements(s, context)) {
    for (const [guideId, g] of p.definition.guides) if (tagShown(s, g.tag)) out.push({ guideId, guide: transformGuide(p.world, g), path: p.path });
  }
  return out;
}

export interface WorldAnnotation {
  readonly annotationId: AnnotationId;
  /** The annotation in world coordinates. */
  readonly annotation: Annotation;
  /** What a dimension shows: its length in its own definition's mm; null for text. */
  readonly length: number | null;
  readonly path: readonly InstanceId[];
}

/** The shown annotations of every placement, in world coordinates. Screen text shows once, with its definition's first placement. */
export function worldAnnotations(s: Scene, context: readonly InstanceId[] = []): WorldAnnotation[] {
  const out: WorldAnnotation[] = [];
  const onScreen = new Set<string>();
  for (const p of placements(s, context)) {
    for (const [annotationId, a] of p.definition.annotations) {
      if (!tagShown(s, a.tag)) continue;
      if (a.kind === 'screenText') {
        if (onScreen.has(annotationId)) continue;
        onScreen.add(annotationId);
      }
      const length = a.kind === 'dimension' ? dimensionLength(a) : null;
      out.push({ annotationId, annotation: transformAnnotation(p.world, a), length, path: p.path });
    }
  }
  return out;
}
