import {
  addFace,
  CLAMP_MARGIN,
  draft,
  edgeKey,
  edgeMap,
  EPSILON,
  key,
  orient,
  type FaceData,
  type ModelData,
  type Point3,
} from './model';
import { add, cross, dot, negate, scale, sub } from './vec';

export interface PushPullResult {
  model: ModelData;
  /** Distance actually applied after clamping, in mm. 0 means nothing changed. */
  distance: number;
}

/**
 * Move a face along its normal by `requested` mm.
 * - Perpendicular rectangular neighbours are stretched along with it, which
 *   also limits the distance so they never collapse (clamping).
 * - Open edges grow new side walls.
 * - Coplanar faces filling a hole of the pushed face are carried along.
 * - A lone face (no neighbours) leaves a reversed copy behind as the bottom.
 * Returns the input model unchanged when the face is missing or the clamped
 * distance is zero.
 */
export function pushPull(m0: ModelData, faceId: string, requested: number): PushPullResult {
  const f = m0.faces[faceId];
  if (!f || Math.abs(requested) < EPSILON) return { model: m0, distance: 0 };
  const n = f.normal;
  const em = edgeMap(m0);
  const loops = [{ pts: f.outer, hole: false }, ...f.holes.map((h) => ({ pts: h, hole: true }))];
  const walls: [Point3, Point3][] = [];
  const stretch = new Map<string, Set<string>>();
  const carry = new Set<string>();
  let free = true;
  let lo = -Infinity;
  let hi = Infinity;

  for (const L of loops) {
    for (let i = 0; i < L.pts.length; i++) {
      const a = L.pts[i]!;
      const b = L.pts[(i + 1) % L.pts.length]!;
      const others = (em.get(edgeKey(a, b)) ?? []).filter((e) => e.id !== faceId);
      if (others.length) free = false;
      let handled = false;
      for (const o of others) {
        const g = m0.faces[o.id]!;
        const d = dot(g.normal, n);
        if (d > 0.999 && L.hole) {
          carry.add(o.id);
          handled = true;
          break;
        }
        if (Math.abs(d) > 1e-3) continue;
        // How far the perpendicular neighbour reaches along n from this edge.
        let ext = 0;
        for (const p of g.outer) {
          const e = dot(sub(p, a), n);
          if (Math.abs(e) > Math.abs(ext)) ext = e;
        }
        if (Math.abs(ext) < EPSILON) continue;
        if (g.outer.length === 4) {
          if (ext > 0) hi = Math.min(hi, ext - CLAMP_MARGIN);
          else lo = Math.max(lo, ext + CLAMP_MARGIN);
          let keys = stretch.get(o.id);
          if (!keys) stretch.set(o.id, (keys = new Set()));
          keys.add(key(a));
          keys.add(key(b));
          handled = true;
          break;
        }
        if (ext > 0) hi = Math.min(hi, 0);
        else lo = Math.max(lo, 0);
      }
      if (!handled) walls.push([a, b]);
    }
  }

  const distance = Math.min(hi, Math.max(lo, requested));
  if (Math.abs(distance) < EPSILON) return { model: m0, distance: 0 };
  const off = scale(n, distance);
  const mv = (p: Point3): Point3 => add(p, off);
  const m = draft(m0);

  for (const [gid, keys] of stretch) {
    const g = m.faces[gid]!;
    m.faces[gid] = { ...g, outer: g.outer.map((p) => (keys.has(key(p)) ? mv(p) : p)) };
  }
  for (const cid of carry) {
    const c = m.faces[cid]!;
    m.faces[cid] = { ...c, outer: c.outer.map(mv), holes: c.holes.map((h) => h.map(mv)) };
  }
  for (const [a, b] of walls) {
    // A lone face becomes a closed solid, so its walls face away from the loop
    // whichever way it moves. (The prototype used `off` here too, which turned
    // the walls inside out when a lone face was pulled downward.)
    addFace(m, [a, b, mv(b), mv(a)], cross(sub(b, a), free ? n : off), [], true);
  }
  const outer = f.outer.map(mv);
  const holes = f.holes.map((h) => h.map(mv));
  let moved: FaceData;
  if (free) {
    const keepN = distance > 0 ? negate(n) : n;
    const newN = distance > 0 ? n : negate(n);
    addFace(m, f.outer, keepN, f.holes);
    moved = {
      ...f,
      outer: orient(outer, newN, true),
      holes: holes.map((h) => orient(h, newN, false)),
      normal: newN,
    };
  } else {
    moved = { ...f, outer, holes };
  }
  m.faces[faceId] = moved;
  return { model: m, distance };
}
