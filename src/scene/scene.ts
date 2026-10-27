/**
 * The scene: a tree of definitions and instances.
 *
 * Every definition owns its own kernel Model (loose geometry in local mm) and
 * the instances placed inside it. The root definition is the model itself.
 * Geometry in different definitions never merges or splits each other.
 * Components share one definition between many instances; a group is a
 * definition used by a single instance. Scenes are immutable: updates return
 * a new scene that shares everything unchanged, including Model objects.
 */
import { bounds, type Bounds, type Model } from '../kernel';
import type { Annotation, AnnotationId } from './annotations';
import type { Guide, GuideId } from './guides';
import { applyPoint, compose, IDENTITY, type Transform } from './transform';

export type DefinitionId = string;
export type InstanceId = string;
export type DefinitionKind = 'root' | 'group' | 'component';

export interface Instance {
  readonly id: InstanceId;
  readonly definitionId: DefinitionId;
  /** Optional instance name; empty when unnamed. */
  readonly name: string;
  readonly transform: Transform;
}

export interface Definition {
  readonly id: DefinitionId;
  readonly kind: DefinitionKind;
  readonly name: string;
  readonly model: Model;
  /** Instances placed inside this definition, in its local space. */
  readonly instances: ReadonlyMap<InstanceId, Instance>;
  /** Guide lines and points, in its local space. */
  readonly guides: ReadonlyMap<GuideId, Guide>;
  /** Dimensions, in its local space. */
  readonly annotations: ReadonlyMap<AnnotationId, Annotation>;
}

/** What a new definition needs; guides and annotations start empty unless given. */
export type NewDefinition = Omit<Definition, 'id' | 'guides' | 'annotations'> & {
  readonly guides?: ReadonlyMap<GuideId, Guide>;
  readonly annotations?: ReadonlyMap<AnnotationId, Annotation>;
};

export interface Scene {
  readonly rootId: DefinitionId;
  readonly definitions: ReadonlyMap<DefinitionId, Definition>;
  /** Next id number for definitions, instances, guides and annotations. */
  readonly next: number;
}

export function createScene(rootModel: Model): Scene {
  const root: Definition = { id: 'd1', kind: 'root', name: '', model: rootModel, instances: new Map(), guides: new Map(), annotations: new Map() };
  return { rootId: root.id, definitions: new Map([[root.id, root]]), next: 2 };
}

export function rootDefinition(s: Scene): Definition {
  return s.definitions.get(s.rootId)!;
}

export function getDefinition(s: Scene, id: DefinitionId): Definition | undefined {
  return s.definitions.get(id);
}

/** The definition that contains an instance, with the instance. */
export function findInstance(s: Scene, id: InstanceId): { instance: Instance; parent: Definition } | undefined {
  for (const d of s.definitions.values()) {
    const instance = d.instances.get(id);
    if (instance) return { instance, parent: d };
  }
  return undefined;
}

/** How many instances of a definition exist anywhere in the scene. */
export function instanceCount(s: Scene, definitionId: DefinitionId): number {
  let n = 0;
  for (const d of s.definitions.values()) for (const i of d.instances.values()) if (i.definitionId === definitionId) n++;
  return n;
}

/** Whether `outer` contains `inner`, directly or through nested instances (or is it). */
export function contains(s: Scene, outer: DefinitionId, inner: DefinitionId, seen = new Set<DefinitionId>()): boolean {
  if (outer === inner) return true;
  // A visited set keeps a malformed (cyclic) scene from looping forever.
  if (seen.has(outer)) return false;
  seen.add(outer);
  const d = s.definitions.get(outer);
  if (!d) return false;
  for (const i of d.instances.values()) if (contains(s, i.definitionId, inner, seen)) return true;
  return false;
}

export interface PlacedInstance {
  /** Instance ids from the root down to this instance. */
  readonly path: readonly InstanceId[];
  readonly instance: Instance;
  /** Local space of the instance's definition to world space. */
  readonly world: Transform;
}

/** Every instance reachable from a definition (the root by default), depth first, with world transforms. */
export function placedInstances(s: Scene, from: DefinitionId = s.rootId, base: Transform = IDENTITY, path: readonly InstanceId[] = []): PlacedInstance[] {
  const out: PlacedInstance[] = [];
  const d = s.definitions.get(from);
  if (!d) return out;
  for (const instance of d.instances.values()) {
    const world = compose(base, instance.transform);
    const p = [...path, instance.id];
    out.push({ path: p, instance, world });
    out.push(...placedInstances(s, instance.definitionId, world, p));
  }
  return out;
}

/** The world transform of the local space at the end of an instance path ([] is the root). */
export function pathTransform(s: Scene, path: readonly InstanceId[]): Transform {
  let t = IDENTITY;
  let parent = s.rootId;
  for (const id of path) {
    const i = s.definitions.get(parent)?.instances.get(id);
    if (!i) break;
    t = compose(t, i.transform);
    parent = i.definitionId;
  }
  return t;
}

