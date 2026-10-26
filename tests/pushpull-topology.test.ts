import { describe, expect, test } from 'vitest';
import { Draft } from '../src/kernel/draft';
import { pushPull } from '../src/kernel/pushPull';
import { faceArea, facePoints } from '../src/kernel/query';
import { drawLoop, drawRectangle } from '../src/kernel/shapes';
import { emptyTopology, type CurveKind, type FaceId, type Point3, type Topology } from '../src/kernel/types';
import { validate } from '../src/kernel/validate';

/* All sizes in mm. */

function push(t: Topology, f: FaceId, dist: number) {
  const r = pushPull(t, f, dist);
  expect(validate(r.topology), `after pushing ${f} by ${dist}`).toEqual([]);
  return r;
}

function rect(t: Topology, faceId: string | null, corner: Point3, width: number, depth: number) {
  const r = drawRectangle(t, { faceId, corner, width, depth });
  if (!r.ok) throw new Error(r.error);
  expect(validate(r.topology)).toEqual([]);
  return { t: r.topology, id: r.faceIds[0]! };
}

/** 3000 x 2000 x 1000 box; returns the top face id. */
function box() {
  const g = rect(emptyTopology(), null, [0, 0, 0], 3000, 2000);
  return { t: push(g.t, g.id, 1000).topology, top: g.id };
}

const ys = (t: Topology, f: FaceId) => [...new Set(facePoints(t, f)!.outer.map((p) => +p[1].toFixed(6)))].sort((a, b) => a - b);
const xs = (t: Topology, f: FaceId) => facePoints(t, f)!.outer.map((p) => p[0]);
const byNormal = (t: Topology, n: Point3) => [...t.faces].filter(([, f]) => f.normal.every((v, i) => Math.abs(v - n[i]!) < 1e-9)).map(([id]) => id);

function centroid(t: Topology, f: FaceId): Point3 {
  const pts = facePoints(t, f)!.outer;
  const s = pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
  return [s[0] / pts.length, s[1] / pts.length, s[2] / pts.length];
}

function expectOutward(t: Topology, center: Point3) {
  for (const [id, f] of t.faces) {
    const c = centroid(t, id);
    const out = f.normal[0] * (c[0] - center[0]) + f.normal[1] * (c[1] - center[1]) + f.normal[2] * (c[2] - center[2]);
    expect(out, `face ${id}`).toBeGreaterThan(0);
  }
}

function ngon(sides: number, radius: number, kind: CurveKind, t: Topology = emptyTopology(), y = 0) {
  // Centered on the origin, in the horizontal plane at height y.
  const pts: Point3[] = Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [radius * Math.cos(a), y, radius * Math.sin(a)];
  });
  const r = drawLoop(t, { n: [0, 1, 0], d: y }, [0, 1, 0], pts, { kind, segments: sides, center: [0, y, 0], normal: [0, 1, 0], radius });
  expect(validate(r.topology)).toEqual([]);
  return { t: r.topology, id: r.faceIds[0]! };
}

describe('extruding a lone face', () => {
  test('makes a closed box of six faces, keeps the bottom, reports the new faces', () => {
    const g = rect(emptyTopology(), null, [0, 0, 0], 3000, 2000);
    const r = push(g.t, g.id, 1000);
    expect(r.distance).toBe(1000);
    expect(r.topology.faces.size).toBe(6);
    expect(r.topology.vertices.size).toBe(8);
    expect(r.topology.edges.size).toBe(12);
    expect(r.createdFaceIds).toHaveLength(5);
    expect(ys(r.topology, g.id)).toEqual([1000]);
    expect(byNormal(r.topology, [0, -1, 0])).toHaveLength(1);
    expectOutward(r.topology, [1500, 500, 1000]);
  });

  test('pulling downward keeps the original face facing up at the ground', () => {
    const g = rect(emptyTopology(), null, [0, 0, 0], 3000, 2000);
    const r = push(g.t, g.id, -500);
    expect(r.topology.faces.size).toBe(6);
    expectOutward(r.topology, [1500, -250, 1000]);
  });

  test('a slanted triangle becomes a prism', () => {
    const d = new Draft(emptyTopology());
    const pts: Point3[] = [
      [0, 0, 0],
      [1000, 500, 0],
      [200, 300, 900],
    ];
    const vs = pts.map((p) => d.addVertex(p));
    vs.forEach((v, i) => d.addEdge(v, vs[(i + 1) % 3]!));
    const n = (() => {
      const u = [1000, 500, 0];
      const w = [200, 300, 900];
      const c = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
      const l = Math.hypot(c[0]!, c[1]!, c[2]!);
      return c.map((x) => x / l) as unknown as Point3;
    })();
    const f = d.addFace(n, vs);
    const r = push(d.commit(), f, 400);
    expect(r.topology.faces.size).toBe(5);
    expect(r.createdFaceIds).toHaveLength(4);
  });
});

