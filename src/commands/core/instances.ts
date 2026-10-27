import { z } from 'zod';
import { t } from '../../i18n';
import {
  bounds,
  createModel,
  extractGeometry,
  hasEdge,
  hasFace,
  mergeGeometry,
  snapPoint,
  transformGeometry,
  type Point3,
} from '../../kernel';
import {
  addDefinition,
  addAnnotation,
  addGuide,
  applyPoint,
  applyVector,
  compose,
  definitionBounds,
  duplicateDefinition,
  findInstance,
  getDefinition,
  instanceCount,
  newId,
  pruneDefinitions,
  putInstance,
  rehomeAnnotations,
  removeAnnotations,
  removeInstance,
  setModel,
  snapTransform,
  transformBounds,
  transformAnnotation,
  transformGuide,
  translation,
  union,
  updateDefinition,
  type DefinitionId,
  type DefinitionKind,
  type Instance,
  type InstanceId,
  type Scene,
} from '../../scene';
import type { PushformDocument } from '../document';
import type { CommandDef, RunResult } from '../types';
import { definitionId, faceId, point3, targetModel } from './schemas';

const instanceId = z.string().min(1);
const name = z.string().trim().max(200);

/** The first "Base#n" no definition is called yet. */
function uniqueName(s: Scene, base: string): string {
  const used = new Set([...s.definitions.values()].map((d) => d.name));
  let n = 1;
  while (used.has(`${base}#${n}`)) n++;
  return `${base}#${n}`;
}

/**
 * An instance placed again in its parent: a component shares its definition;
 * a group gets its own copy, which shares the geometry until one of them is edited.
 */
export function placeCopy(s: Scene, parent: DefinitionId, i: Instance, transform: Instance['transform']): [InstanceId, Scene] {
  let definition = i.definitionId;
  if (s.definitions.get(definition)?.kind === 'group') [definition, s] = duplicateDefinition(s, definition);
  let id: InstanceId;
  [id, s] = newId(s, 'i');
  return [id, putInstance(s, parent, { ...i, id, definitionId: definition, transform: snapTransform(transform) })];
}

/* ---------- make group, make component ---------- */

type Ids = string[] | undefined;
const selected = (v: { faceIds?: Ids; edgeIds?: Ids; instanceIds?: Ids; annotationIds?: Ids }) =>
  (v.faceIds?.length ?? 0) + (v.edgeIds?.length ?? 0) + (v.instanceIds?.length ?? 0) + (v.annotationIds?.length ?? 0) > 0;

export const makeGroupInput = z
  .strictObject({
    /** The editing context the selection is in (the root when omitted). */
    definitionId,
    faceIds: z.array(faceId).optional(),
    edgeIds: z.array(z.string().min(1)).optional(),
    instanceIds: z.array(instanceId).optional(),
    /** Dimensions and text of the context, which move into the new definition. */
    annotationIds: z.array(z.string().min(1)).optional(),
  })
  .refine(selected, { message: 'nothing selected' });
export type MakeGroupInput = z.infer<typeof makeGroupInput>;

export const makeComponentInput = z
  .strictObject({
    definitionId,
    faceIds: z.array(faceId).optional(),
    edgeIds: z.array(z.string().min(1)).optional(),
    instanceIds: z.array(instanceId).optional(),
    annotationIds: z.array(z.string().min(1)).optional(),
    /** Definition name; "Component#n" when omitted. */
    name: name.min(1).optional(),
  })
  .refine(selected, { message: 'nothing selected' });
export type MakeComponentInput = z.infer<typeof makeComponentInput>;

export interface MakeInstanceOutput {
  definitionId: DefinitionId;
  /** The new instance, placed where the selection was. */
  instanceId: InstanceId;
}

/**
 * Move the selected geometry, instances, dimensions and text of a context into a new definition
 * and place one instance of it in the context. The new definition's origin is
 * the minimum corner of the selection's bounding box, with axes aligned to the
 * context. Edges shared with geometry left behind are copied.
 */
