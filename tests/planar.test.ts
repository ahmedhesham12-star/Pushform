import { describe, expect, test } from 'vitest';
import { faceArea } from '../src/kernel/topo/query';
import { drawRectangle } from '../src/kernel/topo/shapes';
import { emptyTopology, type Topology } from '../src/kernel/topo/types';
import { validate } from '../src/kernel/topo/validate';

/* All sizes in mm. Rectangles are on the ground, given as [x0, z0, x1, z1]. */

type Rect = [number, number, number, number];

function draw(t: Topology, [x0, z0, x1, z1]: Rect) {
  const r = drawRectangle(t, { faceId: null, corner: [x0, 0, z0], width: x1 - x0, depth: z1 - z0 });
  if (!r.ok) throw new Error(r.error);
  const problems = validate(r.topology);
  expect(problems, `after drawing ${[x0, z0, x1, z1]}`).toEqual([]);
  return r;
}

function drawAll(rects: Rect[]) {
  let t = emptyTopology();
  for (const r of rects) t = draw(t, r).topology;
  return t;
}

const areas = (t: Topology) => [...t.faces.keys()].map((id) => Math.round(faceArea(t, id))).sort((a, b) => a - b);
const totalArea = (t: Topology) => [...t.faces.keys()].reduce((s, id) => s + faceArea(t, id), 0);

/** Cells of the grid formed by all rectangle coordinates, with whether a rectangle covers each. */
function cells(rects: Rect[]) {
  const xs = [...new Set(rects.flatMap((r) => [r[0], r[2]]))].sort((a, b) => a - b);
  const zs = [...new Set(rects.flatMap((r) => [r[1], r[3]]))].sort((a, b) => a - b);
  const out: { x: number; z: number; area: number; covered: boolean }[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < zs.length; j++) {
      const x = (xs[i]! + xs[i + 1]!) / 2;
      const z = (zs[j]! + zs[j + 1]!) / 2;
      const covered = rects.some((r) => x > r[0] && x < r[2] && z > r[1] && z < r[3]);
      out.push({ x, z, area: (xs[i + 1]! - xs[i]!) * (zs[j + 1]! - zs[j]!), covered });
    }
  }
  return out;
}

const unionArea = (rects: Rect[]) => cells(rects).reduce((s, c) => s + (c.covered ? c.area : 0), 0);

/** How many ground faces contain the point (x, z). */
function facesAt(t: Topology, x: number, z: number): number {
  const inside = (loop: readonly string[]) => {
    let hit = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = t.vertices.get(loop[i]!)!.p;
      const b = t.vertices.get(loop[j]!)!.p;
      if (a[2] > z !== b[2] > z && x < ((b[0] - a[0]) * (z - a[2])) / (b[2] - a[2]) + a[0]) hit = !hit;
    }
    return hit;
  };
  return [...t.faces.values()].filter((f) => inside(f.outer) && !f.holes.some(inside)).length;
}

/**
 * Every point inside a drawn rectangle is in exactly one face, and no point is
 * in two. Regions that drawn edges enclosed may also be faces (automatic faces).
 */
function expectCoverage(t: Topology, rects: Rect[]) {
  for (const c of cells(rects)) {
    const n = facesAt(t, c.x, c.z);
    if (c.covered) expect(n, `cell at ${c.x}, ${c.z}`).toBe(1);
    else expect(n, `cell at ${c.x}, ${c.z}`).toBeLessThanOrEqual(1);
  }
  // Coordinates are rounded to 1e-6 mm, so allow a tiny relative difference.
  expect(totalArea(t)).toBeGreaterThanOrEqual(unionArea(rects) * (1 - 1e-9));
}

const A: Rect = [0, 0, 2000, 2000];

