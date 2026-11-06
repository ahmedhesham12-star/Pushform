/**
 * Reference meshes (milestone 6): triangles imported from another program
 * (OBJ, STL, GLB), held by a `mesh` definition instead of kernel topology.
 * They are placed, moved, copied, painted and hidden like components, and
 * picked and snapped to, but never edited.
 */
import type { Bounds, Point3, SnapKind } from '../kernel';
import { MATERIAL_COLOR } from './materials';

/** A run of triangles in one color: one mesh of the imported file. */
export interface MeshPart {
  /** How many triangles, after the previous parts'. */
  readonly triangles: number;
  /** #rrggbb. */
  readonly color: string;
}

export interface MeshData {
  /** Vertex positions in the definition's local mm: x, y, z per vertex. */
  readonly positions: Float32Array;
  /** Three vertex indices per triangle, counter-clockwise seen from its front. */
  readonly triangles: Uint32Array;
  readonly parts: readonly MeshPart[];
  /** Feature edges (boundaries, and edges sharper than FEATURE_ANGLE), as pairs of vertex indices. */
  readonly edges: Uint32Array;
  readonly bounds: Bounds;
}

/** Larger files are refused (approved decision). */
export const MAX_MESH_TRIANGLES = 1_000_000;
/** Corners closer than this (mm, the kernel's vertex tolerance) are one vertex. */
const WELD = 1e-3;
/** Edges where the faces turn more than this many degrees show and snap (approved decision). */
export const FEATURE_ANGLE = 30;

/**
 * A mesh from triangle soups (nine coordinates per triangle, in mm), one per
 * part: corners within WELD are welded, triangles with no area dropped, and
 * the feature edges found. Parts left with no triangles are dropped; null
 * when none is left.
 */
export function buildMesh(soups: readonly { positions: ArrayLike<number>; color: string }[]): MeshData | null {
  const index = new Map<string, number>();
  const positions: number[] = [];
  const triangles: number[] = [];
  const parts: MeshPart[] = [];
  const vertex = (x: number, y: number, z: number): number => {
    const key = `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`;
    let i = index.get(key);
    if (i === undefined) {
      index.set(key, (i = positions.length / 3));
      positions.push(x, y, z);
    }
    return i;
  };
  for (const soup of soups) {
    const p = soup.positions;
    const before = triangles.length;
    for (let t = 0; t + 8 < p.length; t += 9) {
      const a = vertex(p[t]!, p[t + 1]!, p[t + 2]!);
      const b = vertex(p[t + 3]!, p[t + 4]!, p[t + 5]!);
      const c = vertex(p[t + 6]!, p[t + 7]!, p[t + 8]!);
      if (a === b || b === c || a === c || !normalOf(positions, a, b, c)) continue;
      triangles.push(a, b, c);
    }
    const count = (triangles.length - before) / 3;
    if (count) parts.push({ triangles: count, color: soup.color.toLowerCase() });
  }
  if (!triangles.length) return null;
  // Corners of dropped triangles only are left out, renumbering the rest.
  const renumber = new Int32Array(positions.length / 3).fill(-1);
  const kept: number[] = [];
  for (let i = 0; i < triangles.length; i++) {
    const v = triangles[i]!;
    if (renumber[v] === -1) {
      renumber[v] = kept.length / 3;
      kept.push(positions[3 * v]!, positions[3 * v + 1]!, positions[3 * v + 2]!);
    }
    triangles[i] = renumber[v]!;
  }
  return meshFrom(new Float32Array(kept), new Uint32Array(triangles), parts);
}

/** A mesh with its feature edges and bounds worked out. */
function meshFrom(positions: Float32Array, triangles: Uint32Array, parts: readonly MeshPart[]): MeshData {
  return { positions, triangles, parts, edges: featureEdges(positions, triangles), bounds: meshBounds(positions) };
}

/** The unit normal of triangle abc, or null when it has no area. */
function normalOf(p: ArrayLike<number>, a: number, b: number, c: number): Point3 | null {
  const u = [p[3 * b]! - p[3 * a]!, p[3 * b + 1]! - p[3 * a + 1]!, p[3 * b + 2]! - p[3 * a + 2]!];
  const v = [p[3 * c]! - p[3 * a]!, p[3 * c + 1]! - p[3 * a + 1]!, p[3 * c + 2]! - p[3 * a + 2]!];
  const n: Point3 = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
  const len = Math.hypot(...n);
  return len > 1e-12 ? [n[0] / len, n[1] / len, n[2] / len] : null;
}

/** Edges used by one triangle only, by more than two, or between two that turn more than FEATURE_ANGLE. */
export function featureEdges(positions: Float32Array, triangles: Uint32Array): Uint32Array {
  const n = positions.length / 3;
  const cos = Math.cos((FEATURE_ANGLE * Math.PI) / 180);
  const normals: (Point3 | null)[] = [];
  for (let t = 0; t < triangles.length; t += 3) normals.push(normalOf(positions, triangles[t]!, triangles[t + 1]!, triangles[t + 2]!));
  // Per edge: the first triangle on it, how many use it, and whether two of them turn sharply.
  const seen = new Map<number, { first: number; count: number; sharp: boolean }>();
  for (let t = 0; t < triangles.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const a = triangles[3 * t + k]!;
      const b = triangles[3 * t + ((k + 1) % 3)]!;
      const key = Math.min(a, b) * n + Math.max(a, b);
      const e = seen.get(key);
      if (!e) {
        seen.set(key, { first: t, count: 1, sharp: false });
        continue;
      }
      e.count++;
      const p = normals[e.first];
      const q = normals[t];
      if (!p || !q || p[0] * q[0] + p[1] * q[1] + p[2] * q[2] < cos) e.sharp = true;
    }
  }
  const out: number[] = [];
  for (const [key, e] of seen) if (e.count !== 2 || e.sharp) out.push(Math.floor(key / n), key % n);
  return new Uint32Array(out);
}