function encapsulate(
  doc: PushformDocument,
  input: MakeGroupInput,
  kind: DefinitionKind,
  definitionName: string | undefined,
): RunResult<MakeInstanceOutput> {
  const target = targetModel(doc, input.definitionId);
  if (!target.ok) return target;
  const contextId = input.definitionId ?? doc.scene.rootId;
  const context = getDefinition(doc.scene, contextId)!;
  const faces = (input.faceIds ?? []).filter((f) => hasFace(target.model, f));
  const edges = (input.edgeIds ?? []).filter((e) => hasEdge(target.model, e));
  const instances = [...new Set(input.instanceIds ?? [])].filter((i) => context.instances.has(i));
  const annotationIds = [...new Set(input.annotationIds ?? [])].filter((a) => context.annotations.has(a));
  if (!faces.length && !edges.length && !instances.length && !annotationIds.length) {
    return { ok: false, error: { code: 'nothingSelected', detail: JSON.stringify(input) } };
  }

  const split = faces.length || edges.length ? extractGeometry(target.model, faces, edges) : { remaining: target.model, extracted: createModel() };
  let box = bounds(split.extracted);
  for (const id of instances) {
    const i = context.instances.get(id)!;
    box = union(box, transformBounds(i.transform, definitionBounds(doc.scene, i.definitionId)));
  }
  const origin: Point3 = box ? snapPoint(box.min) : [0, 0, 0];
  const toLocal = (p: Point3): Point3 => [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
  const model = transformGeometry(split.extracted, toLocal, (v) => v);

  let scene = setModel(doc.scene, contextId, split.remaining);
  const moved = new Map<InstanceId, Instance>();
  for (const id of instances) {
    const i = context.instances.get(id)!;
    moved.set(id, { ...i, transform: snapTransform({ ...i.transform, translation: toLocal(i.transform.translation) }) });
    scene = removeInstance(scene, contextId, id);
  }
  const defName = kind === 'component' ? (definitionName ?? uniqueName(scene, t('scene.component'))) : '';
  let defId: DefinitionId;
  [defId, scene] = addDefinition(scene, { kind, name: defName, model, instances: moved });
  if (annotationIds.length) {
    const taken = new Map(annotationIds.map((id) => [id, context.annotations.get(id)!]));
    const annotations = rehomeAnnotations(taken, contextId, defId, model, translation([-origin[0], -origin[1], -origin[2]]));
    scene = updateDefinition(removeAnnotations(scene, contextId, annotationIds), defId, { annotations });
  }
  let instId: InstanceId;
  [instId, scene] = newId(scene, 'i');
  scene = putInstance(scene, contextId, { id: instId, definitionId: defId, name: '', transform: translation(origin) });
  return { ok: true, doc: { ...doc, scene }, output: { definitionId: defId, instanceId: instId } };
}

/** Turn the selection into a group: a definition used once, which nothing else shares. */
export const makeGroup: CommandDef<MakeGroupInput, MakeInstanceOutput> = {
  id: 'core.makeGroup',
  title: () => t('command.makeGroup'),
  input: makeGroupInput,
  run: (doc, input) => encapsulate(doc, input, 'group', undefined),
};

/** Turn the selection into a component: a named definition that copies share. */
export const makeComponent: CommandDef<MakeComponentInput, MakeInstanceOutput> = {
  id: 'core.makeComponent',
  title: () => t('command.makeComponent'),
  input: makeComponentInput,
  run: (doc, input) => encapsulate(doc, input, 'component', input.name),
};

/* ---------- explode ---------- */

export const explodeInput = z.strictObject({ instanceIds: z.array(instanceId).min(1) });
export type ExplodeInput = z.infer<typeof explodeInput>;
export interface ExplodeOutput {
  /** New faces in the parent from the exploded geometry (faces it merged into keep their ids). */
  faceIds: string[];
  /** Instances that were nested in the exploded ones, now in the parent. */
  instanceIds: InstanceId[];
}

/**
 * Replace instances by their contents: the geometry merges into the parent's
 * geometry (coplanar faces join, crossing edges split), and nested instances
 * guides and dimensions move up to the parent. Definitions no longer used are removed.
 */
export const explode: CommandDef<ExplodeInput, ExplodeOutput> = {
  id: 'core.explode',
  title: () => t('command.explode'),
  input: explodeInput,
  run(doc, input) {
    let scene = doc.scene;
    const created: { parent: DefinitionId; face: string }[] = [];
    const instanceIds: InstanceId[] = [];
    let exploded = 0;
    for (const id of new Set(input.instanceIds)) {
      const found = findInstance(scene, id);
      if (!found) continue;
      exploded++;
      const { instance, parent } = found;
      const def = getDefinition(scene, instance.definitionId)!;
      const T = instance.transform;
      const placed = transformGeometry(def.model, (p) => applyPoint(T, p), (v) => applyVector(T, v));
      const merged = mergeGeometry(parent.model, placed);
      scene = removeInstance(setModel(scene, parent.id, merged.model), parent.id, id);
      for (const f of merged.faceIds) created.push({ parent: parent.id, face: f });
      for (const j of def.instances.values()) {
        let nid: InstanceId;
        [nid, scene] = placeCopy(scene, parent.id, j, compose(T, j.transform));
        instanceIds.push(nid);
      }
      for (const g of def.guides.values()) [, scene] = addGuide(scene, parent.id, transformGuide(T, g));
      // Their references name the exploded definition, so they attach again in the parent by position.
      for (const a of def.annotations.values()) [, scene] = addAnnotation(scene, parent.id, transformAnnotation(T, a));
    }
    if (!exploded) return { ok: false, error: { code: 'noSuchInstance', detail: input.instanceIds.join(', ') } };
    scene = pruneDefinitions(scene);
    const faceIds = created.filter((c) => hasFace(scene.definitions.get(c.parent)!.model, c.face)).map((c) => c.face);
    return { ok: true, doc: { ...doc, scene }, output: { faceIds, instanceIds } };
  },
};

/* ---------- make unique ---------- */

export const makeUniqueInput = z.strictObject({ instanceIds: z.array(instanceId).min(1) });
export type MakeUniqueInput = z.infer<typeof makeUniqueInput>;
export interface MakeUniqueOutput {
  /** New definitions, one per component the selection shared with other instances. */
  definitionIds: DefinitionId[];
}

/**
 * Give selected component instances their own definition, so editing them no
 * longer changes the other copies. Selected instances of one component share
 * the new definition. Instances that already use their definition alone are
 * left as they are (groups always do).
 */
export const makeUnique: CommandDef<MakeUniqueInput, MakeUniqueOutput> = {
  id: 'core.makeUnique',
  title: () => t('command.makeUnique'),
  input: makeUniqueInput,
  run(doc, input) {
    let scene = doc.scene;
    const byDefinition = new Map<DefinitionId, { instance: Instance; parent: DefinitionId }[]>();
    for (const id of new Set(input.instanceIds)) {
      const found = findInstance(scene, id);
      if (!found) continue;
      const list = byDefinition.get(found.instance.definitionId) ?? [];
      list.push({ instance: found.instance, parent: found.parent.id });
      byDefinition.set(found.instance.definitionId, list);
    }
    if (!byDefinition.size) return { ok: false, error: { code: 'noSuchInstance', detail: input.instanceIds.join(', ') } };
    const definitionIds: DefinitionId[] = [];
    for (const [defId, list] of byDefinition) {
      const def = scene.definitions.get(defId)!;
      if (list.length >= instanceCount(scene, defId)) continue;
      let copy: DefinitionId;
      [copy, scene] = duplicateDefinition(scene, defId, { name: uniqueName(scene, def.name) });
      for (const { instance, parent } of list) scene = putInstance(scene, parent, { ...instance, definitionId: copy });
      definitionIds.push(copy);
    }
    if (!definitionIds.length) return { ok: true, doc, output: { definitionIds } };
    return { ok: true, doc: { ...doc, scene }, output: { definitionIds } };
  },
};

/* ---------- rename ---------- */

export const renameDefinitionInput = z.strictObject({ definitionId: z.string().min(1), name });
export type RenameDefinitionInput = z.infer<typeof renameDefinitionInput>;

/** Rename a component or group definition (the root has no name). */
export const renameDefinition: CommandDef<RenameDefinitionInput, Record<string, never>> = {
  id: 'core.renameDefinition',
  title: () => t('command.rename'),
  input: renameDefinitionInput,
  run(doc, input) {
    const def = getDefinition(doc.scene, input.definitionId);
    if (!def || def.kind === 'root') return { ok: false, error: { code: 'noSuchDefinition', detail: input.definitionId } };
    if (def.name === input.name) return { ok: true, doc, output: {} };
    return { ok: true, doc: { ...doc, scene: updateDefinition(doc.scene, def.id, { name: input.name }) }, output: {} };
  },
};

export const renameInstanceInput = z.strictObject({ instanceId, name });
export type RenameInstanceInput = z.infer<typeof renameInstanceInput>;

/** Name one instance; an empty name clears it. */
export const renameInstance: CommandDef<RenameInstanceInput, Record<string, never>> = {
  id: 'core.renameInstance',
  title: () => t('command.rename'),
  input: renameInstanceInput,
  run(doc, input) {
    const found = findInstance(doc.scene, input.instanceId);
    if (!found) return { ok: false, error: { code: 'noSuchInstance', detail: input.instanceId } };
    if (found.instance.name === input.name) return { ok: true, doc, output: {} };
    const scene = putInstance(doc.scene, found.parent.id, { ...found.instance, name: input.name });
    return { ok: true, doc: { ...doc, scene }, output: {} };
  },
};

/* ---------- copy ---------- */

export const copyInstancesInput = z.strictObject({
  instanceIds: z.array(instanceId).min(1),
  /** Offset of the copies from the originals, in the parent's space (mm). */
  translation: point3,
});
export type CopyInstancesInput = z.infer<typeof copyInstancesInput>;
export interface CopyInstancesOutput {
  /** The copies, in the order of the input. */
  instanceIds: InstanceId[];
}

/** Copy instances within their parent, moved by an offset. */
export const copyInstances: CommandDef<CopyInstancesInput, CopyInstancesOutput> = {
  id: 'core.copyInstances',
  title: () => t('command.copy'),
  input: copyInstancesInput,
  run(doc, input) {
    let scene = doc.scene;
    const instanceIds: InstanceId[] = [];
    for (const id of new Set(input.instanceIds)) {
      const found = findInstance(scene, id);
      if (!found) continue;
      let copy: InstanceId;
      [copy, scene] = placeCopy(scene, found.parent.id, found.instance, compose(translation(input.translation), found.instance.transform));
      instanceIds.push(copy);
    }
    if (!instanceIds.length) return { ok: false, error: { code: 'noSuchInstance', detail: input.instanceIds.join(', ') } };
    return { ok: true, doc: { ...doc, scene }, output: { instanceIds } };
  },
};

/** Remove instances from a context; definitions nothing uses any more go with them. */
export function removeInstances(scene: Scene, contextId: DefinitionId, ids: readonly InstanceId[]): Scene {
  const context = scene.definitions.get(contextId);
  if (!context) return scene;
  let out = scene;
  for (const id of ids) if (context.instances.has(id)) out = removeInstance(out, contextId, id);
  return out === scene ? scene : pruneDefinitions(out);
}
