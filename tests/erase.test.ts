import { describe, expect, test } from 'vitest';
import { Draft } from '../src/kernel/draft';
import { erase } from '../src/kernel/erase';
import { faceArea } from '../src/kernel/query';
import { drawLoop, drawRectangle, GROUND } from '../src/kernel/shapes';
import { emptyTopology, type Point3, type Topology } from '../src/kernel/types';
import { validate } from '../src/kernel/validate';

/* All sizes in mm. Rectangles are on the ground, given as [x0, z0, x1, z1]. */

type Rect = [number, number, number, number];

function drawAll(rects: Rect[], t: Topology = emptyTopology()) {
  for (const [x0, z0, x1, z1] of rects) {
    const r = drawRectangle(t, { faceId: null, corner: [x0, 0, z0], width: x1 - x0, depth: z1 - z0 });
    if (!r.ok) throw new Error(r.error);
    t = r.topology;
  }
  return t;
}

const same = (a: Point3, b: Point3) => a.every((v, i) => Math.abs(v - b[i]!) < 1e-6);

/** The edge between two ground points (x, z). */
function edgeAt(t: Topology, a: [number, number], b: [number, number]): string {
  for (const [id, e] of t.edges) {
    const [p, q] = e.v.map((v) => t.vertices.get(v)!.p);
    const A: Point3 = [a[0], 0, a[1]];
    const B: Point3 = [b[0], 0, b[1]];
    if ((same(p!, A) && same(q!, B)) || (same(p!, B) && same(q!, A))) return id;
  }
  throw new Error(`no edge ${a} - ${b}`);
}

function eraseOk(t: Topology, faces: string[], edges: string[]) {
  const r = erase(t, faces, edges);
  expect(validate(r.topology)).toEqual([]);
  return r;
}

describe('erasing an edge between two coplanar faces merges them', () => {
  test('two rectangles side by side become one rectangle again', () => {
    const t = drawAll([
      [0, 0, 2000, 2000],
      [2000, 0, 3000, 2000],
    ]);
    const big = [...t.faces.keys()].find((id) => Math.round(faceArea(t, id)) === 4e6)!;
    const r = eraseOk(t, [], [edgeAt(t, [2000, 0], [2000, 2000])]);
    expect(r.topology.faces.size).toBe(1);
    expect(r.topology.faces.has(big)).toBe(true);
    expect(faceArea(r.topology, big)).toBeCloseTo(6e6, 6);
    // The corners left on the straight sides are healed away.
    expect(r.topology.vertices.size).toBe(4);
    expect(r.topology.edges.size).toBe(4);
    expect(r.removedFaceIds).toHaveLength(1);
  });

  test('erasing an edge inside an overlap merges just those two pieces', () => {
    const t = drawAll([
      [0, 0, 2000, 2000],
      [1000, 1000, 3000, 3000],
    ]);
    const r = eraseOk(t, [], [edgeAt(t, [1000, 1000], [1000, 2000])]);
    expect(r.topology.faces.size).toBe(2);
    expect([...r.topology.faces.keys()].map((id) => Math.round(faceArea(r.topology, id))).sort()).toEqual([3e6, 4e6]);
  });

  test('erasing one side of an inset rectangle leaves its other sides on the merged face', () => {
    const t = drawAll([
      [0, 0, 3000, 3000],
      [1000, 1000, 2000, 2000],
    ]);
    const r = eraseOk(t, [], [edgeAt(t, [1000, 1000], [2000, 1000])]);
    expect(r.topology.faces.size).toBe(1);
    const [f] = [...r.topology.faces.values()];
    expect(f!.holes).toHaveLength(0);
    expect(r.topology.edges.size).toBe(4 + 3);
  });

  test('erasing all sides of an inset rectangle restores the plain face', () => {
    let t = drawAll([
      [0, 0, 3000, 3000],
      [1000, 1000, 2000, 2000],
    ]);
    const sides = [
      edgeAt(t, [1000, 1000], [2000, 1000]),
      edgeAt(t, [2000, 1000], [2000, 2000]),
      edgeAt(t, [2000, 2000], [1000, 2000]),
      edgeAt(t, [1000, 2000], [1000, 1000]),
    ];
    t = eraseOk(t, [], sides).topology;
    expect(t.faces.size).toBe(1);
    expect(t.vertices.size).toBe(4);
    expect(t.edges.size).toBe(4);
    expect(faceArea(t, [...t.faces.keys()][0]!)).toBeCloseTo(9e6, 6);
  });
});

