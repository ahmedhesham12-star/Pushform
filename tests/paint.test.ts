import { describe, expect, test } from 'vitest';
import {
  checkModel,
  createModel,
  deserialize,
  drawLine,
  drawRectangle,
  erase,
  faceArea,
  getFace,
  listFaces,
  mergeGeometry,
  moveGeometry,
  offset,
  paintFaces,
  pushPull,
  replacePaint,
  serialize,
  transformGeometry,
  transformSelection,
  type Model,
  type Paint,
} from '../src/kernel';
import { paintProblems, paintRun } from './helpers/randomPaint';

/*
 * Paint in the kernel (milestone 5, step 3): material ids on each face side,
 * kept through every edit as SketchUp keeps them (see "Verified in SketchUp").
 * Sizes in mm; faces drawn on the ground face up.
 */

function valid(m: Model): Model {
  expect(checkModel(m)).toEqual([]);
  return m;
}

function rect(m: Model, faceId: string | null, corner: [number, number, number], width: number, depth: number) {
  const r = drawRectangle(m, { faceId, corner, width, depth });
  if (!r.ok) throw new Error(r.error);
  return { model: valid(r.model), id: r.faceIds[0]! };
}

/** A 1000 x 1000 x 500 box with every face painted M on the front; returns the model and its top. */
function box(paint: Paint = { front: 'M' }) {
  const g = rect(createModel(), null, [0, 0, 0], 1000, 1000);
  const p = pushPull(g.model, g.id, 500);
  let m = p.model;
  const all = listFaces(m).map((f) => f.id);
  if (paint.front) m = paintFaces(m, all, ['front'], paint.front);
  if (paint.back) m = paintFaces(m, all, ['back'], paint.back);
  return { m: valid(m), top: g.id };
}

const paintOf = (m: Model, id: string) => getFace(m, id)?.paint;
const byPaint = (m: Model) => listFaces(m).map((f) => [Math.round(faceArea(m, f.id)), f.paint?.front ?? null, f.paint?.back ?? null]).sort();

describe('painting', () => {
  test('paints sides, removes paint, fills only unpainted sides; no change gives the same model', () => {
    const g = rect(createModel(), null, [0, 0, 0], 100, 100);
    let m = paintFaces(g.model, [g.id], ['front'], 'oak');
    expect(paintOf(m, g.id)).toEqual({ front: 'oak' });
    expect(paintFaces(m, [g.id], ['front'], 'oak')).toBe(m);
    m = paintFaces(m, [g.id], ['front', 'back'], 'ply', { unpaintedOnly: true });
    expect(paintOf(m, g.id)).toEqual({ front: 'oak', back: 'ply' });
    m = paintFaces(m, [g.id], ['front'], null);
    expect(paintOf(m, g.id)).toEqual({ back: 'ply' });
    expect(paintFaces(m, ['f999'], ['front'], 'oak')).toBe(m);
    m = replacePaint(m, 'ply', 'walnut');
    expect(paintOf(m, g.id)).toEqual({ back: 'walnut' });
    m = replacePaint(m, 'walnut', null);
    expect(paintOf(m, g.id)).toBeUndefined();
    expect(replacePaint(m, 'walnut', null)).toBe(m);
  });

  test('paint is saved with the model and comes back; bad paint makes a model invalid', () => {
    const { m } = box({ front: 'M', back: 'B' });
    const saved = serialize(m);
    expect(byPaint(deserialize(JSON.parse(JSON.stringify(saved)))!)).toEqual(byPaint(m));
    const id = Object.keys(saved.faces)[0]!;
    const bad = structuredClone(saved);
    (bad.faces[id] as { paint: unknown }).paint = { front: 3 };
    expect(deserialize(bad)).toBeNull();
    // Older files have no paint at all.
    const plain = structuredClone(saved);
    for (const f of Object.values(plain.faces)) delete f.paint;
    expect(listFaces(deserialize(plain)!).every((f) => !f.paint)).toBe(true);
  });
});

