import type { Vector3 } from 'three';
import { rectangleAxes, type Vec3 } from '../kernel';
import type { Frame } from '../viewport/frame';

/** A rectangle being drawn: world points and normal, and the direction of its first side if aligned to an edge. */
export interface RectangleDrag {
  normal: Vector3;
  start: Vector3;
  current: Vector3;
  axis: Vector3 | null;
}

type Tuple3 = [number, number, number];
const sub = (a: readonly number[], b: readonly number[]): Tuple3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/**
 * The rectangle as command input, in the editing context's coordinates: its
 * sides follow the context's own axes (a turned group's, inside it), or the
 * aligned edge. Width and depth are signed sizes along those sides.
 */
export function rectangleInput(frame: Frame, s: RectangleDrag) {
  const normal = frame.normalToLocal(s.normal);
  const axis = s.axis ? frame.dirToLocal(s.axis) : null;
  const [u, v] = rectangleAxes(normal, axis);
  const corner = frame.toLocal(s.start);
  const d = sub(frame.toLocal(s.current), corner);
  return { corner, normal, axis, width: dot(d, u), depth: dot(d, v) };
}

/** Whether a direction (in the plane with this normal) runs along neither of the plane's own axes. */
export function misaligned(normal: Vec3, dir: Vec3): boolean {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (!len) return false;
  const [u, v] = rectangleAxes(normal);
  const across = (a: Vec3) => Math.abs(Math.abs(dot(a, dir) / len) - 1) > 1e-6;
  return across(u) && across(v);
}

/**
 * The first-side direction to align a new rectangle to (an improvement over
 * SketchUp), in local coordinates, or null to keep the plane's own axes:
 * - started on an edge that runs along neither axis: that edge;
 * - started on a face none of whose edges runs along an axis: the face's
 *   edge nearest the start point.
 */
export function alignment(normal: Vec3, start: Vec3, edge: readonly [Vec3, Vec3] | null, outline: readonly Vec3[] | null): Vec3 | null {
  if (edge) {
    const dir = sub(edge[1], edge[0]);
    return misaligned(normal, dir) ? dir : null;
  }
  if (!outline || outline.length < 3) return null;
  const sides = outline.map((p, i) => [p, outline[(i + 1) % outline.length]!] as const);
  if (!sides.every(([a, b]) => misaligned(normal, sub(b, a)))) return null;
  // The side nearest the start point.
  let best: { dist: number; dir: Tuple3 } | null = null;
  for (const [a, b] of sides) {
    const ab = sub(b, a);
    const t = Math.max(0, Math.min(1, dot(sub(start, a), ab) / dot(ab, ab)));
    const off = sub(start, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
    const dist = Math.hypot(...off);
    if (!best || dist < best.dist) best = { dist, dir: ab };
  }
  return best!.dir;
}
