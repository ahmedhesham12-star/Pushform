import { faceMeshes, faceTextureFrame, getFace, type FaceMesh, type Model } from '../kernel';
import { rootDefinition, tagShown, type Definition, type Instance, type MaterialId, type Scene } from '../scene';
import { fromBase64 } from './base64';

/** glTF is in meters; Pushform in millimeters. Both are Y-up and right-handed. */
const M = 0.001;
/** The modeling color (#f3f2ee), for faces with no material. */
const DEFAULT_COLOR = '#f3f2ee';

interface GltfNode {
  name?: string;
  mesh?: number;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  children?: number[];
}

/** An sRGB #rrggbb color as glTF's linear base color factor. */
function linear(hex: string): number[] {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return [...c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)), 1].map((v) => Math.round(v * 1e4) / 1e4);
}

/** Texture coordinates of a face mesh in tiles of a texture: along each face's texture frame, v going down the image. */
function tileUVs(model: Model, mesh: FaceMesh, width: number, height: number): number[] {
  const frame = faceTextureFrame(model, mesh.faceId);
  const out: number[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    if (!frame) {
      out.push(0, 0);
      continue;
    }
    const d = [mesh.positions[i]! - frame.origin[0], mesh.positions[i + 1]! - frame.origin[1], mesh.positions[i + 2]! - frame.origin[2]];
    const u = d[0]! * frame.u[0] + d[1]! * frame.u[1] + d[2]! * frame.u[2];
    const v = d[0]! * frame.v[0] + d[1]! * frame.v[1] + d[2]! * frame.v[2];
    out.push(u / width, -v / height);
  }
  return out;
}

/**
 * The scene as a binary glTF (GLB), in meters, Y up. The node tree follows
 * the scene: the model, then its groups and components, nested. Each
 * definition becomes one mesh shared by all its instances that pass down the
 * same material, so components stay instances in the file. Faces are split
 * into one primitive per material: their own (front) paint, else what the
 * instances around them pass down, else the default color; textured
 * materials carry their image. Materials are double-sided; back paint is
 * not written (glTF gives a primitive one material).
 */
