import {
  checkModel,
  createModel,
  drawRectangle,
  erase,
  faceTriangles,
  listEdges,
  listFaces,
  moveGeometry,
  offset,
  paintFaces,
  pushPull,
  type FaceView,
  type Model,
  type Paint,
  type Point3,
} from '../../src/kernel';
import { rng } from './randomRun';

/*
 * Paint follows faces through every edit (milestone 5, step 3). Random boxes,
 * rectangles drawn on faces, push/pull, erased edges, offsets, moves and
 * paint, on a 50 mm grid. After every step:
 * - the model is valid;
 * - wherever a painted face was, the face there now has the same paint, on
 *   the same side of the plane (front and back swap only when the face turned),
 *   or the paint of the face a move or push/pull brought there;
 * - a push/pull's new area (walls, a lone face's bottom) has the pushed face's paint.
 */

const PAINTS = ['oak', 'ply', 'red'] as const;
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const sub = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** A point inside a face: the middle of its largest triangle. */
function sample(m: Model, f: FaceView): Point3 | null {
  let best: Point3 | null = null;
  let area = 0;
  for (const [a, b, c] of faceTriangles(m, f.id)) {
    const u = sub(b, a);
    const v = sub(c, a);
    const k = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
    if (k > area) {
      area = k;
      best = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    }
  }
  return best;
}

