import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { Draft } from '../src/kernel/draft';
import { faceArea } from '../src/kernel/query';
import { deserializeTopology, serializeTopology } from '../src/kernel/serialize';
import { faceTriangles } from '../src/kernel/triangulate';
import { emptyTopology, type Point3, type Topology } from '../src/kernel/types';
import { validate } from '../src/kernel/validate';

/* All sizes in mm. */

/** Draft with vertices at the given points, edges around the loop, and a face. */
function polygon(d: Draft, pts: Point3[], normal: Point3 = [0, 1, 0]) {
  const vs = pts.map((p) => d.findVertex(p) ?? d.addVertex(p));
  vs.forEach((v, i) => d.addEdge(v, vs[(i + 1) % vs.length]!));
  return { vs, face: d.addFace(normal, vs) };
}

const square = (x: number, z: number, s: number): Point3[] => [
  [x, 0, z],
  [x + s, 0, z],
  [x + s, 0, z + s],
  [x, 0, z + s],
];

function expectValid(t: Topology) {
  expect(validate(t)).toEqual([]);
}

describe('building topology', () => {
  test('a square face shares its vertices and edges', () => {
    const d = new Draft(emptyTopology());
    const { face } = polygon(d, square(0, 0, 1000));
    const t = d.commit();
    expectValid(t);
    expect(t.vertices.size).toBe(4);
    expect(t.edges.size).toBe(4);
    expect(faceArea(t, face)).toBeCloseTo(1e6, 6);
  });

  test('loops are wound counter-clockwise around the normal whatever order they are given in', () => {
    const d = new Draft(emptyTopology());
    const { face } = polygon(d, square(0, 0, 1000).reverse());
    expectValid(d.commit());
    const down = new Draft(emptyTopology());
    polygon(down, square(0, 0, 1000), [0, -1, 0]);
    expectValid(down.commit());
    expect(face).toBeDefined();
  });

  test('two faces sharing an edge use the same edge entity', () => {
    const d = new Draft(emptyTopology());
    const a = polygon(d, square(0, 0, 1000));
    const b = polygon(d, square(1000, 0, 1000));
    const t = d.commit();
    expectValid(t);
    expect(t.vertices.size).toBe(6);
    expect(t.edges.size).toBe(7);
    const shared = d.edgeBetween(a.vs[1]!, a.vs[2]!)!;
    expect(d.facesOf(shared).sort()).toEqual([a.face, b.face].sort());
  });

  test('an edge may bound three faces', () => {
    const d = new Draft(emptyTopology());
    const p: Point3[] = [
      [0, 0, 0],
      [0, 1000, 0],
    ];
    polygon(d, [p[0]!, p[1]!, [1000, 1000, 0], [1000, 0, 0]], [0, 0, -1]);
    polygon(d, [p[0]!, p[1]!, [-1000, 1000, 0], [-1000, 0, 0]], [0, 0, 1]);
    polygon(d, [p[0]!, p[1]!, [0, 1000, 1000], [0, 0, 1000]], [1, 0, 0]);
    const t = d.commit();
    expectValid(t);
    expect(d.facesOf(d.edgeBetween(d.findVertex(p[0]!)!, d.findVertex(p[1]!)!)!)).toHaveLength(3);
  });

  test('a face with a hole triangulates to its area', () => {
    const d = new Draft(emptyTopology());
    const outer = square(0, 0, 3000).map((p) => d.addVertex(p));
    outer.forEach((v, i) => d.addEdge(v, outer[(i + 1) % 4]!));
    const hole = square(1000, 1000, 1000).map((p) => d.addVertex(p));
    hole.forEach((v, i) => d.addEdge(v, hole[(i + 1) % 4]!));
    const f = d.addFace([0, 1, 0], outer, [hole]);
    const t = d.commit();
    expectValid(t);
    const tris = faceTriangles(t, f);
    const area = tris.reduce((s, [a, b, c]) => {
      const ux = b[0] - a[0];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vz = c[2] - a[2];
      return s + Math.abs(ux * vz - uz * vx) / 2;
    }, 0);
    expect(area).toBeCloseTo(8e6, 6);
    expect(faceArea(t, f)).toBeCloseTo(8e6, 6);
    for (const [a, b, c] of tris) {
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      expect(ny, 'triangle faces along the normal').toBeGreaterThan(0);
    }
  });
});

