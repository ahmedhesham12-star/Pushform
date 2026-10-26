import { deserialize, serialize, type Model, type SerializedTopology } from '../kernel';
import { contains, createScene, type Definition, type DefinitionKind, type Instance, type Scene } from './scene';
import type { Quat, Transform } from './transform';

export interface SerializedTransform {
  rotation: number[];
  translation: number[];
  scale: number[];
}

/** Version 3 scene: definitions, each with its topology and the instances inside it. */
export interface SerializedScene {
  root: string;
  next: number;
  definitions: Record<
    string,
    {
      kind: DefinitionKind;
      name: string;
      model: SerializedTopology;
      instances: Record<string, { definition: string; name: string; transform: SerializedTransform }>;
    }
  >;
}

export function serializeScene(s: Scene): SerializedScene {
  const definitions: SerializedScene['definitions'] = {};
  for (const [id, d] of s.definitions) {
    const instances: SerializedScene['definitions'][string]['instances'] = {};
    for (const [iid, i] of d.instances) {
      instances[iid] = {
        definition: i.definitionId,
        name: i.name,
        transform: { rotation: [...i.transform.rotation], translation: [...i.transform.translation], scale: [...i.transform.scale] },
      };
    }
    definitions[id] = { kind: d.kind, name: d.name, model: serialize(d.model), instances };
  }
  return { root: s.rootId, next: s.next, definitions };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numbers = (v: unknown, n: number): v is number[] =>
  Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const KINDS: readonly DefinitionKind[] = ['root', 'group', 'component'];

function transform(v: unknown): Transform | null {
  if (!isObject(v) || !numbers(v.rotation, 4) || !numbers(v.translation, 3) || !numbers(v.scale, 3)) return null;
  // Scale arrives with Flip and Scale in milestone 4; until then only [1, 1, 1] is valid.
  if (!v.scale.every((x) => x === 1)) return null;
  const q = v.rotation;
  if (Math.abs(Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!) - 1) > 1e-6) return null;
  return { rotation: q as unknown as Quat, translation: v.translation as unknown as Transform['translation'], scale: [1, 1, 1] };
}

/** Validate and load a version 3 scene. Returns null for invalid data. */
export function deserializeScene(data: unknown): Scene | null {
  if (!isObject(data) || typeof data.root !== 'string' || !Number.isInteger(data.next) || !isObject(data.definitions)) return null;
  const definitions = new Map<string, Definition>();
  for (const [id, raw] of Object.entries(data.definitions)) {
    if (!isObject(raw) || !KINDS.includes(raw.kind as DefinitionKind) || typeof raw.name !== 'string' || !isObject(raw.instances)) return null;
    const model = deserialize(raw.model);
    if (!model) return null;
    const instances = new Map<string, Instance>();
    for (const [iid, ri] of Object.entries(raw.instances)) {
      if (!isObject(ri) || typeof ri.definition !== 'string' || typeof ri.name !== 'string') return null;
      const t = transform(ri.transform);
      if (!t) return null;
      instances.set(iid, { id: iid, definitionId: ri.definition, name: ri.name, transform: t });
    }
    definitions.set(id, { id, kind: raw.kind as DefinitionKind, name: raw.name, model, instances });
  }
  const root = definitions.get(data.root);
  if (!root || root.kind !== 'root') return null;
  const scene: Scene = { rootId: data.root, definitions, next: data.next as number };
  // Every instance refers to an existing, non-root definition, and nothing contains itself.
  for (const d of definitions.values()) {
    for (const i of d.instances.values()) {
      const target = definitions.get(i.definitionId);
      if (!target || target.kind === 'root') return null;
      if (contains(scene, i.definitionId, d.id)) return null;
    }
  }
  return scene;
}

/** A scene holding a version 1 or 2 model as its root (documents from milestones 1 and 2). */
export function sceneFromModel(model: Model): Scene {
  return createScene(model);
}