/** Whether a point of a face facing `normal` lies inside face f: in the same plane, inside its outer loop and outside its holes. */
function inside(f: FaceView, p: Point3, normal: readonly number[]): boolean {
  if (Math.abs(Math.abs(dot(f.normal, normal)) - 1) > 1e-9 || Math.abs(dot(sub(p, f.outer[0]!), f.normal)) > 1e-6) return false;
  // Project away the normal's largest axis.
  const n = f.normal.map(Math.abs);
  const drop = n[0]! >= n[1]! && n[0]! >= n[2]! ? 0 : n[1]! >= n[2]! ? 1 : 2;
  const to2 = (q: Point3) => q.filter((_, i) => i !== drop) as [number, number];
  const at = to2(p);
  const contains = (loop: Point3[]) => {
    let c = false;
    const pts = loop.map(to2);
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!;
      const [xj, yj] = pts[j]!;
      if (yi > at[1] !== yj > at[1] && at[0] < ((xj - xi) * (at[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  return contains(f.outer) && !f.holes.some(contains);
}

const show = (p: Paint | undefined) => `${p?.front ?? '-'}/${p?.back ?? '-'}`;
const flip = (p: Paint | undefined): Paint | undefined => p && { ...(p.back ? { front: p.back } : {}), ...(p.front ? { back: p.front } : {}) };

/**
 * What is wrong with the paint after a step, from before it. `moved` is the
 * paint of the face a move or push/pull carried, and `created` the faces a
 * push/pull made, when one ran.
 */
export function paintProblems(before: Model, after: Model, moved?: { paint: Paint | undefined; created?: readonly string[] }): string[] {
  const out: string[] = [];
  const old = listFaces(before);
  for (const f of listFaces(after)) {
    const p = sample(after, f);
    if (!p) continue;
    // Where faces overlapped (back to back, or a stretched face over another) any of them may own the
    // place; so may the face that kept this id (it stretched there).
    const here = old.filter((o) => inside(o, p, f.normal));
    const was = here.find((o) => dot(o.normal, f.normal) > 0) ?? here[0];
    if (was) {
      if (!here.some((o) => o.paint)) continue;
      const options = [...here, ...old.filter((o) => o.id === f.id)].map((o) => show(dot(o.normal, f.normal) > 0 ? o.paint : flip(o.paint)));
      const arrived = moved && [moved.paint, flip(moved.paint)].some((x) => show(x) === show(f.paint));
      if (!options.includes(show(f.paint)) && !arrived) out.push(`${f.id} at ${p.map((x) => x.toFixed(1))} was ${show(was.paint)} (${was.id}), now ${show(f.paint)}`);
    } else if (moved?.created?.includes(f.id) && show(moved.paint) !== show(f.paint)) {
      out.push(`new ${f.id} has ${show(f.paint)}, pushed face had ${show(moved.paint)}`);
    }
  }
  return out;
}

/**
 * After a move, which stretches neighbors into the space the moved faces left:
 * every face keeps its paint under its own id, and new faces (fold pieces)
 * carry paint some face had before.
 */
export function movePaintProblems(before: Model, after: Model): string[] {
  const old = new Map(listFaces(before).map((f) => [f.id, show(f.paint)]));
  const known = new Set([...old.values()].flatMap((x) => [x, show(flip(parse(x)))]));
  const out: string[] = [];
  for (const f of listFaces(after)) {
    const was = old.get(f.id);
    if (was !== undefined ? was !== show(f.paint) : !known.has(show(f.paint))) out.push(`${f.id} was ${was ?? 'new'}, now ${show(f.paint)}`);
  }
  return out;
}

const parse = (x: string): Paint => {
  const [front, back] = x.split('/');
  return { ...(front !== '-' ? { front: front! } : {}), ...(back !== '-' ? { back: back! } : {}) };
};

/** The random run; throws with the seed and step on the first problem. Returns the final model. */
export function paintRun(seed: number, steps: number, trace?: (step: number, op: number, before: Model, after: Model, detail: string) => void): Model {
  const r = rng(seed);
  const grid = (n: number) => Math.floor(r() * n) * 50;
  const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(r() * xs.length)];
  const paint = () => pick(PAINTS)!;
  let m = createModel();
  for (let step = 0; step < steps; step++) {
    const faces = listFaces(m);
    const op = faces.length ? Math.floor(r() * 8) : 0;
    let next: Model | null = null;
    let moved: { paint: Paint | undefined; created?: readonly string[] } | undefined;
    let detail = '';
    let stretched = false;
    const face = pick(faces);
    if (op === 0 || !face) {
      // A painted box on the ground.
      const rect = drawRectangle(m, { faceId: null, corner: [grid(20), 0, grid(20)], width: 100 + grid(6), depth: 100 + grid(6) });
      if (rect.ok) {
        const box = pushPull(rect.model, rect.faceIds[0]!, 100 + grid(6));
        next = paintFaces(box.model, [rect.faceIds[0]!, ...box.createdFaceIds], ['front'], paint());
        next = paintFaces(next, [rect.faceIds[0]!, ...box.createdFaceIds], ['back'], paint());
      }
    } else if (op === 1) {
      // A rectangle on a face, from one of its corners, maybe reaching past it.
      const c = pick(face.outer)!;
      const spec = { faceId: face.id, corner: c, width: (r() < 0.5 ? -1 : 1) * (50 + grid(4)), depth: (r() < 0.5 ? -1 : 1) * (50 + grid(4)) };
      const rect = drawRectangle(m, spec);
      detail = `rectangle ${JSON.stringify(spec)}`;
      if (rect.ok) next = rect.model;
    } else if (op === 2) {
      const distance = (r() < 0.5 ? -1 : 1) * (50 + grid(4));
      const res = pushPull(m, face.id, distance);
      next = res.model;
      detail = `push ${face.id} by ${distance}, went ${res.distance}, created ${res.createdFaceIds}, removed ${res.removedFaceIds}`;
      // A push that only stretches its neighbors (no walls) is checked like a move.
      stretched = !res.createdFaceIds.length && !res.removedFaceIds.length;
      moved = { paint: face.paint, created: res.createdFaceIds };
    } else if (op === 3) {
      const e = pick(listEdges(m));
      if (e) next = erase(m, [], [e.id]).model;
    } else if (op === 4) {
      const res = offset(m, face.id, [], 10 + grid(2) / 5);
      if (res.ok) next = res.model;
    } else if (op === 5) {
      const axis = Math.floor(r() * 3);
      const v: [number, number, number] = [0, 0, 0];
      v[axis] = (r() < 0.5 ? -1 : 1) * 50;
      const res = moveGeometry(m, [face.id], [], v);
      if (res.ok) next = res.model;
    } else {
      const side = r() < 0.5 ? 'front' : 'back';
      next = paintFaces(m, [face.id], [side], r() < 0.2 ? null : paint());
    }
    if (!next) continue;
    // Boxes and painting change paint on purpose; every other step must keep it.
    trace?.(step, op, m, next, detail);
    // A merge (erase) keeps the larger face's paint, and a move stretches neighbors into the space it leaves: check those by face.
    const kept = op === 0 || op >= 6 ? [] : op === 3 || op === 5 || stretched ? movePaintProblems(m, next) : paintProblems(m, next, moved);
    const problems = [...checkModel(next), ...kept];
    if (problems.length) throw new Error(`seed ${seed}, step ${step} (op ${op}): ${problems.join('; ')}`);
    m = next;
  }
  return m;
}
