import { describe, expect, test } from 'vitest';
import { drawLine } from '../src/kernel/lines';
import { offset, offsetDistance, offsetPath } from '../src/kernel/offset';
import { faceArea } from '../src/kernel/query';
import { drawRectangle, drawRegularPolygon } from '../src/kernel/shapes';
import { emptyTopology, type Topology } from '../src/kernel/types';
import { validate } from '../src/kernel/validate';
import { rng } from './helpers/randomRun';

/* All sizes in mm. */

function rect(t: Topology, x: number, z: number, w: number, d: number, faceId: string | null = null) {
  const r = drawRectangle(t, { faceId, corner: [x, 0, z], width: w, depth: d });
  if (!r.ok) throw new Error(r.error);
  return r;
}

function done(r: ReturnType<typeof offset>) {
  if (!r.ok) throw new Error(r.error);
  expect(validate(r.topology)).toEqual([]);
  return r;
}

const areas = (t: Topology) => [...t.faces.keys()].map((f) => Math.round(faceArea(t, f))).sort((a, b) => a - b);

describe('offsetting a face', () => {
  test('a rectangle inward: sharp corners, the face split into an inner face and a ring', () => {
    const r0 = rect(emptyTopology(), 0, 0, 600, 400);
    const r = done(offset(r0.topology, r0.faceIds[0]!, [], 50));
    expect(r.edgeIds).toHaveLength(4);
    // Inner 500 x 300; ring 600 x 400 minus that.
    expect(areas(r.topology)).toEqual([150000, 240000 - 150000].sort((a, b) => a - b));
    const xs = r.edgeIds.flatMap((e) => r.topology.edges.get(e)!.v.map((v) => r.topology.vertices.get(v)!.p));
    for (const p of xs) expect([50, 550]).toContain(p[0]);
  });

  test('a rectangle outward closes a ring around it', () => {
    const r0 = rect(emptyTopology(), 0, 0, 600, 400);
    const r = done(offset(r0.topology, r0.faceIds[0]!, [], -100));
    expect(areas(r.topology)).toEqual([240000, 800 * 600 - 240000].sort((a, b) => a - b));
  });

  test('a distance too large for the face is refused', () => {
    const r0 = rect(emptyTopology(), 0, 0, 600, 400);
    expect(offset(r0.topology, r0.faceIds[0]!, [], 200)).toEqual({ ok: false, error: 'offsetTooLarge' });
    expect(offset(r0.topology, r0.faceIds[0]!, [], 250)).toEqual({ ok: false, error: 'offsetTooLarge' });
    expect(offset(r0.topology, r0.faceIds[0]!, [], 199).ok).toBe(true);
  });

  test('a circle offsets as a new circle with the same segment count around the same center', () => {
    const c = drawRegularPolygon(emptyTopology(), { kind: 'circle', faceId: null, center: [0, 0, 0], radius: 500, segments: 24 });
    if (!c.ok) throw new Error(c.error);
    const r = done(offset(c.topology, c.faceIds[0]!, [], 100));
    expect(r.topology.curves.size).toBe(2);
    const fresh = [...r.topology.curves.values()].find((x) => x.radius < 500)!;
    expect(fresh.kind).toBe('circle');
    expect(fresh.segments).toBe(24);
    expect(fresh.edges).toHaveLength(24);
    expect(fresh.center).toEqual([0, 0, 0]);
    // Edges move in by 100: the corners by 100 / cos(pi / 24).
    expect(fresh.radius).toBeCloseTo(500 - 100 / Math.cos(Math.PI / 24), 4);
  });

  test('a hexagon stays a polygon curve with six sides', () => {
    const c = drawRegularPolygon(emptyTopology(), { kind: 'polygon', faceId: null, center: [0, 0, 0], radius: 500, segments: 6 });
    if (!c.ok) throw new Error(c.error);
    const r = done(offset(c.topology, c.faceIds[0]!, [], -50));
    const fresh = [...r.topology.curves.values()].find((x) => x.radius > 500)!;
    expect([fresh.kind, fresh.segments, fresh.edges.length]).toEqual(['polygon', 6, 6]);
  });

  test('a face with a hole: inward until the new loop would cross the hole', () => {
    const outer = rect(emptyTopology(), 0, 0, 1000, 1000);
    const inner = rect(outer.topology, 400, 400, 200, 200, outer.faceIds[0]!);
    const t = inner.topology;
    const ring = [...t.faces].find(([, f]) => f.holes.length)![0];
    const r = done(offset(t, ring, [], 100));
    expect(r.topology.faces.size).toBe(3);
    // At 350 the hole lies inside the new loop (fine); at 450 the new loop would sit inside the hole.
    done(offset(t, ring, [], 350));
    expect(offset(t, ring, [], 450)).toEqual({ ok: false, error: 'offsetTooLarge' });
    // Outward is never limited by the hole.
    done(offset(t, ring, [], -200));
  });
});