function meshBounds(p: Float32Array): Bounds {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    min[i % 3] = Math.min(min[i % 3]!, p[i]!);
    max[i % 3] = Math.max(max[i % 3]!, p[i]!);
  }
  return { min: min as unknown as Point3, max: max as unknown as Point3 };
}

/** How many triangles a mesh has. */
export const triangleCount = (m: MeshData): number => m.triangles.length / 3;

/** The point of vertex i. */
export const meshPoint = (m: MeshData, i: number): Point3 => [m.positions[3 * i]!, m.positions[3 * i + 1]!, m.positions[3 * i + 2]!];

/** Snap points of a mesh in its local mm: the ends and middles of its feature edges. */
export function meshSnapPoints(m: MeshData): { point: Point3; kind: SnapKind }[] {
  const out: { point: Point3; kind: SnapKind }[] = [];
  const ends = new Set<number>();
  for (let e = 0; e < m.edges.length; e += 2) {
    const a = m.edges[e]!;
    const b = m.edges[e + 1]!;
    for (const v of [a, b]) {
      if (ends.has(v)) continue;
      ends.add(v);
      out.push({ point: meshPoint(m, v), kind: 'end' });
    }
    const p = meshPoint(m, a);
    const q = meshPoint(m, b);
    out.push({ point: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], kind: 'mid' });
  }
  return out;
}

/* ---------- files ---------- */

/** A mesh as saved: its arrays as base64 of their little-endian bytes. */
export interface SerializedMesh {
  positions: string;
  triangles: string;
  parts: { triangles: number; color: string }[];
  edges: string;
}

const bytesOf = (a: Float32Array | Uint32Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

export function saveMesh(m: MeshData): SerializedMesh {
  return { positions: toBase64(bytesOf(m.positions)), triangles: toBase64(bytesOf(m.triangles)), parts: m.parts.map((p) => ({ ...p })), edges: toBase64(bytesOf(m.edges)) };
}

/** A mesh from a file, or null when it is not a valid one. */
export function loadMesh(v: unknown): MeshData | null {
  if (typeof v !== 'object' || v === null) return null;
  const x = v as Record<string, unknown>;
  if (typeof x.positions !== 'string' || typeof x.triangles !== 'string' || typeof x.edges !== 'string' || !Array.isArray(x.parts)) return null;
  const words = (text: string) => {
    const bytes = fromBase64(text);
    return bytes.length % 4 ? null : bytes;
  };
  const pb = words(x.positions);
  const tb = words(x.triangles);
  const eb = words(x.edges);
  if (!pb || !tb || !eb) return null;
  const positions = new Float32Array(pb.buffer, pb.byteOffset, pb.length / 4);
  const triangles = new Uint32Array(tb.buffer, tb.byteOffset, tb.length / 4);
  const edges = new Uint32Array(eb.buffer, eb.byteOffset, eb.length / 4);
  const vertices = positions.length / 3;
  if (positions.length % 3 || triangles.length % 3 || edges.length % 2 || !triangles.length || triangles.length / 3 > MAX_MESH_TRIANGLES) return null;
  if (!positions.every(Number.isFinite) || !triangles.every((i) => i < vertices) || !edges.every((i) => i < vertices)) return null;
  const parts: MeshPart[] = [];
  let total = 0;
  for (const p of x.parts as unknown[]) {
    if (typeof p !== 'object' || p === null) return null;
    const { triangles: count, color } = p as Record<string, unknown>;
    if (!Number.isInteger(count) || (count as number) < 1 || typeof color !== 'string' || !MATERIAL_COLOR.test(color)) return null;
    parts.push({ triangles: count as number, color });
    total += count as number;
  }
  if (total !== triangles.length / 3) return null;
  return { positions, triangles, parts, edges, bounds: meshBounds(positions) };
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DECODE = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) DECODE[ALPHABET.charCodeAt(i)] = i;

/** Bytes as base64, written out here because the scene layer imports nothing outside the kernel. */
export function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += 3 * 8192) {
    let s = '';
    const end = Math.min(start + 3 * 8192, bytes.length);
    for (let i = start; i < end; i += 3) {
      const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
      s += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + (i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '=') + (i + 2 < bytes.length ? ALPHABET[n & 63]! : '=');
    }
    chunks.push(s);
  }
  return chunks.join('');
}

/** Base64 to bytes; characters outside the alphabet (line breaks, padding) are skipped. */
export function fromBase64(text: string): Uint8Array {
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let at = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const d = c < 128 ? DECODE[c]! : -1;
    if (d < 0) continue;
    value = ((value << 6) | d) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, at);
}
