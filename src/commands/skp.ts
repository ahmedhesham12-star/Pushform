/**
 * The native .skp file: the visible model is pure SketchUp, and Pushform-only
 * data (units, workspace, cut list, stock, grain, guides and annotations) rides
 * in a hidden component's dynamic attributes. The legacy v17 container is used
 * because SketchUp 2017 and later open it.
 */
import { createModel, deserialize, serialize, type Model } from '../kernel';
import {
  addAnnotation,
  addDefinition,
  addGuide,
  addTag,
  attachAnchor,
  createScene,
  decompose,
  deserializeScene,
  guideLine,
  guidePoint,
  newId,
  putInstance,
  serializeScene,
  validStock,
  withTag,
  type Affine,
  type Annotation,
  type DefinitionId,
  type DefinitionKind,
  type GrainAxis,
  type Material,
  type MaterialId,
  type Scene,
  type SerializedScene,
  type Stock,
  type TagId,
  type Transform,
} from '../scene';
import type { SerializedTopology } from '../kernel';
import { defaultPrecision, isValidSettings, type LengthUnit, type UnitSettings } from '../units';
import { readCutList, type CutListSettings, type PushformDocument } from './document';
import { WORKSPACES, workspaceUnits, type Workspace } from './workspaces';
import type { CoEdge, Definition as SkpDefinition, Edge as SkpEdge, Instance as SkpInstance, Material as SkpMaterial, SkpModel } from 'openskp';

const INCH = 25.4;
const PAYLOAD_KEY = 'pushform';
const CARRIER_DEFINITION = 'Pushform data';
const CARRIER_LAYER = 'Pushform metadata';
const DEFAULT_LAYERS = new Set(['Layer0', 'Untagged']);

type SerializedGuides = NonNullable<SerializedScene['definitions'][string]['guides']>;
type SerializedAnnotations = NonNullable<SerializedScene['definitions'][string]['annotations']>;
type SerializedTags = NonNullable<SerializedScene['tags']>;

export interface SkpDefinitionMetadata {
  readonly name: string;
  readonly kind: DefinitionKind;
  readonly grain?: GrainAxis;
  readonly guides?: SerializedGuides;
  readonly annotations?: SerializedAnnotations;
}

export interface SkpMetadata {
  readonly format: 'pushform';
  readonly version: 1;
  readonly units: UnitSettings;
  readonly workspace: Workspace;
  readonly cutList?: CutListSettings;
  readonly tags?: SerializedTags;
  readonly materials?: Record<string, { readonly stock?: Stock }>;
  readonly root?: { readonly guides?: SerializedGuides; readonly annotations?: SerializedAnnotations };
  readonly definitions?: readonly SkpDefinitionMetadata[];
}

const definitionName = (def: { readonly name: string; readonly kind: DefinitionKind }): string =>
  def.name || (def.kind === 'group' ? 'Group' : 'Component');

/** Pushform-only data for a document, as the string the .skp carrier holds. */
export function skpMetadata(doc: PushformDocument): SkpMetadata {
  const full = serializeScene(doc.scene);
  const root = full.definitions[doc.scene.rootId];
  const rootMeta = { ...(root?.guides ? { guides: root.guides } : {}), ...(root?.annotations ? { annotations: root.annotations } : {}) };
  const definitions: SkpDefinitionMetadata[] = [];
  for (const def of doc.scene.definitions.values()) {
    if (def.id === doc.scene.rootId) continue;
    const saved = full.definitions[def.id];
    definitions.push({
      name: definitionName(def),
      kind: def.kind,
      ...(def.grain ? { grain: def.grain } : {}),
      ...(saved?.guides ? { guides: saved.guides } : {}),
      ...(saved?.annotations ? { annotations: saved.annotations } : {}),
    });
  }
  const materials: Record<string, { stock?: Stock }> = {};
  for (const material of doc.scene.materials.values()) if (material.stock) materials[material.name] = { stock: material.stock };
  return {
    format: 'pushform',
    version: 1,
    units: { ...doc.units },
    workspace: doc.workspace,
    ...(doc.cutList ? { cutList: { ...doc.cutList } } : {}),
    ...(full.tags ? { tags: full.tags } : {}),
    ...(Object.keys(materials).length ? { materials } : {}),
    ...(Object.keys(rootMeta).length ? { root: rootMeta } : {}),
    ...(definitions.length ? { definitions } : {}),
  };
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += BASE64[a >> 2]!;
    out += BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? '=' : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? '=' : BASE64[c & 63]!;
  }
  return out;
}

