/**
 * SketchUp (.skp) export through the MIT openskp writer. It writes the legacy
 * v17 container, which SketchUp 2017 and later open. Our millimeters and Y-up
 * axes become SketchUp's inches and Z-up axes.
 */
import { serialize, type SerializedTopology } from '../kernel';
import {
  affineOf,
  type Affine,
  type Definition,
  type DefinitionId,
  type Instance,
  type InstanceId,
  type MaterialId,
  type Scene,
  type TagId,
} from '../scene';
import type {
  AddFaceOptions,
  ComponentDefinitionBuilder,
  Matrix3x3,
  Point3 as SkpPoint,
  SkpBuilder,
} from 'openskp';
import { fromBase64 } from './base64';

const MM_PER_INCH = 25.4;
const CARRIER_LAYER = 'Pushform metadata';
const CARRIER_DEFINITION = 'Pushform data';
const PAYLOAD_KEY = 'pushform';

const definitionName = (def: Definition): string => def.name || (def.kind === 'group' ? 'Group' : 'Component');

/** The legacy attribute value limit is 255 UTF-16 units; keep each chunk well under it. */
function payloadAttributes(payload: string): Record<string, string> {
  const chunks: string[] = [];
  let current = '';
  for (const char of payload) {
    if (current.length + char.length > 200) {
      chunks.push(current);
      current = '';
    }
    current += char;
  }
  chunks.push(current);
  const attributes: Record<string, string> = { [PAYLOAD_KEY]: String(chunks.length) };
  chunks.forEach((chunk, index) => {
    attributes[`${PAYLOAD_KEY}${index}`] = chunk;
  });
  return attributes;
}

interface PlacementOptions {
  name?: string;
  translation: SkpPoint;
  matrix3x3: Matrix3x3;
  material?: number;
  layer?: number;
}

const skpPoint = (p: readonly number[]): SkpPoint => [p[0]! / MM_PER_INCH, -p[2]! / MM_PER_INCH, p[1]! / MM_PER_INCH];

const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

function hexColor(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function uniqueName(name: string, used: Set<string>, fallback: string): string {
  const base = name.trim() || fallback;
  let out = base;
  for (let n = 2; used.has(out); n++) out = `${base} ${n}`;
  used.add(out);
  return out;
}

/** The edges a face uses, by unordered vertex pair. */
function usedEdges(t: SerializedTopology): Set<string> {
  const used = new Set<string>();
  for (const f of Object.values(t.faces)) {
    for (const loop of [f.outer, ...f.holes]) {
      for (let i = 0; i < loop.length; i++) used.add(edgeKey(loop[i]!, loop[(i + 1) % loop.length]!));
    }
  }
  return used;
}

function hasLooseEdges(t: SerializedTopology, used: Set<string>): boolean {
  return Object.values(t.edges).some((e) => !used.has(edgeKey(e.v[0], e.v[1])));
}

/** SketchUp's row-major 3x3 for one of our transforms: (x, y, z) becomes (x, -z, y). */
function skpMatrix(t: Affine): Matrix3x3 {
  const m = t.m;
  const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
  return [r00, -r02, r01, -r20, r22, -r21, r10, -r12, r11];
}

function placement(instance: Instance, def: Definition, materials: Map<MaterialId, number>, layers: Map<TagId, number>): PlacementOptions {
  const t = affineOf(instance.transform);
  const material = instance.material ? materials.get(instance.material) : undefined;
  const layer = instance.tag ? layers.get(instance.tag) : undefined;
  const name = instance.name || def.name;
  return {
    ...(name ? { name } : {}),
    translation: [t.t[0]! / MM_PER_INCH, -t.t[2]! / MM_PER_INCH, t.t[1]! / MM_PER_INCH],
    matrix3x3: skpMatrix(t),
    ...(material ? { material } : {}),
    ...(layer ? { layer } : {}),
  };
}

function addMaterials(builder: SkpBuilder, scene: Scene): Map<MaterialId, number> {
  const handles = new Map<MaterialId, number>();
  const used = new Set<string>();
  for (const [id, material] of scene.materials) {
    const name = uniqueName(material.name, used, 'Material');
    if (material.texture) {
      const bytes = fromBase64(material.texture.data);
      const extension = material.texture.mime === 'image/png' ? 'png' : 'jpg';
      handles.set(id, builder.addTextureMaterial(name, bytes, `${name}.${extension}`, material.texture.height / MM_PER_INCH, material.texture.width / MM_PER_INCH));
    } else {
      handles.set(id, builder.addMaterial(name, hexColor(material.color)));
    }
  }
  return handles;
}

function addLayers(builder: SkpBuilder, scene: Scene): Map<TagId, number> {
  const handles = new Map<TagId, number>();
  const used = new Set<string>();
  for (const [id, tag] of scene.tags) {
    const name = uniqueName(tag.name, used, 'Tag');
    handles.set(id, builder.addLayer(name, { color: hexColor(tag.color), hidden: !tag.visible }));
  }
  return handles;
}

function addGeometry(target: SkpBuilder | ComponentDefinitionBuilder, def: Definition, topologies: Map<DefinitionId, SerializedTopology>, materials: Map<MaterialId, number>): void {
  const t = topologies.get(def.id)!;
  const used = usedEdges(t);
  const soft = new Map<string, boolean>();
  for (const e of Object.values(t.edges)) soft.set(edgeKey(e.v[0], e.v[1]), e.soft === true);

  for (const f of Object.values(t.faces)) {
    const outer = f.outer.map((v) => skpPoint(t.vertices[v]!));
    if (outer.length < 3) continue;
    const holes = f.holes.map((h) => h.map((v) => skpPoint(t.vertices[v]!))).filter((h) => h.length >= 3);
    const allSoft = [f.outer, ...f.holes].every((loop) => loop.every((v, i) => soft.get(edgeKey(v, loop[(i + 1) % loop.length]!)) === true));
    const front = f.paint?.front ? materials.get(f.paint.front) : undefined;
    const back = f.paint?.back ? materials.get(f.paint.back) : undefined;
    const options: AddFaceOptions = {
      ...(holes.length ? { holes } : {}),
      ...(front ? { material: front } : {}),
      ...(back ? { backMaterial: back } : {}),
      ...(allSoft ? { softEdges: true, smoothEdges: true } : {}),
    };
    target.addFace(outer, options);
  }

  for (const e of Object.values(t.edges)) {
    const key = edgeKey(e.v[0], e.v[1]);
    if (used.has(key)) continue;
    const a = skpPoint(t.vertices[e.v[0]]!);
    const b = skpPoint(t.vertices[e.v[1]]!);
    if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) continue;
    target.addPolyline([a, b], e.soft ? { softEdges: true, smoothEdges: true } : {});
  }
}

