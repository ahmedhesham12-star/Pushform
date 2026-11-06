/**
 * Library items (milestone 6): a component (or reference mesh) saved on the
 * device to insert into any file. An item is a small .pushform document whose
 * model holds one instance of it at the origin, with the definitions inside
 * it and the materials they use. Tags are left behind: an inserted item is
 * Untagged.
 */
import { createModel, listFaces, replacePaint } from '../kernel';
import {
  addDefinition,
  addMaterial,
  withTag,
  newId,
  type Definition,
  type DefinitionId,
  type Instance,
  type InstanceId,
  type MaterialId,
  type Scene,
} from '../scene';
import { documentFromText, documentToText, type PushformDocument } from './document';

/** The definitions a definition holds, at any depth, with itself, inner ones first. */
function reachable(scene: Scene, id: DefinitionId, out: DefinitionId[] = []): DefinitionId[] {
  if (out.includes(id)) return out;
  for (const i of scene.definitions.get(id)?.instances.values() ?? []) reachable(scene, i.definitionId, out);
  out.push(id);
  return out;
}

/** The materials a definition's faces and instances use. */
function materialsOf(d: Definition): MaterialId[] {
  const out = new Set<MaterialId>();
  for (const f of listFaces(d.model)) for (const id of [f.paint?.front, f.paint?.back]) if (id) out.add(id);
  for (const i of d.instances.values()) if (i.material) out.add(i.material);
  return [...out];
}

/** A definition with its instances, guides and annotations Untagged. */
const untagged = (d: Definition): Definition => ({
  ...d,
  instances: new Map([...d.instances].map(([id, i]) => [id, withTag(i, null)])),
  guides: new Map([...d.guides].map(([id, g]) => [id, withTag(g, null)])),
  annotations: new Map([...d.annotations].map(([id, a]) => [id, withTag(a, null)])),
});

/**
 * A component or mesh of a document as a library item: the text of its own
 * small document. `material` is the one its instance was painted with, which
 * the item keeps.
 */
export function libraryItem(doc: PushformDocument, definitionId: DefinitionId, material?: MaterialId): string {
  const scene = doc.scene;
  const ids = reachable(scene, definitionId);
  const definitions = new Map<DefinitionId, Definition>(ids.map((id) => [id, untagged(scene.definitions.get(id)!)]));
  const used = new Set(ids.flatMap((id) => materialsOf(scene.definitions.get(id)!)));
  const painted = material && scene.materials.has(material) ? material : undefined;
  if (painted) used.add(painted);
  const instanceId = `i${scene.next}`;
  const placed: Instance = { id: instanceId, definitionId, name: '', transform: { rotation: [0, 0, 0, 1], translation: [0, 0, 0], scale: [1, 1, 1] }, ...(painted ? { material: painted } : {}) };
  definitions.set(scene.rootId, { id: scene.rootId, kind: 'root', name: '', model: createModel(), instances: new Map([[instanceId, placed]]), guides: new Map(), annotations: new Map() });
  const item: Scene = { rootId: scene.rootId, definitions, tags: new Map(), materials: new Map([...scene.materials].filter(([id]) => used.has(id))), next: scene.next + 1 };
  return documentToText({ scene: item, units: doc.units, workspace: doc.workspace });
}

/** The saved definition of an item, the material it was painted with, and its document; null when the text is not an item. */
export function readItem(text: string): { doc: PushformDocument; definitionId: DefinitionId; material?: MaterialId } | null {
  const doc = documentFromText(text);
  const root = doc?.scene.definitions.get(doc.scene.rootId);
  const [only] = root?.instances.values() ?? [];
  if (!doc || !root || !only || root.instances.size !== 1 || listFaces(root.model).length) return null;
  return { doc, definitionId: only.definitionId, ...(only.material ? { material: only.material } : {}) };
}

/**
 * Bring an item's definitions into a scene under new ids: its materials match
 * the scene's by name (the scene's own is used) and the missing ones are
 * added. Returns the item's definition in the scene. Inserting an item again
 * makes another copy of its definitions. Also gives where each of the
 * item's materials went.
 */
export function mergeItem(scene: Scene, item: Scene, top: DefinitionId): [DefinitionId, Scene, ReadonlyMap<MaterialId, MaterialId>] {
  let out = scene;
  const materials = new Map<MaterialId, MaterialId>();
  for (const [id, m] of item.materials) {
    const same = [...out.materials].find(([, x]) => x.name === m.name);
    let to: MaterialId;
    if (same) to = same[0];
    else [to, out] = addMaterial(out, m);
    materials.set(id, to);
  }
  const names = new Set([...out.definitions.values()].map((d) => d.name));
  const definitions = new Map<DefinitionId, DefinitionId>();
  for (const id of reachable(item, top)) {
    const d = item.definitions.get(id)!;
    // Paint names the item's materials: through placeholders first, so one renamed id never meets another.
    let model = d.model;
    for (const from of materials.keys()) model = replacePaint(model, from, `\u0000${from}`);
    for (const [from, to] of materials) model = replacePaint(model, `\u0000${from}`, to);
    const instances = new Map<InstanceId, Instance>();
    for (const i of d.instances.values()) {
      let iid: InstanceId;
      [iid, out] = newId(out, 'i');
      const { material, ...rest } = i;
      instances.set(iid, { ...rest, id: iid, definitionId: definitions.get(i.definitionId)!, ...(material && materials.has(material) ? { material: materials.get(material)! } : {}) });
    }
    let name = d.name;
    if (id === top && name && names.has(name)) {
      let n = 2;
      while (names.has(`${d.name} (${n})`)) n++;
      name = `${d.name} (${n})`;
    }
    let copy: DefinitionId;
    [copy, out] = addDefinition(out, { ...d, name, model, instances });
    definitions.set(id, copy);
  }
  return [definitions.get(top)!, out, materials];
}