describe('splitting and healing edges', () => {
  test('splitting an edge inserts the vertex into every face that uses it', () => {
    const d = new Draft(emptyTopology());
    const a = polygon(d, square(0, 0, 1000));
    const b = polygon(d, square(1000, 0, 1000));
    const shared = d.edgeBetween(a.vs[1]!, a.vs[2]!)!;
    const mid = d.addVertex([1000, 0, 500]);
    d.splitEdge(shared, mid);
    const t = d.commit();
    expectValid(t);
    expect(t.faces.get(a.face)!.outer).toHaveLength(5);
    expect(t.faces.get(b.face)!.outer).toHaveLength(5);
    expect(t.edges.has(shared)).toBe(false);
  });

  test('healing a straight vertex joins the edges again', () => {
    const d = new Draft(emptyTopology());
    const a = polygon(d, square(0, 0, 1000));
    const e = d.edgeBetween(a.vs[0]!, a.vs[1]!)!;
    const mid = d.addVertex([500, 0, 0]);
    d.splitEdge(e, mid);
    expect(d.healVertex(mid)).toBe(true);
    const t = d.commit();
    expectValid(t);
    expect(t.faces.get(a.face)!.outer).toHaveLength(4);
    expect(t.vertices.size).toBe(4);
  });

  test('a corner is never healed', () => {
    const d = new Draft(emptyTopology());
    const a = polygon(d, square(0, 0, 1000));
    expect(d.healVertex(a.vs[0]!)).toBe(false);
  });

  test('splitting a curve edge keeps both halves in the curve', () => {
    const d = new Draft(emptyTopology());
    const c = d.addCurve({ kind: 'polygon', segments: 4, center: [500, 0, 500], normal: [0, 1, 0], radius: 707 });
    const vs = square(0, 0, 1000).map((p) => d.addVertex(p));
    vs.forEach((v, i) => d.addEdge(v, vs[(i + 1) % 4]!, { curve: c }));
    d.addFace([0, 1, 0], vs);
    const e = d.edgeBetween(vs[0]!, vs[1]!)!;
    const [e1, e2] = d.splitEdge(e, d.addVertex([500, 0, 0]));
    const t = d.commit();
    expectValid(t);
    expect(t.curves.get(c)!.edges).toHaveLength(5);
    expect(t.curves.get(c)!.edges).toEqual(expect.arrayContaining([e1, e2]));
    expect(t.curves.get(c)!.segments).toBe(4);
  });
});

describe('the invariant checker catches', () => {
  const base = () => {
    const d = new Draft(emptyTopology());
    polygon(d, square(0, 0, 1000));
    return d;
  };

  test('coinciding vertices', () => {
    const d = base();
    d.addEdge(d.addVertex([0, 0, 0.0005]), d.addVertex([5000, 0, 5000]));
    expect(validate(d.commit()).join()).toMatch(/coincide/);
  });

  test('edges that cross in a face plane', () => {
    const d = base();
    d.addEdge(d.addVertex([500, 0, -500]), d.addVertex([500, 0, 1500]));
    expect(validate(d.commit()).join()).toMatch(/cross/);
  });

  test('a vertex inside an edge (an unsplit T junction)', () => {
    const d = base();
    d.addEdge(d.addVertex([500, 0, 0]), d.addVertex([500, 0, -1000]));
    expect(validate(d.commit()).join()).toMatch(/lies inside edge/);
  });

  test('overlapping coplanar faces', () => {
    const d = base();
    polygon(d, square(500, 500, 1000));
    expect(validate(d.commit()).join()).toMatch(/overlap|cross|inside edge/);
  });

  test('a non-planar face', () => {
    const d = new Draft(emptyTopology());
    polygon(d, [
      [0, 0, 0],
      [1000, 0, 0],
      [1000, 50, 1000],
      [0, 0, 1000],
    ]);
    expect(validate(d.commit()).join()).toMatch(/not planar/);
  });

  test('a face whose normal disagrees with its winding', () => {
    const d = base();
    const t = d.commit();
    const [id, f] = [...t.faces][0]!;
    const flipped = new Map(t.faces).set(id, { ...f, outer: [...f.outer].reverse() });
    expect(validate({ ...t, faces: flipped }).join()).toMatch(/counter-clockwise/);
  });

  test('orphan vertices and missing edges', () => {
    const d = base();
    d.addVertex([9000, 0, 9000]);
    const t = d.commit();
    const [id, f] = [...t.faces][0]!;
    const edges = new Map(t.edges);
    edges.delete([...edges.keys()][0]!);
    const problems = validate({ ...t, edges, faces: new Map(t.faces).set(id, f) }).join();
    expect(problems).toMatch(/has no edges/);
    expect(problems).toMatch(/without an edge/);
  });
});