/** Reachable definitions with every child before its parents; the root is last. */
function definitionOrder(scene: Scene): Definition[] {
  const out: Definition[] = [];
  const seen = new Set<DefinitionId>();
  const visit = (id: DefinitionId) => {
    if (seen.has(id)) return;
    seen.add(id);
    const def = scene.definitions.get(id);
    if (!def) return;
    for (const instance of def.instances.values()) visit(instance.definitionId);
    out.push(def);
  };
  visit(scene.rootId);
  return out;
}

function hasContent(scene: Scene, id: DefinitionId, topologies: Map<DefinitionId, SerializedTopology>, memo: Map<DefinitionId, boolean>, visiting: Set<DefinitionId>): boolean {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;
  if (visiting.has(id)) return false;
  const def = scene.definitions.get(id);
  if (!def) return false;
  visiting.add(id);
  const t = topologies.get(id)!;
  const own = Object.keys(t.faces).length > 0 || hasLooseEdges(t, usedEdges(t));
  const nested = [...def.instances.values()].some((instance) => hasContent(scene, instance.definitionId, topologies, memo, visiting));
  visiting.delete(id);
  memo.set(id, own || nested);
  return own || nested;
}

/** The whole scene as a SketchUp file, ready to write. `payload` is Pushform-only data kept in a hidden, ignored component. */
export async function exportSkp(scene: Scene, payload?: string): Promise<Uint8Array<ArrayBuffer>> {
  const { create } = await import('openskp');
  const builder = create();
  const materials = addMaterials(builder, scene);
  const layers = addLayers(builder, scene);
  const carrierLayer = payload ? builder.addLayer(uniqueName(CARRIER_LAYER, new Set([...scene.tags.values()].map((tag) => tag.name)), CARRIER_LAYER), { color: [128, 128, 128], hidden: true }) : 0;

  const defs = definitionOrder(scene);
  const topologies = new Map<DefinitionId, SerializedTopology>();
  for (const def of defs) topologies.set(def.id, serialize(def.model));
  const content = new Map<DefinitionId, boolean>();
  const visiting = new Set<DefinitionId>();

  const parents = new Map<DefinitionId, { instance: Instance; parentId: DefinitionId }[]>();
  for (const [parentId, def] of scene.definitions) {
    for (const instance of def.instances.values()) {
      const list = parents.get(instance.definitionId) ?? [];
      list.push({ instance, parentId });
      parents.set(instance.definitionId, list);
    }
  }

  const built = new Map<DefinitionId, ComponentDefinitionBuilder>();
  const rootGroups = new Set<InstanceId>();
  for (const def of defs) {
    if (def.id === scene.rootId || !hasContent(scene, def.id, topologies, content, visiting)) continue;
    const instances = parents.get(def.id) ?? [];
    const atRoot = def.kind === 'group' && instances.length === 1 && instances[0]!.parentId === scene.rootId ? instances[0]!.instance : undefined;
    const fill = (target: ComponentDefinitionBuilder) => {
      addGeometry(target, def, topologies, materials);
      for (const instance of def.instances.values()) {
        const child = scene.definitions.get(instance.definitionId);
        const childBuilder = built.get(instance.definitionId);
        if (!child || !childBuilder) continue;
        const options = placement(instance, child, materials, layers);
        if (child.kind === 'group') target.addGroupInstance(childBuilder, options);
        else target.addInstance(childBuilder, options);
      }
    };
    if (atRoot) {
      built.set(def.id, builder.addGroup(fill, { ...placement(atRoot, def, materials, layers), name: definitionName(def) }));
      rootGroups.add(atRoot.id);
    } else {
      built.set(def.id, builder.addComponentDefinition(definitionName(def), fill));
    }
  }

  const carrier = payload ? builder.addComponentDefinition(CARRIER_DEFINITION, (target) => target.addFace([[0, 0, 0], [0.01, 0, 0], [0, 0.01, 0]])) : undefined;

  const root = scene.definitions.get(scene.rootId)!;
  addGeometry(builder, root, topologies, materials);
  for (const instance of root.instances.values()) {
    if (rootGroups.has(instance.id)) continue;
    const child = scene.definitions.get(instance.definitionId);
    const childBuilder = built.get(instance.definitionId);
    if (!child || !childBuilder) continue;
    builder.addInstance(childBuilder, placement(instance, child, materials, layers));
  }
  if (payload && carrier) {
    builder.addInstance(carrier, {
      name: CARRIER_DEFINITION,
      layer: carrierLayer,
      attributes: payloadAttributes(payload),
      attributeDictName: 'dynamic_attributes',
    });
  }
  return new Uint8Array(builder.toBytes());
}
