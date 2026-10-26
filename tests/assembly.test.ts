import { describe, expect, test } from 'vitest';
import { extract, merge, transformTopology } from '../src/kernel/assembly';
import { pushPull } from '../src/kernel/pushPull';
import { faceArea } from '../src/kernel/query';
import { drawRectangle, drawRegularPolygon } from '../src/kernel/shapes';
import { emptyTopology, type Point3, type Topology } from '../src/kernel/types';
import { validate } from '../src/kernel/validate';
import { randomAssemblyRun } from './helpers/randomAssembly';

/* All sizes in mm. */

function rect(t: Topology, x0: number, z0: number, w: number, d: number, faceId: string | null = null, y = 0) {
  const r = drawRectangle(t, { faceId, corner: [x0, y, z0], width: w, depth: d });
  if (!r.ok) throw new Error(r.error);
  return r;
}

function box(t: Topology, x0: number, z0: number, w: number, d: number, h: number) {
  const r = rect(t, x0, z0, w, d);
  return pushPull(r.topology, r.faceIds[0]!, h).topology;
}

function expectValid(t: Topology, what = '') {
  expect(validate(t), what).toEqual([]);
}

const shift =
  (dx: number, dy: number, dz: number) =>
  (p: Point3): Point3 => [p[0] + dx, p[1] + dy, p[2] + dz];
const same = (v: Point3) => v;
/** A quarter turn about +Y: x -> -z, z -> x. */
const quarterY = (p: Point3): Point3 => [p[2], p[1], -p[0]];

const totalArea = (t: Topology) => [...t.faces.keys()].reduce((s, f) => s + faceArea(t, f), 0);

describe('extract', () => {
  test('a whole box moves out and leaves an empty model', () => {
    const t = box(emptyTopology(), 0, 0, 1000, 500, 300);
    const r = extract(t, [...t.faces.keys()], []);
    expectValid(r.extracted);
    expectValid(r.remaining);
    expect(r.extracted.faces.size).toBe(6);
    expect(r.extracted.edges.size).toBe(12);
    expect(r.remaining.faces.size).toBe(0);
    expect(r.remaining.edges.size).toBe(0);
    expect(r.remaining.vertices.size).toBe(0);
  });

  test('edges shared with unselected faces are copied, so both sides keep them', () => {
    // Two squares side by side; take the left one.
    let t = rect(emptyTopology(), 0, 0, 1000, 1000).topology;
    const right = rect(t, 1000, 0, 1000, 1000);
    t = right.topology;
    const left = [...t.faces.keys()].find((f) => f !== right.faceIds[0])!;
    const r = extract(t, [left], []);
    expectValid(r.extracted);
    expectValid(r.remaining);
    expect(r.extracted.faces.size).toBe(1);
    expect(r.extracted.edges.size).toBe(4);
    expect(r.remaining.faces.size).toBe(1);
    expect(r.remaining.edges.size).toBe(4);
    // The shared edge keeps its id on both sides.
    const shared = [...r.extracted.edges.keys()].filter((e) => r.remaining.edges.has(e));
    expect(shared).toHaveLength(1);
  });

  test('ids are kept, and loose selected edges come along', () => {
    let t = box(emptyTopology(), 0, 0, 1000, 1000, 500);
    const top = [...t.faces].find(([, f]) => f.normal[1] === 1)![0];
    const r0 = extract(t, [top], []);
    expect([...r0.extracted.faces.keys()]).toEqual([top]);
    // A loose edge only: erase-style selection of one edge of the box takes just that edge.
    t = box(emptyTopology(), 0, 0, 1000, 1000, 500);
    const e = [...t.edges.keys()][0]!;
    const r1 = extract(t, [], [e]);
    expect([...r1.extracted.edges.keys()]).toEqual([e]);
    expect(r1.extracted.faces.size).toBe(0);
    expect(r1.remaining.edges.has(e)).toBe(true);
    expectValid(r1.extracted);
  });

  test('a circle face takes its curve with it', () => {
    const c = drawRegularPolygon(emptyTopology(), { kind: 'circle', faceId: null, center: [0, 0, 0], radius: 500, segments: 24 });
    if (!c.ok) throw new Error(c.error);
    const r = extract(c.topology, c.faceIds, []);
    expectValid(r.extracted);
    expect(r.extracted.curves.size).toBe(1);
    expect([...r.extracted.curves.values()][0]!.edges).toHaveLength(24);
    expect(r.remaining.curves.size).toBe(0);
  });
});

describe('transformTopology', () => {
  test('a quarter turn keeps axis normals exact and the topology valid', () => {
    const t = box(emptyTopology(), 0, 0, 1000, 500, 300);
    const r = transformTopology(t, quarterY, quarterY);
    expectValid(r);
    for (const f of r.faces.values()) for (const x of f.normal) expect([0, 1, -1]).toContain(x);
    expect(totalArea(r)).toBeCloseTo(totalArea(t), 6);
  });

  test('a translation moves every vertex and curve center', () => {
    const c = drawRegularPolygon(emptyTopology(), { kind: 'circle', faceId: null, center: [0, 0, 0], radius: 500, segments: 12 });
    if (!c.ok) throw new Error(c.error);
    const r = transformTopology(c.topology, shift(100, 0, 200), same);
    expectValid(r);
    expect([...r.curves.values()][0]!.center).toEqual([100, 0, 200]);
    for (const [id, v] of r.vertices) {
      const p = c.topology.vertices.get(id)!.p;
      expect(v.p[0]).toBeCloseTo(p[0] + 100, 6);
      expect(v.p[2]).toBeCloseTo(p[2] + 200, 6);
    }
  });
});