describe('version 2 format', () => {
  test('round-trips vertices, edges with soft flags, faces and curves', () => {
    const d = new Draft(emptyTopology());
    const c = d.addCurve({ kind: 'circle', segments: 24, center: [0, 0, 0], normal: [0, 1, 0], radius: 500 });
    const { vs } = polygon(d, square(0, 0, 1000));
    d.setEdge(d.edgeBetween(vs[0]!, vs[1]!)!, { soft: true, curve: c });
    d.curves.set(c, { ...d.curves.get(c)!, edges: [d.edgeBetween(vs[0]!, vs[1]!)!] });
    const t = d.commit();
    const json = JSON.parse(JSON.stringify(serializeTopology(t)));
    expect(json.kind).toBe('topology');
    expect(json.version).toBe(2);
    const back = deserializeTopology(json)!;
    expect(back).not.toBeNull();
    expect(serializeTopology(back)).toEqual(serializeTopology(t));
    expect([...back.edges.values()].filter((e) => e.soft)).toHaveLength(1);
  });

  test.each([
    ['not an object', 5],
    ['wrong version', { kind: 'topology', version: 3, next: 1, vertices: {}, edges: {}, faces: {}, curves: {} }],
    ['edge to a missing vertex', { kind: 'topology', version: 2, next: 1, vertices: {}, edges: { e1: { v: ['v1', 'v2'] } }, faces: {}, curves: {} }],
    [
      'face step without an edge',
      {
        kind: 'topology',
        version: 2,
        next: 9,
        vertices: { v1: [0, 0, 0], v2: [1, 0, 0], v3: [1, 0, 1] },
        edges: { e1: { v: ['v1', 'v2'] } },
        faces: { f1: { normal: [0, 1, 0], outer: ['v1', 'v2', 'v3'], holes: [] } },
        curves: {},
      },
    ],
  ])('rejects %s', (_, bad) => {
    expect(deserializeTopology(bad)).toBeNull();
  });
});

describe('converting version 1 face-loop models', () => {
  /**
   * A real milestone 1 autosave: a box with a pocket in its top and an inset
   * face on a wall, in feet and inches. Written by the milestone 1 code.
   */
  const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/milestone1-autosave.json'), 'utf8'));
  const v1 = fixture.model as { next: number; faces: Record<string, { outer: Point3[]; holes: Point3[][]; normal: Point3; side: boolean }> };
  const v1Area = (f: { outer: Point3[]; holes: Point3[][] }) => {
    const a = (l: Point3[]) => {
      let x = 0;
      let y = 0;
      let z = 0;
      l.forEach((p, i) => {
        const q = l[(i + 1) % l.length]!;
        x += (p[1] - q[1]) * (p[2] + q[2]);
        y += (p[2] - q[2]) * (p[0] + q[0]);
        z += (p[0] - q[0]) * (p[1] + q[1]);
      });
      return Math.hypot(x, y, z) / 2;
    };
    return a(f.outer) - f.holes.reduce((s, h) => s + a(h), 0);
  };

  test('produces valid topology with the same face ids, normals and areas', () => {
    const t = deserializeTopology(v1)!;
    expect(t).not.toBeNull();
    expectValid(t);
    expect([...t.faces.keys()].sort()).toEqual(Object.keys(v1.faces).sort());
    for (const [id, f] of Object.entries(v1.faces)) {
      expect(t.faces.get(id)!.normal).toEqual(f.normal);
      expect(faceArea(t, id)).toBeCloseTo(v1Area(f), 6);
    }
  });

  test('shares corners and sides between faces', () => {
    // Box: 8 corners and 12 sides; pocket: 8 corners, 12 sides; wall inset: 4 corners, 4 sides.
    const t = deserializeTopology(v1)!;
    expect(t.faces.size).toBe(12);
    expect(t.vertices.size).toBe(8 + 8 + 4);
    expect(t.edges.size).toBe(12 + 12 + 4);
  });

  test('new ids never collide with converted face ids', () => {
    const json = v1;
    const t = deserializeTopology(json)!;
    expect(t.next).toBeGreaterThanOrEqual(json.next);
    const ids = [...t.vertices.keys(), ...t.edges.keys(), ...t.faces.keys()];
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('rejects malformed version 1 data', () => {
    expect(deserializeTopology({ kind: 'face-loop', version: 1, next: 1, faces: { f1: { outer: [[0, 0]], holes: [], normal: [0, 1, 0], side: false } } })).toBeNull();
  });
});
