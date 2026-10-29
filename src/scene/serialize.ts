import { deserialize, listFaces, serialize, type Model, type SerializedTopology } from '../kernel';
import { MATERIAL_COLOR, validStock, type Material, type Stock } from './materials';
import type { Anchor, AnchorRef, Annotation } from './annotations';
import { guideLine, guidePoint, type Guide } from './guides';
import { contains, createScene, type Definition, type DefinitionKind, type GrainAxis, type Instance, type Scene } from './scene';
import { withTag, type Tag } from './tags';
import type { Quat, Transform } from './transform';

export interface SerializedTransform {
  rotation: number[];
  translation: number[];
  scale: number[];
}

export type SerializedGuide = ({ kind: 'line'; point: number[]; direction: number[] } | { kind: 'point'; point: number[] }) & { tag?: string };

export interface SerializedAnchor {
  point: number[];
  ref?: { path: string[]; definition: string; a: string; b?: string; t?: number };
}
export type SerializedAnnotation = (
  | { kind: 'dimension'; start: SerializedAnchor; end: SerializedAnchor; offset: number[] }
  | { kind: 'text'; anchor: SerializedAnchor; leader: number[]; text: string }
  | { kind: 'screenText'; position: number[]; text: string }
) & { tag?: string };

/**
 * The scene of a version 3 to 5 document: definitions, each with its topology
 * and the instances inside it. Version 4 (milestone 4) adds guides and
 * annotations, each left out when a definition has none. Version 5
 * (milestone 5) adds tags, in the order they were made, and the tag of each
 * instance, guide and annotation that has one; and materials, with the
 * material of each painted instance (faces carry theirs in the model).
 */
export interface SerializedScene {
  root: string;
  next: number;
  tags?: Record<string, { name: string; color: string; visible: boolean }>;
  materials?: Record<string, SerializedMaterial>;
  definitions: Record<
    string,
    {
      kind: DefinitionKind;
      name: string;
      model: SerializedTopology;
      instances: Record<string, { definition: string; name: string; transform: SerializedTransform; tag?: string; material?: string }>;
      guides?: Record<string, SerializedGuide>;
      annotations?: Record<string, SerializedAnnotation>;
      grain?: GrainAxis;
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
        ...tagOf(i),
        ...(i.material ? { material: i.material } : {}),
      };
    }
    definitions[id] = { kind: d.kind, name: d.name, model: serialize(d.model), instances, ...(d.grain ? { grain: d.grain } : {}) };
    if (d.guides.size) {
      const guides: Record<string, SerializedGuide> = {};
      for (const [gid, g] of d.guides) {
        guides[gid] = { ...(g.kind === 'line' ? { kind: 'line', point: [...g.point], direction: [...g.direction] } : { kind: 'point', point: [...g.point] }), ...tagOf(g) };
      }
      definitions[id].guides = guides;
    }
    if (d.annotations.size) {
      const annotations: Record<string, SerializedAnnotation> = {};
      for (const [aid, a] of d.annotations) annotations[aid] = { ...saveAnnotation(a), ...tagOf(a) };
      definitions[id].annotations = annotations;
    }
  }
  const out: SerializedScene = { root: s.rootId, next: s.next, definitions };
  if (s.tags.size) out.tags = Object.fromEntries([...s.tags].map(([id, t]) => [id, { name: t.name, color: t.color, visible: t.visible }]));
  if (s.materials.size) out.materials = Object.fromEntries([...s.materials].map(([id, m]) => [id, saveMaterial(m)]));
  return out;
}

const tagOf = (x: { readonly tag?: string }) => (x.tag ? { tag: x.tag } : {});

export interface SerializedMaterial {
  name: string;
  color: string;
  texture?: { data: string; mime: string; width: number; height: number };
  stock?: Stock;
}

function saveMaterial(m: Material): SerializedMaterial {
  return { name: m.name, color: m.color, ...(m.texture ? { texture: { ...m.texture } } : {}), ...(m.stock ? { stock: { ...m.stock } } : {}) };
}

