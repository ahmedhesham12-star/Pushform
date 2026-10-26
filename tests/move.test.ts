import { describe, expect, test } from 'vitest';
import { moveGeometry } from '../src/kernel/move';
import { pushPull } from '../src/kernel/pushPull';
import { bounds } from '../src/kernel/query';
import { drawLine } from '../src/kernel/lines';
import { drawRectangle } from '../src/kernel/shapes';
import { emptyTopology, type Topology } from '../src/kernel/types';
import { validate } from '../src/kernel/validate';
import { randomMoveRun } from './helpers/randomMove';

/* All sizes in mm. */

function rect(t: Topology, x: number, z: number, w: number, d: number, faceId: string | null = null, y = 0) {
  const r = drawRectangle(t, { faceId, corner: [x, y, z], width: w, depth: d });
  if (!r.ok) throw new Error(r.error);
  return r;
}

function box(t: Topology, x: number, z: number, w: number, d: number, h: number): Topology {
  const r = rect(t, x, z, w, d);
  return pushPull(r.topology, r.faceIds[0]!, h).topology;
}

const faceWith = (t: Topology, n: [number, number, number], at?: (y: number) => boolean) =>
  [...t.faces].find(([, f]) => f.normal.every((v, i) => v === n[i]) && (!at || at(t.vertices.get(f.outer[0]!)!.p[1])))![0];
const edgesAll = (t: Topology) => [...t.edges.keys()];

function moved(r: ReturnType<typeof moveGeometry>): Topology {
  if (!r.ok) throw new Error(r.error);
  expect(validate(r.topology)).toEqual([]);
  return r.topology;
}

describe('moving geometry that is not connected to anything', () => {
  test('a whole box moves in place and keeps its ids', () => {
    const t = box(emptyTopology(), 0, 0, 1000, 500, 300);
    const r = moveGeometry(t, [...t.faces.keys()], [], [2000, 0, 100]);
    const m = moved(r);
    expect(bounds(m)).toEqual({ min: [2000, 0, 100], max: [3000, 300, 600] });
    expect([...m.faces.keys()]).toEqual([...t.faces.keys()]);
    expect(r.ok && r.faceIds.length).toBe(6);
  });

  test('a box landing on another box merges where they touch', () => {
    let t = box(emptyTopology(), 0, 0, 1000, 1000, 500);
    const before = new Set(t.faces.keys());
    t = box(t, 3000, 0, 1000, 1000, 500);
    const second = [...t.faces.keys()].filter((f) => !before.has(f));
    const m = moved(moveGeometry(t, second, [], [-3000, 500, 0]));
    // The moved bottom lands on the first box's top: one face between them, no overlap.
    expect(m.faces.size).toBe(11);
    expect(bounds(m)).toEqual({ min: [0, 0, 0], max: [1000, 1000, 1000] });
  });

  test('a loose line moves by the vector', () => {
    const t = drawLine(emptyTopology(), [0, 0, 0], [1000, 0, 0]).topology;
    const m = moved(moveGeometry(t, [], edgesAll(t), [0, 250, 0]));
    expect(bounds(m)).toEqual({ min: [0, 250, 0], max: [1000, 250, 0] });
  });

  test('a zero vector changes nothing', () => {
    const t = box(emptyTopology(), 0, 0, 1000, 500, 300);
    const r = moveGeometry(t, [...t.faces.keys()], [], [0, 0, 0]);
    expect(r.ok && r.topology).toBe(t);
  });
});