describe('paint follows faces (checked in SketchUp)', () => {
  test('push/pull: walls and both caps take the pushed face front and back', () => {
    for (const paint of [{ front: 'M' }, { back: 'B' }, { front: 'M', back: 'B' }]) {
      const g = rect(createModel(), null, [0, 0, 0], 1000, 1000);
      const m = valid(pushPull(paintFaces(paintFaces(g.model, [g.id], ['front'], paint.front ?? null), [g.id], ['back'], paint.back ?? null), g.id, 200).model);
      expect(listFaces(m).length).toBe(6);
      for (const f of listFaces(m)) expect(f.paint).toEqual(paint);
    }
  });

  test('a rectangle drawn on a painted face: both pieces keep front and back', () => {
    const { m: b, top } = box({ front: 'M', back: 'B' });
    const r = rect(b, top, [300, 500, 300], 400, 400);
    expect(paintOf(r.model, r.id)).toEqual({ front: 'M', back: 'B' });
    expect(paintOf(r.model, top)).toEqual({ front: 'M', back: 'B' });
  });

  test('a line across a face: both pieces keep its paint', () => {
    const { m: b } = box({ front: 'M', back: 'B' });
    const out = drawLine(b, [300, 500, 0], [300, 500, 1000]);
    valid(out.model);
    const tops = listFaces(out.model).filter((f) => f.normal[1] === 1);
    expect(tops.length).toBe(2);
    for (const f of tops) expect(f.paint).toEqual({ front: 'M', back: 'B' });
  });

  test('a pocket and a through-hole: their walls take the pushed face material', () => {
    for (const depth of [200, 500]) {
      const { m: b, top } = box();
      const r = rect(b, top, [300, 500, 300], 400, 400);
      const m = valid(pushPull(paintFaces(r.model, [r.id], ['front'], 'P'), r.id, -depth).model);
      const inner = listFaces(m).filter((f) => f.outer.every((p) => p[0] >= 300 && p[0] <= 700 && p[2] >= 300 && p[2] <= 700));
      // Four walls, and the floor of a pocket.
      expect(inner.length).toBe(depth === 500 ? 4 : 5);
      for (const f of inner) expect(f.paint).toEqual({ front: 'P' });
      const ids = new Set(inner.map((f) => f.id));
      for (const f of listFaces(m).filter((x) => !ids.has(x.id))) expect(f.paint).toEqual({ front: 'M' });
    }
  });

  test('erasing the edge between two painted faces keeps the larger face paint', () => {
    for (const [wa, wb, expected] of [
      [600, 400, 'A'],
      [400, 600, 'B'],
    ] as const) {
      const a = rect(createModel(), null, [0, 0, 0], wa, 1000);
      const b = rect(a.model, null, [wa, 0, 0], wb, 1000);
      const m = paintFaces(paintFaces(b.model, [a.id], ['front'], 'A'), [b.id], ['front'], 'B');
      const shared = listFaces(m).length === 2 ? findSharedEdge(m, wa) : '';
      const out = valid(erase(m, [], [shared]).model);
      expect(listFaces(out).map((f) => f.paint)).toEqual([{ front: expected }]);
    }
  });

  test('a corner moved up folds the top; the pieces keep its paint', () => {
    const { m: b, top } = box({ front: 'M', back: 'B' });
    const corner = getFace(b, top)!.outer[0]!;
    const v = cornerVertex(b, corner);
    const out = moveGeometry(b, [], [], [0, 200, 0], [v]);
    if (!out.ok) throw new Error(out.error);
    valid(out.model);
    const pieces = listFaces(out.model).filter((f) => f.normal[1] > 0.5);
    expect(pieces.length).toBe(2);
    for (const f of pieces) expect(f.paint).toEqual({ front: 'M', back: 'B' });
  });

  test('mirrored faces keep their paint on the side facing out; a placed copy and a merge keep it too', () => {
    const { m: b } = box({ front: 'M', back: 'B' });
    const mirror = (p: readonly number[]): [number, number, number] => [-p[0]!, p[1]!, p[2]!];
    const flipped = valid(transformGeometry(b, mirror, mirror, { mirror: true }));
    for (const f of listFaces(flipped)) expect(f.paint).toEqual({ front: 'M', back: 'B' });
    const all = listFaces(b);
    const turned = transformSelection(b, all.map((f) => f.id), [], mirror, mirror, [], { mirror: true });
    if (!turned.ok) throw new Error(turned.error);
    for (const f of listFaces(valid(turned.model))) expect(f.paint).toEqual({ front: 'M', back: 'B' });
    const merged = mergeGeometry(createModel(), flipped);
    for (const f of listFaces(valid(merged.model))) expect(f.paint).toEqual({ front: 'M', back: 'B' });
  });

  test('an offset face: the new face inside and the ring keep the paint', () => {
    const { m: b, top } = box({ front: 'M', back: 'B' });
    const out = offset(b, top, [], 100);
    if (!out.ok) throw new Error(out.error);
    valid(out.model);
    const tops = listFaces(out.model).filter((f) => f.normal[1] === 1);
    expect(tops.length).toBe(2);
    for (const f of tops) expect(f.paint).toEqual({ front: 'M', back: 'B' });
  });

  test('the paint check itself catches lost paint', () => {
    const { m } = box();
    expect(paintProblems(m, paintFaces(m, [listFaces(m)[0]!.id], ['front'], null)).length).toBe(1);
  });
});

describe('random edits keep paint where it was', () => {
  // A few seeds here; the long sweep is in tests/stress.
  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('seed %i', (seed) => {
    expect(listFaces(paintRun(seed, 40)).some((f) => f.paint)).toBe(true);
  });

  // Found by stress sweep 8. 8006: a push that stretched a face across its own diagonal edge
  // (now it builds walls instead). 8368: a rectangle off a 1 mm slanted face that landed 0.01 mm
  // from a corner and left a sliver (now refused with tooClose).
  test.each([
    [8006, 40],
    [8368, 23],
  ])('regression: seed %i', (seed, steps) => {
    expect(listFaces(paintRun(seed, steps)).length).toBeGreaterThan(0);
  });
});

/** The edge between the two ground faces at x. */
function findSharedEdge(m: Model, x: number): string {
  const s = serialize(m);
  const at = (v: string) => s.vertices[v]!;
  return Object.entries(s.edges).find(([, e]) => e.v.every((v) => at(v)[0] === x))![0];
}

/** The vertex at a point. */
function cornerVertex(m: Model, p: readonly number[]): string {
  const s = serialize(m);
  return Object.entries(s.vertices).find(([, q]) => q.every((c, i) => c === p[i]))![0];
}