/** A material from a file, or null when it is not one: a name, a #rrggbb color, and a PNG or JPEG texture with a positive size. */
function material(v: unknown): Material | null {
  if (!isObject(v) || typeof v.name !== 'string' || !v.name.trim() || typeof v.color !== 'string' || !MATERIAL_COLOR.test(v.color.toLowerCase())) return null;
  let out: Material = { name: v.name, color: v.color.toLowerCase() };
  if (v.stock !== undefined) {
    const stock = validStock(v.stock);
    if (!stock) return null;
    out = { ...out, stock };
  }
  if (v.texture === undefined) return out;
  const x = v.texture;
  if (!isObject(x) || typeof x.data !== 'string' || !x.data || (x.mime !== 'image/png' && x.mime !== 'image/jpeg')) return null;
  if (typeof x.width !== 'number' || typeof x.height !== 'number' || !(x.width > 0) || !(x.height > 0) || !Number.isFinite(x.width + x.height)) return null;
  return { ...out, texture: { data: x.data, mime: x.mime, width: x.width, height: x.height } };
}

function saveAnchor(a: Anchor): SerializedAnchor {
  if (!a.ref) return { point: [...a.point] };
  const { path, definitionId, a: va, b, t } = a.ref;
  return { point: [...a.point], ref: { path: [...path], definition: definitionId, a: va, ...(b === undefined ? {} : { b, t: t ?? 0.5 }) } };
}

function saveAnnotation(a: Annotation): SerializedAnnotation {
  if (a.kind === 'dimension') return { kind: a.kind, start: saveAnchor(a.start), end: saveAnchor(a.end), offset: [...a.offset] };
  if (a.kind === 'text') return { kind: a.kind, anchor: saveAnchor(a.anchor), leader: [...a.leader], text: a.text };
  return { kind: a.kind, position: [...a.position], text: a.text };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numbers = (v: unknown, n: number): v is number[] =>
  Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const KINDS: readonly DefinitionKind[] = ['root', 'group', 'component'];
/** Smaller scales (in size) would flatten an instance. */
const MIN_SCALE = 1e-6;

function transform(v: unknown): Transform | null {
  if (!isObject(v) || !numbers(v.rotation, 4) || !numbers(v.translation, 3) || !numbers(v.scale, 3)) return null;
  // Any scale but zero: negative is a mirror, unequal is a stretch along the instance's own axes.
  if (v.scale.some((x) => Math.abs(x) < MIN_SCALE)) return null;
  const q = v.rotation;
  if (Math.abs(Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!) - 1) > 1e-6) return null;
  return { rotation: q as unknown as Quat, translation: v.translation as unknown as Transform['translation'], scale: [v.scale[0]!, v.scale[1]!, v.scale[2]!] };
}

function guide(v: unknown): Guide | null {
  if (!isObject(v) || !numbers(v.point, 3)) return null;
  const point = v.point as unknown as [number, number, number];
  if (v.kind === 'point') return guidePoint(point);
  if (v.kind === 'line' && numbers(v.direction, 3)) return guideLine(point, v.direction as unknown as [number, number, number]);
  return null;
}

function anchor(v: unknown): Anchor | null {
  if (!isObject(v) || !numbers(v.point, 3)) return null;
  const point = v.point as unknown as [number, number, number];
  if (v.ref === undefined) return { point };
  const r = v.ref;
  if (!isObject(r) || !Array.isArray(r.path) || !r.path.every((x) => typeof x === 'string') || typeof r.definition !== 'string' || typeof r.a !== 'string') return null;
  const ref: AnchorRef = { path: r.path as string[], definitionId: r.definition, a: r.a };
  if (r.b === undefined) return { point, ref };
  if (typeof r.b !== 'string' || typeof r.t !== 'number' || !(r.t > 0 && r.t < 1)) return null;
  return { point, ref: { ...ref, b: r.b, t: r.t } };
}

function annotation(v: unknown): Annotation | null {
  if (!isObject(v)) return null;
  if (v.kind === 'dimension' && numbers(v.offset, 3)) {
    const start = anchor(v.start);
    const end = anchor(v.end);
    return start && end ? { kind: 'dimension', start, end, offset: v.offset as unknown as [number, number, number] } : null;
  }
  if (typeof v.text !== 'string') return null;
  if (v.kind === 'text' && numbers(v.leader, 3)) {
    const at = anchor(v.anchor);
    return at ? { kind: 'text', anchor: at, leader: v.leader as unknown as [number, number, number], text: v.text } : null;
  }
  if (v.kind === 'screenText' && numbers(v.position, 2) && v.position.every((x) => x >= 0 && x <= 1)) {
    return { kind: 'screenText', position: [v.position[0]!, v.position[1]!], text: v.text };
  }
  return null;
}