describe('merge', () => {
  test('a box into an empty model arrives whole', () => {
    const src = box(emptyTopology(), 0, 0, 1000, 500, 300);
    const r = merge(emptyTopology(), src);
    expectValid(r.topology);
    expect(r.topology.faces.size).toBe(6);
    expect(r.topology.edges.size).toBe(12);
    expect(r.faceIds).toHaveLength(6);
    expect(totalArea(r.topology)).toBeCloseTo(totalArea(src), 6);
  });

  test('extract then merge back restores the same geometry', () => {
    let t = box(emptyTopology(), 0, 0, 1000, 1000, 500);
    t = box(t, 2000, 0, 500, 500, 500);
    const first = [...t.faces].filter(([, f]) => t.vertices.get(f.outer[0]!)!.p[0] < 1500).map(([id]) => id);
    const r = extract(t, first, []);
    const back = merge(r.remaining, r.extracted).topology;
    expectValid(back);
    expect(back.faces.size).toBe(t.faces.size);
    expect(back.edges.size).toBe(t.edges.size);
    expect(back.vertices.size).toBe(t.vertices.size);
    expect(totalArea(back)).toBeCloseTo(totalArea(t), 6);
  });

  test('two squares side by side share the edge after merging', () => {
    const a = rect(emptyTopology(), 0, 0, 1000, 1000).topology;
    const b = rect(emptyTopology(), 1000, 0, 1000, 1000).topology;
    const r = merge(a, b).topology;
    expectValid(r);
    expect(r.faces.size).toBe(2);
    expect(r.edges.size).toBe(7);
  });

  test('an overlapping square splits the faces it overlaps, and the overlap stays one face', () => {
    const a = rect(emptyTopology(), 0, 0, 1000, 1000).topology;
    const b = rect(emptyTopology(), 500, 500, 1000, 1000).topology;
    const r = merge(a, b);
    expectValid(r.topology);
    // Left L, overlap, right L: three regions.
    expect(r.topology.faces.size).toBe(3);
    expect(totalArea(r.topology)).toBeCloseTo(2e6 - 0.25e6, 3);
  });

  test('a square inside a face splits it; the inner region keeps the existing face', () => {
    const a = rect(emptyTopology(), 0, 0, 2000, 2000).topology;
    const outerId = [...a.faces.keys()][0]!;
    const b = rect(emptyTopology(), 500, 500, 500, 500).topology;
    const r = merge(a, b);
    expectValid(r.topology);
    expect(r.topology.faces.size).toBe(2);
    expect(r.faceIds).toHaveLength(1);
    expect(r.topology.faces.has(outerId)).toBe(true);
    expect(totalArea(r.topology)).toBeCloseTo(4e6, 3);
  });

  test('a face in a new plane crossing a target face splits that face along the line', () => {
    // A ground square, and a vertical square standing across its middle.
    const a = rect(emptyTopology(), 0, 0, 1000, 1000).topology;
    const wall = box(emptyTopology(), 0, 400, 1000, 200, 300);
    const r = merge(a, wall);
    expectValid(r.topology);
    // The ground square is split by the wall's bottom edges into three pieces; the wall's
    // bottom face coincides with the middle piece, which stays one face.
    const ground = [...r.topology.faces.values()].filter((f) => Math.abs(f.normal[1]) === 1 && r.topology.vertices.get(f.outer[0]!)!.p[1] === 0);
    expect(ground).toHaveLength(3);
    expect(r.topology.faces.size).toBe(3 + 5);
  });

  test('soft edges stay soft and curves come along as new curves', () => {
    const c = drawRegularPolygon(emptyTopology(), { kind: 'circle', faceId: null, center: [0, 0, 0], radius: 400, segments: 16 });
    if (!c.ok) throw new Error(c.error);
    const cyl = pushPull(c.topology, c.faceIds[0]!, 500).topology;
    const softBefore = [...cyl.edges.values()].filter((e) => e.soft).length;
    expect(softBefore).toBe(16);
    const target = rect(emptyTopology(), 2000, 0, 500, 500).topology;
    const r = merge(target, cyl).topology;
    expectValid(r);
    expect([...r.edges.values()].filter((e) => e.soft)).toHaveLength(16);
    expect(r.curves.size).toBe(cyl.curves.size);
    for (const cv of r.curves.values()) expect(cv.edges).toHaveLength(16);
  });

  test('a rotated copy merges next to the original', () => {
    const t = box(emptyTopology(), 0, 0, 1000, 500, 300);
    const turned = transformTopology(transformTopology(t, quarterY, quarterY), shift(2000, 0, 2000), same);
    const r = merge(t, turned).topology;
    expectValid(r);
    expect(r.faces.size).toBe(12);
    expect(totalArea(r)).toBeCloseTo(2 * totalArea(t), 3);
  });
});

describe('randomized extract and merge', () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i: random extract, move or turn, merge back', (seed) => {
    randomAssemblyRun(seed, 6);
  });
});