describe('overlapping rectangles', () => {
  test('partly overlapping (across one side): three faces', () => {
    const t = drawAll([A, [1000, 500, 3000, 1500]]);
    expect(t.faces.size).toBe(3);
    expect(areas(t)).toEqual([1e6, 1e6, 3e6]);
  });

  test('corner overlapping: three faces', () => {
    const t = drawAll([A, [1000, 1000, 3000, 3000]]);
    expect(t.faces.size).toBe(3);
    expect(areas(t)).toEqual([1e6, 3e6, 3e6]);
  });

  test('one crossing the other fully: five faces', () => {
    const t = drawAll([
      [0, 500, 3000, 1500],
      [1000, 0, 2000, 2000],
    ]);
    expect(t.faces.size).toBe(5);
    expect(areas(t)).toEqual([5e5, 5e5, 1e6, 1e6, 1e6]);
  });

  test('sharing a whole edge: two faces on one shared edge', () => {
    const t = drawAll([A, [2000, 0, 4000, 2000]]);
    expect(t.faces.size).toBe(2);
    expect(t.vertices.size).toBe(6);
    expect(t.edges.size).toBe(7);
  });

  test('sharing part of an edge: the longer edge is split', () => {
    const t = drawAll([A, [2000, 500, 3000, 1500]]);
    expect(t.faces.size).toBe(2);
    expect(t.vertices.size).toBe(8);
    expect(t.edges.size).toBe(9);
    const big = [...t.faces.values()].find((f) => f.outer.length === 6);
    expect(big, 'the first rectangle now has 6 corners').toBeDefined();
  });

  test('touching at a corner: two faces sharing one vertex', () => {
    const t = drawAll([A, [2000, 2000, 3000, 3000]]);
    expect(t.faces.size).toBe(2);
    expect(t.vertices.size).toBe(7);
    expect(t.edges.size).toBe(8);
  });

  test('drawn inside: the outer face gets a hole and keeps its id', () => {
    const first = draw(emptyTopology(), A);
    const id = first.faceIds[0]!;
    const r = draw(first.topology, [500, 500, 1000, 1000]);
    expect(r.topology.faces.size).toBe(2);
    expect(r.topology.faces.get(id)!.holes).toHaveLength(1);
    expect(r.faceIds).toHaveLength(1);
    expect(faceArea(r.topology, id)).toBeCloseTo(4e6 - 25e4, 6);
  });

  test('drawn inside, touching the edge from inside: a notch, not a hole', () => {
    const t = drawAll([A, [0, 500, 1000, 1500]]);
    expect(t.faces.size).toBe(2);
    expect(areas(t)).toEqual([1e6, 3e6]);
    for (const f of t.faces.values()) expect(f.holes).toHaveLength(0);
  });

  test('drawn inside, touching the edge at one corner: a hole that touches the outer loop', () => {
    const t = drawAll([A, [0, 500, 1000, 1500].map((v, i) => (i === 0 ? 500 : v)) as Rect, [1000, 1500, 2000, 2000]]);
    expect(validate(t)).toEqual([]);
    expect(totalArea(t)).toBeCloseTo(4e6, 4);
  });

  test('drawn around: the new face gets a hole and the old face stays', () => {
    const first = draw(emptyTopology(), [500, 500, 1000, 1000]);
    const r = draw(first.topology, A);
    expect(r.topology.faces.size).toBe(2);
    expect(r.topology.faces.has(first.faceIds[0]!)).toBe(true);
    expect(areas(r.topology)).toEqual([25e4, 4e6 - 25e4]);
  });

  test('drawing the same rectangle twice adds nothing', () => {
    const first = draw(emptyTopology(), A);
    const r = draw(first.topology, A);
    expect(r.topology.faces.size).toBe(1);
    expect(r.faceIds).toEqual([]);
    expect(r.topology.edges.size).toBe(4);
  });

  test('the largest piece of a split face keeps its id', () => {
    const first = draw(emptyTopology(), A);
    const r = draw(first.topology, [1500, 1500, 3000, 3000]);
    const id = first.faceIds[0]!;
    expect(faceArea(r.topology, id)).toBeCloseTo(4e6 - 25e4, 6);
    expect(r.faceIds).toHaveLength(2);
  });

  test('a region enclosed by the new rectangle and existing edges becomes a face', () => {
    // Three bars form a U around an empty area; a fourth bar closes it.
    const t = drawAll([
      [0, 0, 500, 2000],
      [500, 0, 2000, 500],
      [1500, 500, 2000, 2000],
      [500, 1500, 1500, 2000],
    ]);
    expect(t.faces.size).toBe(5);
    expect(facesAt(t, 1000, 1000)).toBe(1);
    expect(totalArea(t)).toBeCloseTo(4e6, 4);
  });

  test('a region bounded only by old edges stays empty', () => {
    const t = drawAll([
      [0, 0, 500, 2000],
      [500, 0, 2000, 500],
      [1500, 500, 2000, 2000],
      [500, 1500, 1500, 2000],
      [3000, 0, 3500, 500],
    ]);
    expect(t.faces.size).toBe(6);
  });

  test('all faces on the ground face up', () => {
    const t = drawAll([A, [1000, 1000, 3000, 3000], [-500, 1500, 500, 2500]]);
    for (const f of t.faces.values()) expect(f.normal).toEqual([0, 1, 0]);
  });

  test('drawn right to left and back to front gives the same result', () => {
    const t = drawAll([
      [2000, 2000, 0, 0],
      [3000, 3000, 1000, 1000],
    ]);
    expect(areas(t)).toEqual([1e6, 3e6, 3e6]);
  });
});

/** Small seeded generator so failures can be reproduced. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe('randomized overlapping rectangles', () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('grid-aligned, seed %i', (seed) => {
    const r = rng(seed);
    const pick = () => Math.floor(r() * 13) * 250;
    const rects: Rect[] = [];
    let t = emptyTopology();
    for (let i = 0; i < 18; i++) {
      const x0 = pick();
      const z0 = pick();
      const rect: Rect = [x0, z0, x0 + 250 + pick() / 2, z0 + 250 + pick() / 2];
      rects.push(rect);
      t = draw(t, rect).topology;
      expectCoverage(t, rects);
    }
  });

  test.each([11, 12, 13, 14, 15, 16])('arbitrary coordinates, seed %i', (seed) => {
    const r = rng(seed);
    const rects: Rect[] = [];
    let t = emptyTopology();
    for (let i = 0; i < 14; i++) {
      const x0 = r() * 3000;
      const z0 = r() * 3000;
      const rect: Rect = [x0, z0, x0 + 50 + r() * 1500, z0 + 50 + r() * 1500];
      rects.push(rect);
      t = draw(t, rect).topology;
    }
    expectCoverage(t, rects);
  });
});