const COLOR = /^#[0-9a-f]{6}$/i;

function tags(v: unknown): Map<string, Tag> | null {
  const out = new Map<string, Tag>();
  if (v === undefined) return out;
  if (!isObject(v)) return null;
  for (const [id, t] of Object.entries(v)) {
    if (!isObject(t) || typeof t.name !== 'string' || !t.name.trim() || typeof t.color !== 'string' || !COLOR.test(t.color) || typeof t.visible !== 'boolean') return null;
    out.set(id, { name: t.name, color: t.color.toLowerCase(), visible: t.visible });
  }
  return out;
}

/** Validate and load a version 3 to 5 scene. Returns null for invalid data. */
export function deserializeScene(data: unknown): Scene | null {
  if (!isObject(data) || typeof data.root !== 'string' || !Number.isInteger(data.next) || !isObject(data.definitions)) return null;
  const tagMap = tags(data.tags);
  if (!tagMap) return null;
  const materials = new Map<string, Material>();
  if (data.materials !== undefined) {
    if (!isObject(data.materials)) return null;
    for (const [id, raw] of Object.entries(data.materials)) {
      const m = material(raw);
      if (!m) return null;
      materials.set(id, m);
    }
  }
  const knownMaterial = (id: unknown) => typeof id === 'string' && materials.has(id);
  /** The tag an item names: undefined for Untagged, null when it names no tag there is. */
  const tagRef = (v: Record<string, unknown>): string | undefined | null => (v.tag === undefined ? undefined : typeof v.tag === 'string' && tagMap.has(v.tag) ? v.tag : null);
  const definitions = new Map<string, Definition>();
  for (const [id, raw] of Object.entries(data.definitions)) {
    if (!isObject(raw) || !KINDS.includes(raw.kind as DefinitionKind) || typeof raw.name !== 'string' || !isObject(raw.instances)) return null;
    const model = deserialize(raw.model);
    if (!model) return null;
    // Paint on faces names materials of this file.
    if (listFaces(model).some((f) => (f.paint?.front && !materials.has(f.paint.front)) || (f.paint?.back && !materials.has(f.paint.back)))) return null;
    const instances = new Map<string, Instance>();
    for (const [iid, ri] of Object.entries(raw.instances)) {
      if (!isObject(ri) || typeof ri.definition !== 'string' || typeof ri.name !== 'string') return null;
      const t = transform(ri.transform);
      const tag = tagRef(ri);
      if (!t || tag === null || (ri.material !== undefined && !knownMaterial(ri.material))) return null;
      const placed = withTag<Instance>({ id: iid, definitionId: ri.definition, name: ri.name, transform: t }, tag);
      instances.set(iid, ri.material ? { ...placed, material: ri.material as string } : placed);
    }
    const guides = new Map<string, Guide>();
    if (raw.guides !== undefined) {
      if (!isObject(raw.guides)) return null;
      for (const [gid, rg] of Object.entries(raw.guides)) {
        const g = guide(rg);
        const tag = isObject(rg) ? tagRef(rg) : null;
        if (!g || tag === null) return null;
        guides.set(gid, withTag(g, tag));
      }
    }
    const annotations = new Map<string, Annotation>();
    if (raw.annotations !== undefined) {
      if (!isObject(raw.annotations)) return null;
      for (const [aid, ra] of Object.entries(raw.annotations)) {
        const a = annotation(ra);
        const tag = isObject(ra) ? tagRef(ra) : null;
        if (!a || tag === null) return null;
        annotations.set(aid, withTag(a, tag));
      }
    }
    if (raw.grain !== undefined && raw.grain !== 'red' && raw.grain !== 'green' && raw.grain !== 'blue') return null;
    definitions.set(id, { id, kind: raw.kind as DefinitionKind, name: raw.name, model, instances, guides, annotations, ...(raw.grain ? { grain: raw.grain as GrainAxis } : {}) });
  }
  const root = definitions.get(data.root);
  if (!root || root.kind !== 'root') return null;
  const scene: Scene = { rootId: data.root, definitions, tags: tagMap, materials, next: data.next as number };
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