describe('offsetting a face with a hole near its edge', () => {
  test('the new loop would run across the hole: refused', () => {
    const outer = rect(emptyTopology(), 0, 0, 1000, 1000);
    const inner = rect(outer.topology, 100, 400, 200, 200, outer.faceIds[0]!);
    const ring = [...inner.topology.faces].find(([, f]) => f.holes.length)![0];
    expect(offset(inner.topology, ring, [], 200)).toEqual({ ok: false, error: 'offsetTooLarge' });
    done(offset(inner.topology, ring, [], 50));
  });
});

describe('offsetting edges', () => {
  test('an open chain of two edges offsets to its left with a sharp corner', () => {
    let t = drawLine(emptyTopology(), [0, 0, 0], [1000, 0, 0]).topology;
    t = drawLine(t, [1000, 0, 0], [1000, 0, 500]).topology;
    const edges = [...t.edges.keys()];
    const path = offsetPath(t, null, edges);
    expect(path.ok && path.path.closed).toBe(false);
    const r = done(offset(t, null, edges, 100));
    expect(r.edgeIds).toHaveLength(2);
    const pts = r.edgeIds.flatMap((e) => r.topology.edges.get(e)!.v.map((v) => r.topology.vertices.get(v)!.p));
    // Which side is left depends on the chain's direction; either way the corner is at 100 from both edges.
    const corner = pts.find((p) => Math.abs(Math.abs(p[0] - 1000) - 100) < 1e-6 && Math.abs(Math.abs(p[2]) - 100) < 1e-6);
    expect(corner).toBeDefined();
  });

  test('edges that branch are not a chain', () => {
    let t = drawLine(emptyTopology(), [0, 0, 0], [1000, 0, 0]).topology;
    t = drawLine(t, [500, 0, 0], [500, 0, 500]).topology;
    expect(offset(t, null, [...t.edges.keys()], 100)).toEqual({ ok: false, error: 'offsetNotChain' });
  });
});

describe('offset distance under the pointer', () => {
  test('positive inside a loop, negative outside, measured to the nearest edge', () => {
    const r0 = rect(emptyTopology(), 0, 0, 600, 400);
    const p = offsetPath(r0.topology, r0.faceIds[0]!, []);
    if (!p.ok) throw new Error(p.error);
    expect(offsetDistance(p.path, [300, 0, 50])).toBeCloseTo(50, 9);
    expect(offsetDistance(p.path, [300, 0, -80])).toBeCloseTo(-80, 9);
    expect(offsetDistance(p.path, [580, 5, 200])).toBeCloseTo(20, 9);
  });
});

describe('randomized offsets', () => {
  test.each([1, 2, 3, 4, 5, 6])('seed %i: offsets of random rectangles are refused or valid', (seed) => {
    const r = rng(seed);
    let t = emptyTopology();
    for (let i = 0; i < 4; i++) {
      const q = drawRectangle(t, { faceId: null, corner: [Math.floor(r() * 20) * 50, 0, Math.floor(r() * 20) * 50], width: 100 + Math.floor(r() * 10) * 50, depth: 100 + Math.floor(r() * 10) * 50 });
      if (q.ok) t = q.topology;
    }
    for (let step = 0; step < 8; step++) {
      const faces = [...t.faces.keys()];
      const f = faces[Math.floor(r() * faces.length)]!;
      const o = offset(t, f, [], (r() < 0.5 ? 1 : -1) * (10 + Math.floor(r() * 8) * 25));
      if (!o.ok) continue;
      expect(validate(o.topology), `seed ${seed}, step ${step}`).toEqual([]);
      t = o.topology;
    }
  });
});
