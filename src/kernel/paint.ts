/**
 * Painting faces (milestone 5): material ids on a face's front and back. The
 * ids mean nothing to the kernel; it only keeps them on the right faces
 * through every edit (see Paint in types.ts).
 */
import { Draft } from './draft';
import { paintField, type FaceId, type FaceSide, type Paint, type Topology } from './types';

export interface PaintOptions {
  /** Only paint sides that have no paint yet (Explode giving a group's material to its faces). */
  readonly unpaintedOnly?: boolean;
}

/**
 * Paint sides of faces with an id, or remove their paint with null. The same
 * topology when nothing changes; ids of faces that do not exist are ignored.
 */
export function paintFaces(t: Topology, faceIds: readonly FaceId[], sides: readonly FaceSide[], id: string | null, options: PaintOptions = {}): Topology {
  let d: Draft | null = null;
  for (const f of new Set(faceIds)) {
    const face = t.faces.get(f);
    if (!face) continue;
    const next: { front?: string; back?: string } = { ...face.paint };
    for (const side of sides) {
      if (options.unpaintedOnly && next[side]) continue;
      if (id) next[side] = id;
      else delete next[side];
    }
    if (samePaint(face.paint, next)) continue;
    d ??= new Draft(t);
    const { paint: _old, ...rest } = face;
    d.setFace(f, { ...rest, ...paintField(next) });
  }
  return d ? d.commit() : t;
}

/** Replace one id by another (or remove it, with null) on every side of every face: deleting a material. */
export function replacePaint(t: Topology, from: string, to: string | null): Topology {
  let out = t;
  for (const side of ['front', 'back'] as const) {
    const faces = [...t.faces].filter(([, f]) => f.paint?.[side] === from).map(([id]) => id);
    if (faces.length) out = paintFaces(out, faces, [side], to);
  }
  return out;
}

const samePaint = (a: Paint | undefined, b: Paint) => (a?.front ?? null) === (b.front ?? null) && (a?.back ?? null) === (b.back ?? null);
