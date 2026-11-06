/**
 * Importing OBJ, STL and GLB files as reference meshes (milestone 6), with
 * three.js's loaders. The app loads this layer on demand. It reads the
 * triangles and colors of a file; the app asks for units and places the result.
 */
import { BufferGeometry, Matrix4, Mesh, Vector3, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { buildMesh, MAX_MESH_TRIANGLES, type MeshData } from '../scene';

export type ImportFormat = 'stl' | 'obj' | 'glb';

/** The format of a file by its extension, or null when it is not one we import. */
export function formatOf(fileName: string): ImportFormat | null {
  const dot = fileName.lastIndexOf('.');
  const ext = dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
  return ext === 'stl' || ext === 'obj' || ext === 'glb' ? ext : null;
}

/** Units a file may be in, in mm each. */
export const IMPORT_UNITS = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 } as const;
export type ImportUnit = keyof typeof IMPORT_UNITS;

/** The color of a mesh whose file gives none: a neutral metal grey. */
export const MESH_COLOR = '#a7abb0';

export interface ImportedFile {
  readonly format: ImportFormat;
  /** Triangle soups (nine numbers per triangle) in the file's own units and axes, one per mesh, with its color. */
  readonly parts: readonly { positions: Float32Array; color: string }[];
  readonly triangles: number;
  /** The units the file states (GLB is in meters), or null when it states none and the user picks. */
  readonly unit: ImportUnit | null;
  /** Read with Z up unless the user switches it off (STL and OBJ); GLB is Y up, like Pushform. */
  readonly zUp: boolean;
}

export type ImportError = 'unreadable' | 'empty' | 'tooLarge';

/** Read a file's triangles. */
export async function readImport(format: ImportFormat, bytes: ArrayBuffer): Promise<ImportedFile | { error: ImportError }> {
  let parts: { positions: Float32Array; color: string }[];
  try {
    if (format === 'stl') parts = [{ positions: soup(new STLLoader().parse(bytes)), color: MESH_COLOR }];
    else if (format === 'obj') parts = meshesOf(new OBJLoader().parse(new TextDecoder().decode(bytes)), false);
    else parts = meshesOf(await parseGlb(bytes), true);
  } catch {
    return { error: 'unreadable' };
  }
  parts = parts.filter((p) => p.positions.length);
  const triangles = parts.reduce((n, p) => n + p.positions.length / 9, 0);
  if (!triangles) return { error: 'empty' };
  if (triangles > MAX_MESH_TRIANGLES) return { error: 'tooLarge' };
  return { format, parts, triangles, unit: format === 'glb' ? 'm' : null, zUp: format !== 'glb' };
}

function parseGlb(bytes: ArrayBuffer): Promise<Object3D> {
  return new Promise((resolve, reject) => new GLTFLoader().parse(bytes, '', (gltf) => resolve(gltf.scene), reject));
}

/** A geometry's triangles as a soup, placed by `matrix`; turned around when the matrix mirrors. */
function soup(geometry: BufferGeometry, matrix?: Matrix4): Float32Array {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.getAttribute('position');
  if (!p) return new Float32Array();
  const out = new Float32Array(p.count * 3);
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (matrix) v.applyMatrix4(matrix);
    out.set([v.x, v.y, v.z], i * 3);
  }
  if (matrix && matrix.determinant() < 0) {
    for (let t = 0; t + 8 < out.length; t += 9) {
      const b = out.slice(t + 3, t + 6);
      out.copyWithin(t + 3, t + 6, t + 9);
      out.set(b, t + 6);
    }
  }
  return out.subarray(0, Math.floor(out.length / 9) * 9);
}

/** Every mesh in a loaded scene, placed where the file puts it, with its color (or the default without one). */
function meshesOf(root: Object3D, colored: boolean): { positions: Float32Array; color: string }[] {
  root.updateMatrixWorld(true);
  const out: { positions: Float32Array; color: string }[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const material = (Array.isArray(o.material) ? o.material[0] : o.material) as (Material & { color?: { getHexString(): string } }) | undefined;
    const color = colored && material?.color ? `#${material.color.getHexString()}` : MESH_COLOR;
    out.push({ positions: soup(o.geometry as BufferGeometry, o.matrixWorld), color });
  });
  return out;
}

/**
 * The mesh of an imported file in mm, Y up (Z up files turned a quarter about
 * red: (x, y, z) becomes (x, z, -y)), its origin at the lowest corner of its box.
 */
export function importMesh(file: ImportedFile, unit: ImportUnit, zUp: boolean): MeshData | null {
  const k = IMPORT_UNITS[unit];
  const parts = file.parts.map((p) => {
    const q = new Float32Array(p.positions.length);
    for (let i = 0; i < q.length; i += 3) {
      const [x, y, z] = [p.positions[i]! * k, p.positions[i + 1]! * k, p.positions[i + 2]! * k];
      q.set(zUp ? [x, z, -y] : [x, y, z], i);
    }
    return { positions: q, color: p.color };
  });
  const min = [Infinity, Infinity, Infinity];
  for (const p of parts) for (let i = 0; i < p.positions.length; i++) min[i % 3] = Math.min(min[i % 3]!, p.positions[i]!);
  for (const p of parts) for (let i = 0; i < p.positions.length; i++) p.positions[i] = p.positions[i]! - min[i % 3]!;
  return buildMesh(parts);
}

/** The size of an imported file in mm (x, y, z after the axis change), to show before placing. */
export function importSize(file: ImportedFile, unit: ImportUnit, zUp: boolean): [number, number, number] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of file.parts) {
    for (let i = 0; i < p.positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3]!, p.positions[i]!);
      max[i % 3] = Math.max(max[i % 3]!, p.positions[i]!);
    }
  }
  const k = IMPORT_UNITS[unit];
  const [x, y, z] = [0, 1, 2].map((i) => (max[i]! - min[i]!) * k) as [number, number, number];
  return zUp ? [x, z, y] : [x, y, z];
}