/** The definition at the end of an instance path ([] is the root), or undefined when the path is broken. */
export function pathDefinition(s: Scene, path: readonly InstanceId[]): Definition | undefined {
  let d = s.definitions.get(s.rootId);
  for (const id of path) {
    const i = d?.instances.get(id);
    if (!i) return undefined;
    d = s.definitions.get(i.definitionId);
  }
  return d;
}

/* ---------- updates (immutable) ---------- */

function withDefinition(s: Scene, d: Definition): Scene {
  return { ...s, definitions: new Map(s.definitions).set(d.id, d) };
}

/** Replace a definition's model. Returns the same scene when the model is unchanged. */
export function setModel(s: Scene, id: DefinitionId, model: Model): Scene {
  const d = s.definitions.get(id);
  if (!d || d.model === model) return s;
  return withDefinition(s, { ...d, model });
}

export const newId = (s: Scene, prefix: 'd' | 'i' | 'g' | 'a'): [string, Scene] => [`${prefix}${s.next}`, { ...s, next: s.next + 1 }];

export function addDefinition(s: Scene, def: NewDefinition): [DefinitionId, Scene] {
  const [id, next] = newId(s, 'd');
  return [id, withDefinition(next, { guides: new Map(), annotations: new Map(), ...def, id })];
}

export function putInstance(s: Scene, parent: DefinitionId, instance: Instance): Scene {
  const d = s.definitions.get(parent)!;
  return withDefinition(s, { ...d, instances: new Map(d.instances).set(instance.id, instance) });
}

export function removeInstance(s: Scene, parent: DefinitionId, id: InstanceId): Scene {
  const d = s.definitions.get(parent)!;
  const instances = new Map(d.instances);
  instances.delete(id);
  return withDefinition(s, { ...d, instances });
}

export function updateDefinition(s: Scene, id: DefinitionId, patch: Partial<Pick<Definition, 'name' | 'kind' | 'model'>>): Scene {
  const d = s.definitions.get(id);
  return d ? withDefinition(s, { ...d, ...patch }) : s;
}

/** Drop definitions that no instance uses any more (never the root). */
export function pruneDefinitions(s: Scene): Scene {
  const used = new Set<DefinitionId>([s.rootId]);
  const visit = (id: DefinitionId) => {
    for (const i of s.definitions.get(id)?.instances.values() ?? []) {
      if (used.has(i.definitionId)) continue;
      used.add(i.definitionId);
      visit(i.definitionId);
    }
  };
  visit(s.rootId);
  if (used.size === s.definitions.size) return s;
  return { ...s, definitions: new Map([...s.definitions].filter(([id]) => used.has(id))) };
}

/**
 * A copy of a definition under a new id, sharing its Model, guides and
 * annotations (all immutable, so the copy only diverges when one of them is
 * edited). Nested group definitions are copied too, so each group keeps a
 * single instance; nested components stay shared. Nested instances get new
 * ids, so the copied annotations attach again by position.
 */
export function duplicateDefinition(s: Scene, id: DefinitionId, patch: Partial<Pick<Definition, 'name' | 'kind'>> = {}): [DefinitionId, Scene] {
  const d = s.definitions.get(id)!;
  let next = s;
  const instances = new Map<InstanceId, Instance>();
  for (const i of d.instances.values()) {
    let definitionId = i.definitionId;
    if (next.definitions.get(definitionId)?.kind === 'group') [definitionId, next] = duplicateDefinition(next, definitionId);
    let iid: InstanceId;
    [iid, next] = newId(next, 'i');
    instances.set(iid, { ...i, id: iid, definitionId });
  }
  return addDefinition(next, { kind: d.kind, name: d.name, model: d.model, instances, guides: d.guides, annotations: d.annotations, ...patch });
}

/** Bounds of a definition's geometry and nested instances in its local space, or null when it is empty. */
export function definitionBounds(s: Scene, id: DefinitionId): Bounds | null {
  const d = s.definitions.get(id);
  if (!d) return null;
  let out = bounds(d.model);
  for (const i of d.instances.values()) out = union(out, transformBounds(i.transform, definitionBounds(s, i.definitionId)));
  return out;
}

/** The axis-aligned box around a box placed with a transform. */
export function transformBounds(t: Transform, b: Bounds | null): Bounds | null {
  if (!b) return null;
  let out: Bounds | null = null;
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]])
      for (const z of [b.min[2], b.max[2]]) {
        const p = applyPoint(t, [x, y, z]);
        out = union(out, { min: p, max: p });
      }
  return out;
}

export function union(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a || !b) return a ?? b;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}