describe('stretching connected geometry', () => {
  test('moving a box top up stretches the walls', () => {
    const t = box(emptyTopology(), 0, 0, 1000, 1000, 500);
    const top = faceWith(t, [0, 1, 0], (y) => y === 500);
    const m = moved(moveGeometry(t, [top], [], [0, 200, 0]));
    expect(bounds(m)!.max[1]).toBe(700);
    expect(m.faces.size).toBe(6);
    expect([...m.faces.keys()]).toEqual([...t.faces.keys()]);
  });

  test('moving the top sideways shears the box; walls stay flat', () => {
    const t = box(emptyTopology(), 0, 0, 1000, 1000, 500);
    const top = faceWith(t, [0, 1, 0], (y) => y === 500);
    const m = moved(moveGeometry(t, [top], [], [300, 0, 0]));
    expect(bounds(m)).toEqual({ min: [0, 0, 0], max: [1300, 500, 1000] });
  });

  test('sliding one top edge along itself folds the side walls (milestone 4; was refused)', () => {
    const t = box(emptyTopology(), 0, 0, 1000, 1000, 500);
    const P = (v: string) => t.vertices.get(v)!.p;
    const edge = [...t.edges].find(([, e]) => e.v.every((v) => P(v)[1] === 500 && P(v)[2] === 0))![0];
    expect(moved(moveGeometry(t, [], [edge], [300, 0, 0])).faces.size).toBe(8);
  });

  test('moving a box top below its bottom folds the walls: blocked', () => {
    const t = box(emptyTopology(), 0, 0, 1000, 1000, 500);
    const top = faceWith(t, [0, 1, 0], (y) => y === 500);
    expect(moveGeometry(t, [top], [], [0, -800, 0])).toEqual({ ok: false, error: 'moveCrosses' });
  });

  test('an inner rectangle moves inside its face, but not across its edge', () => {
    const outer = rect(emptyTopology(), 0, 0, 2000, 2000);
    const inner = rect(outer.topology, 500, 500, 500, 500, outer.faceIds[0]!);
    const t = inner.topology;
    const innerFace = inner.faceIds.find((f) => t.faces.get(f)!.holes.length === 0)!;
    const m = moved(moveGeometry(t, [innerFace], [], [300, 0, 300]));
    expect(m.faces.size).toBe(2);
    expect(moveGeometry(t, [innerFace], [], [1200, 0, 0])).toEqual({ ok: false, error: 'moveCrosses' });
  });

  test('an inner face moved clear out of the face around it is refused (found by stress sweep 6)', () => {
    const outer = rect(emptyTopology(), 0, 0, 2000, 2000);
    const inner = rect(outer.topology, 500, 500, 500, 500, outer.faceIds[0]!);
    const t = inner.topology;
    const innerFace = inner.faceIds.find((f) => t.faces.get(f)!.holes.length === 0)!;
    // One jump past the outer edge: no edges cross at the end, but the hole would be outside its face.
    expect(moveGeometry(t, [innerFace], [], [3000, 0, 0])).toEqual({ ok: false, error: 'moveCrosses' });
  });

  test('stretching a point onto another point is blocked', () => {
    const t = box(emptyTopology(), 0, 0, 1000, 1000, 500);
    const top = faceWith(t, [0, 1, 0], (y) => y === 500);
    expect(moveGeometry(t, [top], [], [0, -500, 0]).ok).toBe(false);
  });
});

describe('randomized moves', () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('seed %i: moves are either refused or leave a valid model', (seed) => {
    randomMoveRun(seed, 12);
  });

  // Found by stress sweep 5: a stretched corner landing exactly on another vertex.
  test('seed 3116: a point landing on a point is caught', () => {
    randomMoveRun(3116, 20);
  });

  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('seed %i with single corners: folds leave a valid model', (seed) => {
    randomMoveRun(seed, 12, true);
  });

  // Found by stress sweep 5 with corners: a moved point landing inside an edge that stayed put.
  test('seed 5441 with corners: a point landing inside a still edge is caught', () => {
    randomMoveRun(5441, 20, true);
  });

  test('enough random moves are accepted to mean something', () => {
    let accepted = 0;
    for (let seed = 1; seed <= 10; seed++) accepted += randomMoveRun(seed, 12);
    expect(accepted).toBeGreaterThan(10);
  });
});