export function exportGlb(scene: Scene, name = ''): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: { buffer: 0; byteOffset: number; byteLength: number; target?: number }[] = [];
  const accessors: object[] = [];
  const meshes: object[] = [];
  const nodes: GltfNode[] = [];
  const materials: object[] = [];
  const images: object[] = [];
  const textures: object[] = [];
  const materialOf = new Map<MaterialId | null, number>();
  const meshOf = new Map<string, number | null>();

  /** Append bytes as a buffer view starting on a 4-byte boundary (as glTF needs); returns its index. */
  const view = (bytes: Uint8Array, target?: number): number => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      byteLength += pad;
    }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push(bytes);
    byteLength += bytes.byteLength;
    return bufferViews.length - 1;
  };

  /** Append float32 values as an accessor of VEC2 or VEC3 items. */
  const accessor = (values: Float32Array, type: 'VEC2' | 'VEC3', withBounds: boolean): number => {
    const size = type === 'VEC2' ? 2 : 3;
    const a: Record<string, unknown> = { bufferView: view(new Uint8Array(values.buffer, values.byteOffset, values.byteLength), 34962), componentType: 5126, count: values.length / size, type };
    if (withBounds) {
      const min = Array<number>(size).fill(Infinity);
      const max = Array<number>(size).fill(-Infinity);
      for (let i = 0; i < values.length; i++) {
        min[i % size] = Math.min(min[i % size]!, values[i]!);
        max[i % size] = Math.max(max[i % size]!, values[i]!);
      }
      Object.assign(a, { min, max });
    }
    accessors.push(a);
    return accessors.length - 1;
  };

  /** The glTF material for a scene material (null: the default), made once. */
  const gltfMaterial = (id: MaterialId | null): number => {
    if (materialOf.has(id)) return materialOf.get(id)!;
    const m = id === null ? undefined : scene.materials.get(id);
    const pbr: Record<string, unknown> = { baseColorFactor: linear(m?.color ?? DEFAULT_COLOR), metallicFactor: 0, roughnessFactor: 1 };
    if (m?.texture) {
      images.push({ bufferView: view(fromBase64(m.texture.data)), mimeType: m.texture.mime });
      textures.push({ sampler: 0, source: images.length - 1 });
      pbr.baseColorTexture = { index: textures.length - 1 };
      // The image shows its own colors, as in the app.
      pbr.baseColorFactor = [1, 1, 1, 1];
    }
    materials.push({ name: m?.name ?? 'Default', pbrMetallicRoughness: pbr, doubleSided: true });
    materialOf.set(id, materials.length - 1);
    return materials.length - 1;
  };

  /** The mesh of a definition's own faces with what its instance passes down, built once; null when it has none. */
  const mesh = (def: Definition, inherited: MaterialId | null): number | null => {
    const key = `${def.id}|${inherited ?? ''}`;
    if (meshOf.has(key)) return meshOf.get(key)!;
    const groups = new Map<MaterialId | null, FaceMesh[]>();
    for (const f of faceMeshes(def.model)) {
      if (!f.positions.length) continue;
      const own = getFace(def.model, f.faceId)?.paint?.front;
      const id = own && scene.materials.has(own) ? own : inherited;
      groups.set(id, [...(groups.get(id) ?? []), f]);
    }
    if (!groups.size) {
      meshOf.set(key, null);
      return null;
    }
    const primitives = [...groups].map(([id, faces]) => {
      const count = faces.reduce((n, f) => n + f.positions.length, 0);
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
      const attributes: Record<string, number> = { POSITION: accessor(positions, 'VEC3', true), NORMAL: accessor(normals, 'VEC3', false) };
      const texture = id === null ? undefined : scene.materials.get(id)?.texture;
      if (texture) attributes.TEXCOORD_0 = accessor(new Float32Array(faces.flatMap((f) => tileUVs(def.model, f, texture.width, texture.height))), 'VEC2', false);
      return { attributes, material: gltfMaterial(id) };
    });
    meshes.push({ name: def.name || undefined, primitives });
    meshOf.set(key, meshes.length - 1);
    return meshes.length - 1;
  };

  /** A node for a definition's geometry and the instances placed in it; returns its index. */
  const node = (def: Definition, n: GltfNode, inherited: MaterialId | null): number => {
    const index = nodes.length;
    nodes.push(n);
    const m = mesh(def, inherited);
    if (m !== null) n.mesh = m;
    // What a hidden tag hides is not exported, as it is not shown.
    const children = [...def.instances.values()].filter((i) => tagShown(scene, i.tag)).map((i) => instanceNode(i, inherited));
    if (children.length) n.children = children;
    return index;
  };
  const instanceNode = (i: Instance, inherited: MaterialId | null): number => {
    const def = scene.definitions.get(i.definitionId)!;
    const t = i.transform;
    const n: GltfNode = {};
    const label = i.name || def.name;
    if (label) n.name = label;
    if (t.translation.some((v) => v !== 0)) n.translation = t.translation.map((v) => v * M);
    if (t.rotation[3] !== 1) n.rotation = [...t.rotation];
    // A negative scale mirrors; glTF readers then wind the triangles the other way, as the spec says.
    if (t.scale.some((v) => v !== 1)) n.scale = [...t.scale];
    return node(def, n, i.material && scene.materials.has(i.material) ? i.material : inherited);
  };
  const root = node(rootDefinition(scene), { name: name || 'Model' }, null);
  // Even an empty model names the default material, as before.
  if (!materials.length) gltfMaterial(null);

  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'Pushform' },
    scene: 0,
    scenes: [{ nodes: [root] }],
    nodes,
    materials,
  };
  if (meshes.length) Object.assign(json, { meshes, accessors, bufferViews, buffers: [{ byteLength }] });
  // Tiled images repeat (glTF's REPEAT is 10497).
  if (images.length) Object.assign(json, { images, textures, samplers: [{ wrapS: 10497, wrapT: 10497 }] });
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
