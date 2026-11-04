import { describe, expect, test } from 'vitest';
import { convert, reportText, type Dump } from '../scripts/sketchup-import/convert';
import { checkModel, listEdges, listFaces, serialize } from '../src/kernel';
import { affineOf, applyPoint, determinant } from '../src/scene';

/* Dumps as dump.rb writes them: inches, Z up. */
type Vec = [number, number, number];
type Entities = Dump['root'];

const empty = (): Entities => ({ vertices: [], edges: [], curves: [], faces: [], instances: [], guides: [], dimensions: [], texts: [], other: {} });

/** Add faces (loops of points, outer first) and their edges, sharing vertices by position. */
function addFaces(e: Entities, faces: { loops: Vec[][]; normal: Vec; front?: number; back?: number; curve?: number }[]): void {
  const vid = (p: Vec) => {
    const i = e.vertices.findIndex((q) => q.every((c, k) => Math.abs(c - p[k]!) < 1e-9));
    if (i >= 0) return i;
    e.vertices.push(p);
    return e.vertices.length - 1;
  };
  for (const f of faces) {
    const loops = f.loops.map((l) => l.map(vid));
    for (const l of loops) {
      l.forEach((a, i) => {
        const b = l[(i + 1) % l.length]!;
        if (!e.edges.some((x) => (x.v[0] === a && x.v[1] === b) || (x.v[0] === b && x.v[1] === a))) {
          e.edges.push({ v: [a, b], soft: false, smooth: false, hidden: false, curve: null, layer: 'Layer0' });
        }
      });
    }
    e.faces.push({ outer: loops[0]!, holes: loops.slice(1), normal: f.normal, front: f.front ?? null, back: f.back ?? null, hidden: false, layer: 'Layer0' });
  }
}

/** A w x d x h box from the origin, faces pointing out. */
function box(w: number, d: number, h: number, front?: number): Entities {
  const e = empty();
  const p = (x: number, y: number, z: number): Vec => [x * w, y * d, z * h];
  addFaces(e, [
    { loops: [[p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)]], normal: [0, 0, -1] },
    { loops: [[p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)]], normal: [0, 0, 1], ...(front !== undefined ? { front } : {}) },
    { loops: [[p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)]], normal: [0, -1, 0] },
    { loops: [[p(1, 1, 0), p(0, 1, 0), p(0, 1, 1), p(1, 1, 1)]], normal: [0, 1, 0] },
    { loops: [[p(0, 1, 0), p(0, 0, 0), p(0, 0, 1), p(0, 1, 1)]], normal: [-1, 0, 0] },
    { loops: [[p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)]], normal: [1, 0, 0] },
  ]);
  return e;
}

/** A column-major 4x4 with SketchUp axes. */
const matrix = (x: Vec, y: Vec, z: Vec, t: Vec, w = 1) => [...x, 0, ...y, 0, ...z, 0, ...t, w];
const IDENTITY = matrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]);

function dump(root: Entities, extra: Partial<Dump> = {}): Dump {
  return {
    format: 'pushform-sketchup-dump',
    version: 1,
    sketchup: '24.0.0',
    title: 'Test',
    path: '',
    units: { unit: 2, format: 0, precision: 1 },
    root,
    definitions: [],
    materials: [],
    layers: [{ name: 'Layer0', visible: true, color: [255, 255, 255], default: true }],
    unused: 0,
    ...extra,
  };
}

const noTexture = () => null;
const rootOf = (r: ReturnType<typeof convert>) => r.document.scene.definitions.get(r.document.scene.rootId)!;