const hex = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const color = (c: { readonly r: number; readonly g: number; readonly b: number }): string => `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;

const vertexPoint = (v: { readonly x: number; readonly y: number; readonly z: number }): [number, number, number] => [v.x * INCH, v.z * INCH, -v.y * INCH];
const arrayPoint = (p: readonly number[]): [number, number, number] => [p[0]! * INCH, p[2]! * INCH, -p[1]! * INCH];
const direction = (p: readonly number[]): [number, number, number] => [p[0]!, p[2]!, -p[1]!];

function materialFromSkp(raw: SkpMaterial, meta: SkpMetadata | null, sniff: (data: Uint8Array) => 'image/png' | 'image/jpeg' | null): Material {
  const texture =
    raw.texture?.data && raw.texture.width > 0 && raw.texture.height > 0
      ? {
          data: toBase64(raw.texture.data),
          mime: sniff(raw.texture.data) ?? (/\.jpe?g$/i.test(raw.texture.filename) ? ('image/jpeg' as const) : ('image/png' as const)),
          width: raw.texture.width * INCH,
          height: raw.texture.height * INCH,
        }
      : undefined;
  const stock = raw.name ? meta?.materials?.[raw.name]?.stock : undefined;
  const valid = stock ? validStock(stock) : null;
  return { name: raw.name || 'Material', color: color(raw.color), ...(texture ? { texture } : {}), ...(valid ? { stock: valid } : {}) };
}

function loopVertices(loop: readonly CoEdge[], edges: Map<number, SkpEdge>): string[] {
  const out: string[] = [];
  for (const co of loop) {
    const edge = edges.get(co.edgeId);
    if (!edge) return [];
    out.push(`v${co.orientation > 0 ? edge.v1Id : edge.v2Id}`);
  }
  return out;
}

function loopNormal(loop: readonly string[], vertices: SerializedTopology['vertices']): [number, number, number] {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = vertices[loop[i]!]!;
    const b = vertices[loop[(i + 1) % loop.length]!]!;
    nx += (a[1]! - b[1]!) * (a[2]! + b[2]!);
    ny += (a[2]! - b[2]!) * (a[0]! + b[0]!);
    nz += (a[0]! - b[0]!) * (a[1]! + b[1]!);
  }
  return [nx, ny, nz];
}

const magnitude = (v: readonly number[]): number => Math.hypot(v[0]!, v[1]!, v[2]!);

function orient(loop: string[], loopN: readonly number[], faceN: readonly number[], want: 1 | -1): string[] {
  const dot = loopN[0]! * faceN[0]! + loopN[1]! * faceN[1]! + loopN[2]! * faceN[2]!;
  return dot * want >= 0 ? loop : [...loop].reverse();
}

function modelFromSkp(raw: SkpDefinition, materials: Map<number, MaterialId>): Model | null {
  const vertices: SerializedTopology['vertices'] = {};
  for (const v of raw.vertices) vertices[`v${v.id}`] = vertexPoint(v);
  const edgeById = new Map<number, SkpEdge>();
  for (const e of raw.edges) edgeById.set(e.id, e);
  const edges: SerializedTopology['edges'] = {};
  const curveIds = new Set<number>();
  for (const e of raw.edges) {
    const curve = e.curveId !== null && e.curveId !== undefined ? e.curveId : null;
    if (curve !== null) curveIds.add(curve);
    edges[`e${e.id}`] = { v: [`v${e.v1Id}`, `v${e.v2Id}`], ...(e.soft ? { soft: true as const } : {}), ...(curve !== null ? { curve: `c${curve}` } : {}) };
  }
  const curves: SerializedTopology['curves'] = {};
  for (const id of curveIds) {
    const list = raw.edges.filter((e) => e.curveId === id).map((e) => `e${e.id}`);
    const arc = raw.arcs.get(id);
    curves[`c${id}`] = arc
      ? {
          kind: arc.isFullCircle ? 'circle' : 'arc',
          edges: list,
          segments: list.length,
          center: arrayPoint(arc.center),
          normal: direction(arc.normal),
          ...(arc.radius > 0 ? { radius: arc.radius * INCH } : {}),
        }
      : { kind: 'polygon', edges: list, segments: list.length, center: [0, 0, 0], normal: [0, 1, 0] };
  }
  const faces: SerializedTopology['faces'] = {};
  for (const f of raw.faces) {
    const loops = f.loops.map((loop) => loopVertices(loop, edgeById)).filter((loop) => loop.length >= 3);
    if (!loops.length) continue;
    const normal = direction(f.normal);
    const measured = loops.map((loop) => ({ loop, normal: loopNormal(loop, vertices) }));
    measured.sort((a, b) => magnitude(b.normal) - magnitude(a.normal));
    const outer = orient(measured[0]!.loop, measured[0]!.normal, normal, 1);
    const holes = measured.slice(1).map(({ loop, normal: n }) => orient(loop, n, normal, -1));
    const front = f.materialId !== null ? materials.get(f.materialId) : undefined;
    const back = f.backMaterialId !== null ? materials.get(f.backMaterialId) : undefined;
    const paint = { ...(front ? { front } : {}), ...(back ? { back } : {}) };
    faces[`f${f.id}`] = { normal, outer, holes, ...(front || back ? { paint } : {}) };
  }
  const next = Math.max(0, ...raw.vertices.map((v) => v.id), ...raw.edges.map((e) => e.id), ...raw.faces.map((f) => f.id), ...curveIds) + 1;
  return deserialize({ kind: 'topology', version: 2, next, vertices, edges, faces, curves });
}

function transformFromSkp(matrix: readonly number[]): Transform | null {
  if (matrix.length < 12) return null;
  const [s00, s01, s02, s10, s11, s12, s20, s21, s22] = matrix as number[];
  const m: Affine['m'] = [s00!, s20!, -s10!, s02!, s22!, -s12!, -s01!, -s21!, s11!];
  const t: [number, number, number] = [matrix[9]! * INCH, matrix[11]! * INCH, -matrix[10]! * INCH];
  return decompose({ m, t });
}

function addRawGuides(scene: Scene, definitionId: DefinitionId, raw: SkpDefinition): Scene {
  let next = scene;
  for (const line of raw.constructionLines) {
    const guide = guideLine(arrayPoint(line.point), direction(line.direction));
    if (guide) next = addGuide(next, definitionId, guide)[1];
  }
  for (const point of raw.constructionPoints) next = addGuide(next, definitionId, guidePoint(arrayPoint(point.position)))[1];
  return next;
}

function syntheticScene(meta: SkpMetadata): Scene | null {
  const empty = serialize(createModel());
  const definitions: SerializedScene['definitions'] = {
    r: { kind: 'root', name: '', model: empty, instances: {}, ...(meta.root?.guides ? { guides: meta.root.guides } : {}), ...(meta.root?.annotations ? { annotations: meta.root.annotations } : {}) },
  };
  (meta.definitions ?? []).forEach((def, i) => {
    definitions[`d${i}`] = {
      kind: def.kind,
      name: def.name,
      model: empty,
      instances: {},
      ...(def.grain ? { grain: def.grain } : {}),
      ...(def.guides ? { guides: def.guides } : {}),
      ...(def.annotations ? { annotations: def.annotations } : {}),
    };
  });
  return deserializeScene({ root: 'r', next: 1, ...(meta.tags ? { tags: meta.tags } : {}), definitions });
}

function mergeMetadata(scene: Scene, meta: SkpMetadata | null): Scene {
  if (!meta) return scene;
  const synthetic = syntheticScene(meta);
  if (!synthetic) return scene;
  const oldTagName = new Map<string, string>();
  for (const [id, tag] of Object.entries(meta.tags ?? {})) oldTagName.set(id, tag.name);
  const tagByName = new Map<string, TagId>();
  for (const [id, tag] of scene.tags) tagByName.set(tag.name, id);
  const tagFor = (old: string | undefined): TagId | undefined => {
    const name = old ? oldTagName.get(old) : undefined;
    return name ? tagByName.get(name) : undefined;
  };
  const byName = new Map<string, DefinitionId[]>();
  for (const def of scene.definitions.values()) {
    if (def.id === scene.rootId) continue;
    const key = `${def.kind}|${definitionName(def)}`;
    byName.set(key, [...(byName.get(key) ?? []), def.id]);
  }
  let next = scene;
  for (const saved of synthetic.definitions.values()) {
    const target = saved.kind === 'root' ? next.rootId : byName.get(`${saved.kind}|${saved.name}`)?.shift();
    if (!target) continue;
    for (const guide of saved.guides.values()) next = addGuide(next, target, withTag(guide, tagFor(guide.tag)))[1];
    for (const annotation of saved.annotations.values()) {
      let anchored: Annotation = annotation;
      if (annotation.kind === 'dimension') anchored = { ...annotation, start: attachAnchor(next, target, annotation.start.point), end: attachAnchor(next, target, annotation.end.point) };
      else if (annotation.kind === 'text') anchored = { ...annotation, anchor: attachAnchor(next, target, annotation.anchor.point) };
      next = addAnnotation(next, target, withTag(anchored, tagFor(annotation.tag)))[1];
    }
  }
  return next;
}

function documentUnits(meta: SkpMetadata | null, parsed: SkpModel, workspace: Workspace): UnitSettings {
  if (meta?.units && isValidSettings(meta.units)) return { ...meta.units };
  const unit = parsed.units?.toLowerCase() ?? '';
  const mapped: LengthUnit | null = unit.startsWith('millimeter')
    ? 'mm'
    : unit.startsWith('centimeter')
      ? 'cm'
      : unit.startsWith('meter')
        ? 'm'
        : unit.startsWith('inch')
          ? 'in'
          : unit.startsWith('feet') || unit.startsWith('foot')
            ? 'ft-in'
            : null;
  return mapped ? { unit: mapped, precision: defaultPrecision(mapped) } : workspaceUnits(workspace, null);
}

interface CarrierPayload {
  readonly text: string;
  readonly layer: string;
  readonly definition: number;
}

function payloadText(properties: Record<string, string>): string | undefined {
  const count = Number.parseInt(properties[PAYLOAD_KEY] ?? '', 10);
  if (!Number.isInteger(count) || count < 1) return undefined;
  let out = '';
  for (let i = 0; i < count; i++) {
    const part = properties[`${PAYLOAD_KEY}${i}`];
    if (typeof part !== 'string') return undefined;
    out += part;
  }
  return out;
}

function carrierFromScene(node: { readonly name: string; readonly layer: string; readonly properties: Record<string, string>; readonly children: readonly unknown[] }): { text: string; layer: string } | null {
  if (node.name === CARRIER_DEFINITION) {
    const text = payloadText(node.properties);
    if (text !== undefined) return { text, layer: node.layer };
  }
  for (const child of node.children) {
    const found = carrierFromScene(child as typeof node);
    if (found) return found;
  }
  return null;
}

/** Open a native .skp, with the Pushform-only data when the file carries it. Null when the file is not a SketchUp model this version can read. */
export async function documentFromSkp(bytes: ArrayBuffer): Promise<PushformDocument | null> {
  try {
    const { buildScene, parseSkp, sniffImageMime } = await import('openskp');
    const parsed = parseSkp(bytes);
    const allInstances = [...parsed.root.instances, ...[...parsed.definitions.values()].flatMap((def) => def.instances)];
    const rawCarrier = allInstances.find((instance) => instance.name === CARRIER_DEFINITION);
    const rawPayload = rawCarrier ? payloadText(rawCarrier.properties) : undefined;
    let payload: CarrierPayload | null = rawCarrier && rawPayload !== undefined ? { text: rawPayload, layer: rawCarrier.layer, definition: rawCarrier.refIdx } : null;
    if (!payload) {
      try {
        const found = carrierFromScene(buildScene(bytes).sceneHierarchy);
        if (found && rawCarrier) payload = { ...found, definition: rawCarrier.refIdx };
      } catch {
        payload = null;
      }
    }
    let meta: SkpMetadata | null = null;
    if (payload) {
      try {
        const read = JSON.parse(payload.text) as SkpMetadata;
        if (read && read.format === 'pushform' && read.version === 1) meta = read;
      } catch {
        meta = null;
      }
    }

    const materialMap = new Map<number, MaterialId>();
    const materials = new Map<MaterialId, Material>();
    let next = 2;
    for (const [rawId, raw] of parsed.materialsById) {
      const id = `m${next++}`;
      materialMap.set(rawId, id);
      materials.set(id, materialFromSkp(raw, meta, sniffImageMime));
    }

    const rootModel = modelFromSkp(parsed.root, materialMap);
    if (!rootModel) return null;
    const base = createScene(rootModel);
    let scene: Scene = { ...base, materials, next };

    const carrierLayer = payload?.layer || (payload ? CARRIER_LAYER : '');
    const isCarrierLayer = (name: string) => name === carrierLayer || (!!payload && name.startsWith(CARRIER_LAYER));
    const defaultLayer = parsed.layers.find((layer) => DEFAULT_LAYERS.has(layer.name))?.name ?? parsed.layers[0]?.name ?? '';
    const tagByName = new Map<string, TagId>();
    for (const layer of parsed.layers) {
      if (layer.name === defaultLayer || isCarrierLayer(layer.name)) continue;
      const [id, updated] = addTag(scene, { name: layer.name, color: color(layer.color), visible: !layer.hidden });
      scene = updated;
      tagByName.set(layer.name, id);
    }

    scene = addRawGuides(scene, scene.rootId, parsed.root);

    const carrierDefinition = payload?.definition ?? rawCarrier?.refIdx;
    const rawDefinitions = [...parsed.definitions.values()].filter((def) => def.id !== carrierDefinition);
    const definitionMap = new Map<number, DefinitionId>();
    for (const raw of rawDefinitions) {
      const model = modelFromSkp(raw, materialMap);
      if (!model) return null;
      const kind = raw.isGroup ? ('group' as const) : ('component' as const);
      const grain = meta?.definitions?.find((def) => def.name === raw.name && def.kind === kind)?.grain;
      const [id, updated] = addDefinition(scene, { kind, name: raw.name, model, instances: new Map(), ...(grain ? { grain } : {}) });
      scene = addRawGuides(updated, id, raw);
      definitionMap.set(raw.id, id);
    }

    const addInstances = (parent: DefinitionId, instances: readonly SkpInstance[]): boolean => {
      for (const instance of instances) {
        if (instance.refIdx === carrierDefinition) continue;
        const definitionId = definitionMap.get(instance.refIdx);
        if (!definitionId) continue;
        const transform = transformFromSkp(instance.matrix);
        if (!transform) return false;
        const tag = instance.layer && instance.layer !== defaultLayer && !isCarrierLayer(instance.layer) ? tagByName.get(instance.layer) : undefined;
        const material = instance.materialId !== null ? materialMap.get(instance.materialId) : undefined;
        const [id, updated] = newId(scene, 'i');
        scene = putInstance(updated, parent, { id, definitionId, name: instance.name, transform, ...(tag ? { tag } : {}), ...(material ? { material } : {}) });
      }
      return true;
    };
    if (!addInstances(scene.rootId, parsed.root.instances)) return null;
    for (const raw of rawDefinitions) {
      const parent = definitionMap.get(raw.id);
      if (parent && !addInstances(parent, raw.instances)) return null;
    }

    scene = mergeMetadata(scene, meta);
    const workspace = meta?.workspace && WORKSPACES.includes(meta.workspace) ? meta.workspace : 'general';
    const units = documentUnits(meta, parsed, workspace);
    const cutList = meta?.cutList ? readCutList(meta.cutList) ?? undefined : undefined;
    return { scene, units, workspace, ...(cutList ? { cutList } : {}) };
  } catch {
    return null;
  }
}
