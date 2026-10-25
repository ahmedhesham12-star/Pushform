import type { FaceData, ModelData, Point3 } from './model';

/** On-disk form of the face/loop model. Bump version on any breaking change. */
export interface SerializedModel {
  kind: 'face-loop';
  version: 1;
  next: number;
  faces: Record<string, { outer: number[][]; holes: number[][][]; normal: number[]; side: boolean }>;
}

export function serialize(m: ModelData): SerializedModel {
  const faces: SerializedModel['faces'] = {};
  for (const [id, f] of Object.entries(m.faces)) {
    faces[id] = {
      outer: f.outer.map((p) => [...p]),
      holes: f.holes.map((h) => h.map((p) => [...p])),
      normal: [...f.normal],
      side: f.side,
    };
  }
  return { kind: 'face-loop', version: 1, next: m.next, faces };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function point(v: unknown): Point3 | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    return null;
  }
  return [v[0], v[1], v[2]];
}

function loop(v: unknown): Point3[] | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const pts = v.map(point);
  return pts.every((p): p is Point3 => p !== null) ? pts : null;
}

/** Validate and load a serialized model. Returns null when the data is not a valid model. */
export function deserialize(data: unknown): ModelData | null {
  if (!isObject(data) || data.kind !== 'face-loop' || data.version !== 1) return null;
  if (!Number.isInteger(data.next) || !isObject(data.faces)) return null;
  const faces: Record<string, FaceData> = {};
  for (const [id, raw] of Object.entries(data.faces)) {
    if (!isObject(raw) || !Array.isArray(raw.holes) || typeof raw.side !== 'boolean') return null;
    const outer = loop(raw.outer);
    const normal = point(raw.normal);
    const holes = raw.holes.map(loop);
    if (!outer || !normal || !holes.every((h): h is Point3[] => h !== null)) return null;
    faces[id] = { outer, holes, normal, side: raw.side };
  }
  return { faces, next: data.next as number };
}