describe('erasing an edge that bounds faces removes them', () => {
  test('an outer edge of a lone rectangle removes the face and keeps the other edges', () => {
    const t = drawAll([[0, 0, 2000, 2000]]);
    const r = eraseOk(t, [], [edgeAt(t, [0, 0], [2000, 0])]);
    expect(r.topology.faces.size).toBe(0);
    expect(r.topology.edges.size).toBe(3);
  });

  test('an edge between two faces in different planes removes both', () => {
    const d = new Draft(emptyTopology());
    const p = (x: number, y: number, z: number) => d.findVertex([x, y, z]) ?? d.addVertex([x, y, z]);
    const ground = [p(0, 0, 0), p(1000, 0, 0), p(1000, 0, 1000), p(0, 0, 1000)];
    const wall = [p(0, 0, 0), p(1000, 0, 0), p(1000, 1000, 0), p(0, 1000, 0)];
    for (const loop of [ground, wall]) loop.forEach((v, i) => d.addEdge(v, loop[(i + 1) % 4]!));
    d.addFace([0, 1, 0], ground);
    d.addFace([0, 0, -1], wall);
    const t = d.commit();
    const shared = d.edgeBetween(ground[0]!, ground[1]!)!;
    const r = eraseOk(t, [], [shared]);
    expect(r.topology.faces.size).toBe(0);
    expect(r.removedFaceIds).toHaveLength(2);
  });

  test('a loose edge is removed with its unused vertices', () => {
    const d = new Draft(emptyTopology());
    const e = d.addEdge(d.addVertex([0, 0, 0]), d.addVertex([1000, 0, 0]));
    const r = eraseOk(d.commit(), [], [e]);
    expect(r.topology.edges.size).toBe(0);
    expect(r.topology.vertices.size).toBe(0);
  });
});

describe('erasing faces and curves', () => {
  test('erasing a face keeps its edges', () => {
    const t = drawAll([[0, 0, 2000, 2000]]);
    const r = eraseOk(t, [[...t.faces.keys()][0]!], []);
    expect(r.topology.faces.size).toBe(0);
    expect(r.topology.edges.size).toBe(4);
  });

  test('erasing one edge of a curve erases the whole curve', () => {
    const pts: Point3[] = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      return [1000 * Math.cos(a), 0, 1000 * Math.sin(a)];
    });
    const drawn = drawLoop(emptyTopology(), GROUND, [0, 1, 0], pts, {
      kind: 'polygon',
      segments: 8,
      center: [0, 0, 0],
      normal: [0, 1, 0],
      radius: 1000,
    });
    expect(drawn.topology.curves.size).toBe(1);
    const r = eraseOk(drawn.topology, [], [drawn.edgeIds[3]!]);
    expect(r.topology.edges.size).toBe(0);
    expect(r.topology.faces.size).toBe(0);
    expect(r.topology.curves.size).toBe(0);
  });

  test('erasing a curve drawn on a face merges the inside back into the face', () => {
    const t = drawAll([[-2000, -2000, 2000, 2000]]);
    const face = [...t.faces.keys()][0]!;
    const pts: Point3[] = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return [1000 * Math.cos(a), 0, 1000 * Math.sin(a)];
    });
    const drawn = drawLoop(t, GROUND, [0, 1, 0], pts, { kind: 'circle', segments: 12, center: [0, 0, 0], normal: [0, 1, 0], radius: 1000 });
    expect(drawn.topology.faces.size).toBe(2);
    const r = eraseOk(drawn.topology, [], [drawn.edgeIds[0]!]);
    expect(r.topology.faces.size).toBe(1);
    expect(r.topology.faces.has(face)).toBe(true);
    expect(faceArea(r.topology, face)).toBeCloseTo(16e6, 4);
  });

  test('nothing to erase returns the same topology', () => {
    const t = drawAll([[0, 0, 2000, 2000]]);
    expect(erase(t, ['nope'], []).topology).toBe(t);
  });
});