describe('re-pushing and clamping', () => {
  test('re-pushing the top stretches the walls without adding faces', () => {
    const { t, top } = box();
    const r = push(t, top, 500);
    expect(r.topology.faces.size).toBe(6);
    expect(r.topology.edges.size).toBe(12);
    expect(r.createdFaceIds).toEqual([]);
    expect(ys(r.topology, top)).toEqual([1500]);
  });

  test('pushing the top through the bottom stops 1 mm short', () => {
    const { t, top } = box();
    const r = push(t, top, -5000);
    expect(r.distance).toBeCloseTo(-999, 9);
    expect(r.topology.faces.size).toBe(6);
  });

  test('pushing a side wall stretches its neighbours', () => {
    const { t, top } = box();
    const wall = byNormal(t, [1, 0, 0])[0]!;
    const r = push(t, wall, 500);
    expect(r.topology.faces.size).toBe(6);
    expect(Math.max(...xs(r.topology, top))).toBe(3500);
    expect(faceArea(r.topology, top)).toBeCloseTo(3500 * 2000, 6);
  });

  test('pushing a side wall inward is clamped by the opposite wall', () => {
    const { t } = box();
    const wall = byNormal(t, [1, 0, 0])[0]!;
    expect(push(t, wall, -4000).distance).toBeCloseTo(-2999, 9);
  });

  test('a zero or fully clamped push returns the same topology', () => {
    const { t, top } = box();
    expect(pushPull(t, top, 0).topology).toBe(t);
    const flat = push(t, top, -999).topology;
    expect(pushPull(flat, top, -10).topology).toBe(flat);
  });
});

describe('pockets and inner faces', () => {
  function inset() {
    const { t, top } = box();
    const r = rect(t, top, [1000, 1000, 500], 1000, 1000);
    return { t: r.t, top, inner: r.id };
  }

  test('pushing an inset face down makes a pocket with walls facing into it', () => {
    const { t, inner } = inset();
    const r = push(t, inner, -300);
    expect(r.topology.faces.size).toBe(11);
    expect(ys(r.topology, inner)).toEqual([700]);
    const walls = r.createdFaceIds;
    expect(walls).toHaveLength(4);
    for (const w of walls) {
      const c = centroid(r.topology, w);
      const f = r.topology.faces.get(w)!;
      expect(f.normal[0] * (1500 - c[0]) + f.normal[2] * (1000 - c[2])).toBeGreaterThan(0);
    }
  });

  test('re-pushing the pocket deepens it; its floor cannot rise above the top', () => {
    const { t, inner } = inset();
    const once = push(t, inner, -300).topology;
    const twice = push(once, inner, -200);
    expect(twice.topology.faces.size).toBe(11);
    expect(ys(twice.topology, inner)).toEqual([500]);
    expect(push(once, inner, 1000).distance).toBeCloseTo(299, 9);
  });

  test('pushing the outer face leaves the inner face in place, with walls around the hole', () => {
    const { t, top, inner } = inset();
    const r = push(t, top, 200);
    expect(ys(r.topology, top)).toEqual([1200]);
    expect(ys(r.topology, inner)).toEqual([1000]);
    expect(r.topology.faces.size).toBe(11);
    expect(r.createdFaceIds).toHaveLength(4);
  });

  test('a pocket can no longer pass through the bottom', () => {
    const { t, inner } = inset();
    const once = push(t, inner, -300).topology;
    const r = push(once, inner, -5000);
    expect(r.distance).toBeCloseTo(-700, 9);
  });

  test('pushing a pocket floor onto the bottom cuts a through-hole', () => {
    const { t, inner } = inset();
    const once = push(t, inner, -300).topology;
    const bottom = byNormal(once, [0, -1, 0])[0]!;
    const r = push(once, inner, -700);
    expect(r.topology.faces.has(inner)).toBe(false);
    expect(r.removedFaceIds).toContain(inner);
    // Top ring, bottom ring, four outer walls, four hole walls.
    expect(r.topology.faces.size).toBe(10);
    const rings = [...r.topology.faces.values()].filter((f) => f.holes.length === 1);
    expect(rings).toHaveLength(2);
    expect(faceArea(r.topology, r.topology.faces.has(bottom) ? bottom : r.createdFaceIds[0]!)).toBeCloseTo(6e6 - 1e6, 4);
  });

  test('a pocket reaching the edge, pushed on to the bottom, cuts through as a slot', () => {
    const { t, top } = box();
    const r0 = rect(t, top, [0, 1000, 500], 1000, 1000);
    const once = push(r0.t, r0.id, -300).topology;
    const r = push(once, r0.id, -5000);
    expect(r.distance).toBeCloseTo(-700, 9);
    expect(r.topology.faces.has(r0.id)).toBe(false);
  });

  test('a box top pushed onto its own bottom still stops 1 mm short', () => {
    const { t, top } = box();
    expect(push(t, top, -5000).distance).toBeCloseTo(-999, 9);
  });
});