describe('SketchUp import (developer converter)', () => {
  test('a box becomes millimeters with Y up, and passes the checker', () => {
    const r = convert(dump(box(10, 20, 30)), noTexture);
    const model = rootOf(r).model;
    expect(checkModel(model)).toEqual([]);
    expect(listFaces(model)).toHaveLength(6);
    const ys = Object.values(serialize(model).vertices).map((p) => p[1]!);
    const zs = Object.values(serialize(model).vertices).map((p) => p[2]!);
    expect(Math.max(...ys)).toBeCloseTo(762, 6);
    expect(Math.min(...zs)).toBeCloseTo(-508, 6);
    expect(r.document.units).toEqual({ unit: 'mm', precision: 1 });
    // Outward normals stay outward: the top points up (+Y).
    expect(listFaces(model).some((f) => f.normal[1] > 0.99)).toBe(true);
    expect(r.report.issues).toEqual([]);
  });

  test('a face with a hole, and a cylinder with soft sides and its circles', () => {
    const e = empty();
    const ring = (r: number, z: number, n: number): Vec[] => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n), z]);
    const square: Vec[] = [[-20, -20, 0], [20, -20, 0], [20, 20, 0], [-20, 20, 0]];
    const bottom = ring(5, 0, 12);
    const top = ring(5, 10, 12);
    addFaces(e, [{ loops: [square, [...bottom].reverse()], normal: [0, 0, 1] }]);
    addFaces(e, [{ loops: [[...top]], normal: [0, 0, 1] }]);
    for (let i = 0; i < 12; i++) {
      const j = (i + 1) % 12;
      addFaces(e, [{ loops: [[bottom[i]!, bottom[j]!, top[j]!, top[i]!]], normal: [Math.cos((2 * Math.PI * (i + 0.5)) / 12), Math.sin((2 * Math.PI * (i + 0.5)) / 12), 0] }]);
    }
    // The vertical edges are soft; the rims are circles.
    for (const edge of e.edges) {
      const [a, b] = edge.v.map((v) => e.vertices[v]!) as [Vec, Vec];
      if (a[2] !== b[2]) Object.assign(edge, { soft: true, smooth: true });
      else if (Math.hypot(a[0], a[1]) < 6) edge.curve = a[2] === 0 ? 0 : 1;
    }
    e.curves = [0, 10].map((z) => ({ arc: true, segments: 12, center: [0, 0, z] as Vec, normal: [0, 0, 1] as Vec, radius: 5, xaxis: [5, 0, 0] as Vec, yaxis: [0, 5, 0] as Vec, start: 0, end: 2 * Math.PI, polygon: false }));
    const r = convert(dump(e), noTexture);
    const t = serialize(rootOf(r).model);
    expect(checkModel(rootOf(r).model)).toEqual([]);
    expect(Object.values(t.faces).filter((f) => f.holes.length === 1)).toHaveLength(1);
    expect(Object.values(t.edges).filter((x) => x.soft)).toHaveLength(12);
    expect(Object.values(t.curves).map((c) => [c.kind, c.segments, c.radius])).toEqual([
      ['circle', 12, 127],
      ['circle', 12, 127],
    ]);
  });

  test('components are shared, groups get one definition each, and mirrors and scales survive', () => {
    const root = empty();
    const mirror = matrix([-1, 0, 0], [0, 1, 0], [0, 0, 1], [100, 0, 0]);
    const stretched = matrix([2, 0, 0], [0, 1, 0], [0, 0, 3], [0, 50, 0]);
    root.instances = [
      { definition: 1, name: 'Left', transform: IDENTITY, layer: 'Layer0', material: null, hidden: false },
      { definition: 1, name: 'Right', transform: mirror, layer: 'Case', material: 7, hidden: false },
      { definition: 2, name: 'Top', transform: stretched, layer: 'Layer0', material: null, hidden: false },
      { definition: 2, name: 'Top copy', transform: matrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 40]), layer: 'Layer0', material: null, hidden: false },
    ];
    const r = convert(
      dump(root, {
        definitions: [
          { id: 1, name: 'Side', group: false, entities: box(1, 10, 20, 7) },
          { id: 2, name: 'Group#1', group: true, entities: box(30, 10, 1) },
        ],
        materials: [{ id: 7, name: 'Oak', color: [180, 140, 90], alpha: 1, texture: null }],
        layers: [
          { name: 'Layer0', visible: true, color: [255, 255, 255], default: true },
          { name: 'Case', visible: false, color: [79, 129, 189], default: false },
        ],
      }),
      noTexture,
    );
    const scene = r.document.scene;
    const defs = [...scene.definitions.values()];
    expect(defs.filter((d) => d.kind === 'component').map((d) => d.name)).toEqual(['Side']);
    expect(defs.filter((d) => d.kind === 'group')).toHaveLength(2);
    for (const d of defs) expect(checkModel(d.model)).toEqual([]);
    const placed = [...rootOf(r).instances.values()];
    expect(placed.map((i) => i.name)).toEqual(['Left', 'Right', 'Top', 'Top copy']);
    const right = placed[1]!;
    expect(determinant(right.transform)).toBeLessThan(0);
    expect(scene.tags.get(right.tag!)).toEqual({ name: 'Case', color: '#4f81bd', visible: false });
    expect(scene.materials.get(right.material!)?.name).toBe('Oak');
    // A point at SketchUp (1, 0, 0) inch in the mirrored side lands at x = 100 - 1 inch.
    expect(applyPoint(right.transform, [25.4, 0, 0])[0]).toBeCloseTo(99 * 25.4, 6);
    // The stretch: 2 along x, 3 along SketchUp z (Pushform y).
    const top = affineOf(placed[2]!.transform);
    expect(applyPoint(top, [25.4, 25.4, 0])).toEqual([expect.closeTo(50.8, 6), expect.closeTo(76.2, 6), expect.closeTo(-50 * 25.4, 6)]);
    // Paint on the component's faces names the file's material.
    const side = defs.find((d) => d.name === 'Side')!;
    expect(listFaces(side.model).filter((f) => f.paint?.front === right.material)).toHaveLength(1);
    expect(r.report.converted['placed groups and components']).toBe(4);
  });

  test('a vertex inside an edge splits it; a crooked face is skipped and reported', () => {
    const e = box(10, 10, 10);
    // A loose edge ending in the middle of the bottom's front edge.
    e.vertices.push([5, 0, 0], [5, -5, 0]);
    e.edges.push({ v: [e.vertices.length - 2, e.vertices.length - 1], soft: false, smooth: false, hidden: false, curve: null, layer: 'Layer0' });
    // A face whose fourth corner is off its plane.
    addFaces(e, [{ loops: [[[20, 0, 0], [30, 0, 0], [30, 10, 0], [20, 10, 0.5]]], normal: [0, 0, 1] }]);
    const r = convert(dump(e), noTexture);
    const model = rootOf(r).model;
    expect(checkModel(model)).toEqual([]);
    expect(listFaces(model)).toHaveLength(6);
    expect(listEdges(model)).toHaveLength(12 + 1 + 1 + 4);
    // New ids the kernel makes never collide with the split edges.
    const t = serialize(model);
    const ids = [...Object.keys(t.vertices), ...Object.keys(t.edges), ...Object.keys(t.faces)].map((id) => Number(id.slice(1)));
    expect(t.next).toBeGreaterThan(Math.max(...ids));
    const text = reportText(r.report);
    expect(text).toContain('Model: edges split where a vertex lay inside them');
    expect(text).toContain('Model: faces skipped: not planar within 0.001 mm');
  });

  test('units, guides, dimensions, texts and things it cannot convert', () => {
    const e = box(10, 10, 10);
    e.guides = [
      { kind: 'line', point: [0, 0, 0], direction: [0, 0, 2], layer: 'Layer0' },
      { kind: 'point', point: [1, 2, 3], layer: 'Layer0' },
    ];
    e.dimensions = [{ start: [0, 0, 0], end: [10, 0, 0], offset: [0, -2, 0], layer: 'Layer0' }];
    e.texts = [
      { point: [10, 10, 10], leader: [2, 2, 2], text: 'Corner', hasLeader: true, layer: 'Layer0' },
      { point: [0, 0, 0], leader: [0, 0, 0], text: 'Title', hasLeader: false, layer: 'Layer0' },
    ];
    e.other = { SectionPlane: 1, Image: 2 };
    const r = convert(dump(e, { units: { unit: 0, format: 1, precision: 4 }, unused: 3 }), noTexture);
    const root = rootOf(r);
    expect(r.document.units).toEqual({ unit: 'ft-in', precision: 16 });
    expect([...root.guides.values()].map((g) => g.kind)).toEqual(['line', 'point']);
    expect([...root.guides.values()][0]).toMatchObject({ direction: [0, 1, 0] });
    expect([...root.annotations.values()].map((a) => a.kind)).toEqual(['dimension', 'text']);
    const text = reportText(r.report);
    expect(text).toContain('Model: screen text skipped');
    expect(text).toContain('Model: SectionPlane skipped');
    expect(text).toContain('Model: Image skipped (2)');
    expect(text).toContain('Model: unused component definitions left out (3)');
  });

  test('a texture is embedded at its size; transparency is reported', () => {
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    const r = convert(
      dump(box(10, 10, 10, 3), {
        materials: [{ id: 3, name: 'Walnut', color: [90, 60, 40], alpha: 0.5, texture: { file: 'texture-3.png', width: 24, height: 12, source: 'walnut.jpg' } }],
      }),
      (file) => (file === 'texture-3.png' ? PNG : null),
    );
    const walnut = [...r.document.scene.materials.values()][0]!;
    expect(walnut.texture).toMatchObject({ mime: 'image/png', width: 609.6, height: 304.8 });
    expect(reportText(r.report)).toContain('Material Walnut: opacity 50% shown opaque');
  });
});
