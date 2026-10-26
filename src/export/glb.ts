import { faceMeshes } from '../kernel';
import { rootDefinition, type Definition, type DefinitionId, type Instance, type Scene } from '../scene';

/** glTF is in meters; Pushform in millimeters. Both are Y-up and right-handed. */
const M = 0.001;

interface GltfNode {
  name?: string;
  mesh?: number;
  translation?: number[];
  rotation?: number[];
  children?: number[];
}

/**
 * The scene as a binary glTF (GLB), in meters, Y up. The node tree follows
 * the scene: the model, then its groups and components, nested. Each
 * definition becomes one mesh shared by all its instances, so components stay
 * instances in the file. One double-sided default material.
 */
export function exportGlb(scene: Scene, name = ''): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: { buffer: 0; byteOffset: number; byteLength: number; target: number }[] = [];
  const accessors: object[] = [];
  const meshes: object[] = [];
  const nodes: GltfNode[] = [];
  const meshOf = new Map<DefinitionId, number | null>();

  /** Append a float32 array as a buffer view and an accessor of VEC3 values. */
  const vec3 = (values: Float32Array, withBounds: boolean): number => {
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, target: 34962 });
    chunks.push(bytes);
    byteLength += bytes.byteLength;
    const accessor: Record<string, unknown> = { bufferView: bufferViews.length - 1, componentType: 5126, count: values.length / 3, type: 'VEC3' };
    if (withBounds) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < values.length; i++) {
        min[i % 3] = Math.min(min[i % 3]!, values[i]!);
        max[i % 3] = Math.max(max[i % 3]!, values[i]!);
      }
      Object.assign(accessor, { min, max });
    }
    accessors.push(accessor);
    return accessors.length - 1;
  };

  /** The mesh of a definition's own faces, built once; null when it has none. */
  const mesh = (def: Definition): number | null => {
    if (meshOf.has(def.id)) return meshOf.get(def.id)!;
    const faces = faceMeshes(def.model);
    const count = faces.reduce((n, f) => n + f.positions.length, 0);
    if (!count) {
      meshOf.set(def.id, null);
      return null;
    }
    const positions = new Float32Array(count);
    const normals = new Float32Array(count);
    let at = 0;
    for (const f of faces) {
      for (let i = 0; i < f.positions.length; i += 3) {
        const [x, y, z] = [f.normals[i]!, f.normals[i + 1]!, f.normals[i + 2]!];
        const len = Math.hypot(x, y, z) || 1;
        positions.set([f.positions[i]! * M, f.positions[i + 1]! * M, f.positions[i + 2]! * M], at + i);
        normals.set([x / len, y / len, z / len], at + i);
      }
      at += f.positions.length;
    }
    const attributes = { POSITION: vec3(positions, true), NORMAL: vec3(normals, false) };
    meshes.push({ name: def.name || undefined, primitives: [{ attributes, material: 0 }] });
    meshOf.set(def.id, meshes.length - 1);
    return meshes.length - 1;
  };

  /** A node for a definition's geometry and the instances placed in it; returns its index. */
  const node = (def: Definition, n: GltfNode): number => {
    const index = nodes.length;
    nodes.push(n);
    const m = mesh(def);
    if (m !== null) n.mesh = m;
    const children = [...def.instances.values()].map((i) => instanceNode(i));
    if (children.length) n.children = children;
    return index;
  };
  const instanceNode = (i: Instance): number => {
    const def = scene.definitions.get(i.definitionId)!;
    const t = i.transform;
    const n: GltfNode = {};
    const label = i.name || def.name;
    if (label) n.name = label;
    if (t.translation.some((v) => v !== 0)) n.translation = t.translation.map((v) => v * M);
    if (t.rotation[3] !== 1) n.rotation = [...t.rotation];
    return node(def, n);
  };
  const root = node(rootDefinition(scene), { name: name || 'Model' });

  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'Pushform' },
    scene: 0,
    scenes: [{ nodes: [root] }],
    nodes,
    materials: [
      {
        name: 'Default',
        // The modeling color (#f3f2ee), linear.
        pbrMetallicRoughness: { baseColorFactor: [0.896, 0.888, 0.855, 1], metallicFactor: 0, roughnessFactor: 1 },
        doubleSided: true,
      },
    ],
  };
  if (meshes.length) Object.assign(json, { meshes, accessors, bufferViews, buffers: [{ byteLength }] });
  return glb(JSON.stringify(json), chunks, byteLength);
}

/** The GLB container: a header, the JSON chunk padded with spaces, the binary chunk padded with zeros. */
function glb(json: string, chunks: readonly Uint8Array[], binLength: number): Uint8Array<ArrayBuffer> {
  const text = new TextEncoder().encode(json);
  const jsonPad = (4 - (text.length % 4)) % 4;
  const binPad = (4 - (binLength % 4)) % 4;
  const hasBin = binLength > 0;
  const total = 12 + 8 + text.length + jsonPad + (hasBin ? 8 + binLength + binPad : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, text.length + jsonPad, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(text, 20);
  out.fill(0x20, 20 + text.length, 20 + text.length + jsonPad);
  if (hasBin) {
    let at = 20 + text.length + jsonPad;
    view.setUint32(at, binLength + binPad, true);
    view.setUint32(at + 4, 0x004e4942, true); // "BIN"
    at += 8;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
  }
  return out;
}