describe('circles and polygons', () => {
  test('a pushed circle becomes a cylinder with soft side edges and a curve on top', () => {
    const c = ngon(24, 500, 'circle');
    const r = push(c.t, c.id, 1000);
    expect(r.topology.faces.size).toBe(26);
    const soft = [...r.topology.edges.values()].filter((e) => e.soft);
    expect(soft).toHaveLength(24);
    expect(r.topology.curves.size).toBe(2);
    for (const curve of r.topology.curves.values()) expect(curve.segments).toBe(24);
    expectOutward(r.topology, [0, 500, 0]);
  });

  test('re-pushing the cylinder top adds nothing', () => {
    const c = ngon(24, 500, 'circle');
    const once = push(c.t, c.id, 1000).topology;
    const r = push(once, c.id, 250);
    expect(r.topology.faces.size).toBe(26);
    expect(r.createdFaceIds).toEqual([]);
    expect(ys(r.topology, c.id)).toEqual([1250]);
  });

  test('a pushed polygon becomes a prism with hard side edges', () => {
    const p = ngon(6, 500, 'polygon');
    const r = push(p.t, p.id, 800);
    expect(r.topology.faces.size).toBe(8);
    expect([...r.topology.edges.values()].filter((e) => e.soft)).toHaveLength(0);
    expectOutward(r.topology, [0, 400, 0]);
  });

  test('a circle pushed down into a box top makes a round pocket', () => {
    const { t, top } = box();
    const inside = drawLoop(
      t,
      { n: [0, 1, 0], d: 1000 },
      [0, 1, 0],
      Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        return [1500 + 400 * Math.cos(a), 1000, 1000 + 400 * Math.sin(a)] as Point3;
      }),
      { kind: 'circle', segments: 24, center: [1500, 1000, 1000], normal: [0, 1, 0], radius: 400 },
    );
    expect(validate(inside.topology)).toEqual([]);
    const disc = inside.faceIds[0]!;
    const r = push(inside.topology, disc, -400);
    expect(r.topology.faces.size).toBe(6 + 1 + 24);
    expect(ys(r.topology, disc)).toEqual([600]);
    expect(r.topology.faces.get(top)!.holes).toHaveLength(1);
  });
});

describe('the ground plane', () => {
  test('pushing one of two adjacent ground faces leaves the other in place, without a bottom', () => {
    let t = rect(emptyTopology(), null, [0, 0, 0], 2000, 2000).t;
    const b = rect(t, null, [2000, 0, 0], 2000, 2000);
    t = b.t;
    const r = push(t, b.id, 1000);
    // Left face, top, four walls (the shared edge gets a wall too).
    expect(r.topology.faces.size).toBe(6);
    expect(byNormal(r.topology, [0, -1, 0])).toHaveLength(0);
  });
});
