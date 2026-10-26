import { describe, expect, test } from 'vitest';
import { createSession, serializeDocument, type CommandSession , rootModel } from '../src/commands';
import { checkModel, listEdges, listFaces, serialize, type FaceView, type Point3 } from '../src/kernel';

/*
 * Push/pull on faces that cover only part of a neighbour's edge: slots,
 * notches and tabs. Box: 1000 x 600 x 300, front wall at z = 600.
 * All sizes in mm.
 */

function box(): { s: CommandSession; top: string } {
  const s = createSession();
  const g = s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 1000, depth: 600 });
  const top = g.ok ? g.output.faceIds[0]! : '';
  s.execute('core.pushPull', { faceId: top, distance: 300 });
  return { s, top };
}

/** Draw a rectangle on the top face and return the created face whose center is at (cx, cz). */
function rectOnTop(s: CommandSession, top: string, corner: [number, number, number], width: number, depth: number, cx: number, cz: number) {
  const r = s.execute('core.drawRectangle', { faceId: top, corner, width, depth });
  if (!r.ok) throw new Error(r.error.code);
  const face = listFaces(rootModel(s.doc)).find((f) => f.normal[1] === 1 && near(centroid(f), [cx, 300, cz]));
  if (!face) throw new Error('rectangle face not found');
  return face.id;
}

function push(s: CommandSession, faceId: string, distance: number) {
  const preview = s.preview('core.pushPull', { faceId, distance });
  const r = s.execute('core.pushPull', { faceId, distance });
  if (!r.ok) throw new Error(r.error.code);
  expect(checkModel(rootModel(s.doc))).toEqual([]);
  // The live preview is the same computation as the committed push.
  expect(preview.ok && serializeDocument(preview.doc)).toEqual(serializeDocument(s.doc));
  return r.output;
}

const near = (a: readonly number[], b: readonly number[], tol = 1e-6) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
function centroid(f: FaceView): Point3 {
  const s = f.outer.reduce<[number, number, number]>((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
  return [s[0] / f.outer.length, s[1] / f.outer.length, s[2] / f.outer.length];
}

/** Faces whose plane contains p and whose region contains p (by even-odd test in the plane). */
function facesAt(s: CommandSession, p: Point3): FaceView[] {
  const dotp = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return listFaces(rootModel(s.doc)).filter((f) => {
    if (Math.abs(dotp(f.normal, p) - dotp(f.normal, f.outer[0]!)) > 1e-3) return false;
    // Drop the dominant axis of the normal to get 2D coordinates.
    const abs = f.normal.map(Math.abs);
    const k = abs.indexOf(Math.max(...abs));
    const uv = (q: Point3): [number, number] => {
      const r = [q[0], q[1], q[2]].filter((_, i) => i !== k);
      return [r[0]!, r[1]!];
    };
    const [x, y] = uv(p);
    const inside = (loop: readonly Point3[]) => {
      let hit = false;
      for (let a = 0, b = loop.length - 1; a < loop.length; b = a++) {
        const [ax, ay] = uv(loop[a]!);
        const [bx, by] = uv(loop[b]!);
        if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit;
      }
      return hit;
    };
    return inside(f.outer) && !f.holes.some(inside);
  });
}

/** Edges lying in the plane z = 600 (the front wall). */
const frontEdges = (s: CommandSession) => listEdges(rootModel(s.doc)).filter((e) => e.a[2] === 600 && e.b[2] === 600);
const axisAligned = (e: { a: Point3; b: Point3 }) => [0, 1, 2].filter((i) => Math.abs(e.a[i]! - e.b[i]!) > 1e-9).length === 1;

describe('a slot reaching the front edge (testing repro)', () => {
  test('pushed down 150: a slot with straight sides, the front wall gets a rectangular notch', () => {
    const { s, top } = box();
    const front = facesAt(s, [100, 100, 600])[0]!.id;
    const slot = rectOnTop(s, top, [400, 300, 200], 200, 400, 500, 400);
    const out = push(s, slot, -150);
    expect(out.distance).toBe(-150);
    // Two side walls and a back wall; no wall across the open front.
    expect(out.createdFaceIds).toHaveLength(3);
    // The front wall keeps its id and loses the notch.
    expect(facesAt(s, [100, 100, 600]).map((f) => f.id)).toEqual([front]);
    expect(facesAt(s, [500, 200, 600])).toHaveLength(0);
    expect(facesAt(s, [500, 100, 600]).map((f) => f.id)).toEqual([front]);
    // Every edge of the front wall is horizontal or vertical: no diagonals.
    expect(frontEdges(s).every(axisAligned)).toBe(true);
    const fe = frontEdges(s).map((e) => [e.a, e.b]);
    const has = (a: Point3, b: Point3) => fe.some(([p, q]) => (near(p!, a) && near(q!, b)) || (near(p!, b) && near(q!, a)));
    expect(has([400, 300, 600], [400, 150, 600])).toBe(true);
    expect(has([600, 300, 600], [600, 150, 600])).toBe(true);
    expect(has([400, 150, 600], [600, 150, 600])).toBe(true);
    expect(has([0, 300, 600], [400, 300, 600])).toBe(true);
    // The slot floor is at 150 and still open at the front.
    expect(facesAt(s, [500, 150, 400]).map((f) => f.id)).toEqual([slot]);
  });

  test('pushed down 300: through the box, open at the front and the bottom', () => {
    const { s, top } = box();
    const slot = rectOnTop(s, top, [400, 300, 200], 200, 400, 500, 400);
    const out = push(s, slot, -300);
    expect(out.distance).toBe(-300);
    expect(out.removedFaceIds).toContain(slot);
    expect(facesAt(s, [500, 0, 400])).toHaveLength(0);
    expect(facesAt(s, [500, 100, 600])).toHaveLength(0);
    // The front wall is cut in two.
    expect(facesAt(s, [100, 100, 600])).toHaveLength(1);
    expect(facesAt(s, [900, 100, 600])).toHaveLength(1);
    expect(facesAt(s, [100, 100, 600])[0]!.id).not.toBe(facesAt(s, [900, 100, 600])[0]!.id);
    expect(facesAt(s, [100, 0, 300])).toHaveLength(1);
  });

  test('pushed down 150 and then on to the bottom: the slot goes through', () => {
    const { s, top } = box();
    const slot = rectOnTop(s, top, [400, 300, 200], 200, 400, 500, 400);
    push(s, slot, -150);
    const out = push(s, slot, -1000);
    expect(out.distance).toBe(-150);
    expect(facesAt(s, [500, 0, 400])).toHaveLength(0);
    expect(facesAt(s, [500, 100, 600])).toHaveLength(0);
  });

  test('pushed up 100: a tab, merged into the front wall', () => {
    const { s, top } = box();
    const front = facesAt(s, [100, 100, 600])[0]!.id;
    const slot = rectOnTop(s, top, [400, 300, 200], 200, 400, 500, 400);
    push(s, slot, 100);
    expect(facesAt(s, [500, 350, 600]).map((f) => f.id)).toEqual([front]);
    expect(frontEdges(s).every(axisAligned)).toBe(true);
  });
});

describe('other notches', () => {
  test('a notch at a corner, touching two outer edges, pushed down 150', () => {
    const { s, top } = box();
    const notch = rectOnTop(s, top, [800, 300, 400], 200, 200, 900, 500);
    const out = push(s, notch, -150);
    expect(out.distance).toBe(-150);
    expect(facesAt(s, [900, 200, 600])).toHaveLength(0);
    expect(facesAt(s, [1000, 200, 500])).toHaveLength(0);
    expect(facesAt(s, [900, 100, 600])).toHaveLength(1);
    expect(facesAt(s, [1000, 100, 500])).toHaveLength(1);
    expect(facesAt(s, [900, 150, 500]).map((f) => f.id)).toEqual([notch]);
  });

  test('a rectangle running past the front edge: the part on the box is pushed down, the part outside stays', () => {
    const { s, top } = box();
    const r = s.execute('core.drawRectangle', { faceId: top, corner: [400, 300, 400], width: 200, depth: 400 });
    expect(r.ok).toBe(true);
    const inside = facesAt(s, [500, 300, 500])[0]!.id;
    const outside = facesAt(s, [500, 300, 700])[0]!.id;
    push(s, inside, -150);
    expect(facesAt(s, [500, 150, 500]).map((f) => f.id)).toEqual([inside]);
    expect(facesAt(s, [500, 300, 700]).map((f) => f.id)).toEqual([outside]);
    expect(facesAt(s, [500, 200, 600])).toHaveLength(0);
  });

  test('pushing the outside part down instead adds geometry outside the box', () => {
    const { s, top } = box();
    s.execute('core.drawRectangle', { faceId: top, corner: [400, 300, 400], width: 200, depth: 400 });
    const outside = facesAt(s, [500, 300, 700])[0]!.id;
    push(s, outside, -150);
    expect(facesAt(s, [500, 150, 700]).map((f) => f.id)).toEqual([outside]);
  });
});

describe('randomized slots, notches and tabs', () => {
  function rng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  test.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i', (seed) => {
    const r = rng(seed);
    const { s, top } = box();
    for (let i = 0; i < 4; i++) {
      // A rectangle on the top plane, often reaching or crossing the box edges.
      const x0 = Math.floor(r() * 12) * 100 - 100;
      const z0 = Math.floor(r() * 8) * 100 - 100;
      const w = 100 + Math.floor(r() * 5) * 100;
      const dd = 100 + Math.floor(r() * 4) * 100;
      const drawn = s.execute('core.drawRectangle', { faceId: top, corner: [x0, 300, z0], width: w, depth: dd });
      if (!drawn.ok) continue;
      expect(checkModel(rootModel(s.doc))).toEqual([]);
      const faces = drawn.output.faceIds.filter((f) => listFaces(rootModel(s.doc)).some((x) => x.id === f));
      const target = faces[Math.floor(r() * faces.length)];
      if (!target) continue;
      const dist = (r() < 0.5 ? -1 : 1) * (50 + Math.floor(r() * 4) * 100);
      push(s, target, dist);
    }
  });
});

/** Faces whose loops use the edge between points a and b. */
function facesOnEdge(s: CommandSession, a: Point3, b: Point3): string[] {
  const m = serialize(rootModel(s.doc));
  const id = (p: Point3) => Object.entries(m.vertices).find(([, q]) => near(q, p))?.[0];
  const va = id(a);
  const vb = id(b);
  if (!va || !vb) return [];
  return Object.entries(m.faces)
    .filter(([, f]) =>
      [f.outer, ...f.holes].some((l) => l.some((v, i) => {
        const w = l[(i + 1) % l.length];
        return (v === va && w === vb) || (v === vb && w === va);
      })),
    )
    .map(([fid]) => fid);
}

describe('adjacent boxes sharing a full edge (testing repros A and B)', () => {
  /** Repro A: two ground rectangles sharing the edge x = 1000; the first pushed up 500. */
  function reproA() {
    const s = createSession();
    const a = s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 1000, depth: 500 });
    const b = s.execute('core.drawRectangle', { faceId: null, corner: [1000, 0, 0], width: 1000, depth: 500 });
    if (!a.ok || !b.ok) throw new Error();
    const first = a.output.faceIds[0]!;
    const second = b.output.faceIds[0]!;
    expect(push(s, first, 500).distance).toBe(500);
    return { s, second };
  }
  const shared = (s: CommandSession, y: number) => facesAt(s, [1000, y, 250]);

  test('second pushed up 500: the wall at x = 1000 is one face shared by both boxes', () => {
    const { s, second } = reproA();
    expect(push(s, second, 500).distance).toBe(500);
    expect(shared(s, 250)).toHaveLength(1);
    // Its top edge bounds the wall and both tops.
    expect(facesOnEdge(s, [1000, 500, 0], [1000, 500, 500])).toHaveLength(3);
  });

  test('second pushed up 300: the wall splits at y = 300; the lower part is shared, the upper part is the first box only', () => {
    const { s, second } = reproA();
    expect(push(s, second, 300).distance).toBe(300);
    const lower = shared(s, 150);
    const upper = shared(s, 400);
    expect(lower).toHaveLength(1);
    expect(upper).toHaveLength(1);
    expect(lower[0]!.id).not.toBe(upper[0]!.id);
    // The split line bounds the lower part, the upper part and the second box's top.
    expect(facesOnEdge(s, [1000, 300, 0], [1000, 300, 500])).toHaveLength(3);
    // The upper part's top edge bounds only it and the first box's top.
    expect(facesOnEdge(s, [1000, 500, 0], [1000, 500, 500])).toHaveLength(2);
  });

  test('second pushed up 800: the wall splits at y = 500; the part above is the second box only', () => {
    const { s, second } = reproA();
    expect(push(s, second, 800).distance).toBe(800);
    expect(shared(s, 250)).toHaveLength(1);
    const above = shared(s, 650);
    expect(above).toHaveLength(1);
    expect(above[0]!.id).not.toBe(shared(s, 250)[0]!.id);
    // The second box's wall faces away from it.
    expect(above[0]!.normal).toEqual([-1, 0, 0]);
    expect(facesOnEdge(s, [1000, 500, 0], [1000, 500, 500])).toHaveLength(3);
  });

  test('second pushed down 300: walls are created below ground', () => {
    const { s, second } = reproA();
    expect(push(s, second, -300).distance).toBe(-300);
    expect(facesAt(s, [1500, -300, 250]).map((f) => f.id)).toEqual([second]);
    expect(facesAt(s, [2000, -150, 250])).toHaveLength(1);
    expect(facesAt(s, [1500, -150, 0])).toHaveLength(1);
    expect(facesAt(s, [1500, -150, 500])).toHaveLength(1);
    // At x = 1000 the pit wall faces the same way as the first box's wall and lies in its plane, so they merge.
    expect(facesAt(s, [1000, -150, 250])).toHaveLength(1);
    expect(facesAt(s, [1000, -150, 250])[0]!.id).toBe(shared(s, 250)[0]!.id);
  });

  test('repro B: a new rectangle against an existing box, pushed up 300', () => {
    const s = createSession();
    const a = s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 1000, depth: 500 });
    if (!a.ok) throw new Error();
    push(s, a.output.faceIds[0]!, 500);
    const b = s.execute('core.drawRectangle', { faceId: null, corner: [1000, 0, 0], width: 1000, depth: 500 });
    if (!b.ok) throw new Error();
    expect(checkModel(rootModel(s.doc))).toEqual([]);
    const second = facesAt(s, [1500, 0, 250]).find((f) => f.normal[1] === 1)!.id;
    expect(push(s, second, 300).distance).toBe(300);
    const lower = shared(s, 150);
    const upper = shared(s, 400);
    expect(lower).toHaveLength(1);
    expect(upper).toHaveLength(1);
    expect(lower[0]!.id).not.toBe(upper[0]!.id);
    expect(facesOnEdge(s, [1000, 300, 0], [1000, 300, 500])).toHaveLength(3);
  });
});

describe('a box beside another box', () => {
  /** Box A as above, and a ground rectangle B next to its right wall, sharing part of that wall's bottom edge. */
  function besideBox() {
    const { s } = box();
    const r = s.execute('core.drawRectangle', { faceId: null, corner: [1000, 0, 100], width: 600, depth: 400 });
    const b = r.ok ? facesAt(s, [1300, 0, 300])[0]!.id : '';
    return { s, b };
  }

  test('a lower box: the shared part of the wall stays a single face', () => {
    const { s, b } = besideBox();
    push(s, b, 200);
    expect(facesAt(s, [1000, 100, 300])).toHaveLength(1);
    expect(facesAt(s, [1000, 250, 300])).toHaveLength(1);
    expect(facesAt(s, [1300, 200, 300])).toHaveLength(1);
  });

  test('a taller box: the wall above the first box is a new face', () => {
    const { s, b } = besideBox();
    push(s, b, 500);
    expect(facesAt(s, [1000, 100, 300])).toHaveLength(1);
    const above = facesAt(s, [1000, 400, 300]);
    expect(above).toHaveLength(1);
    expect(above[0]!.normal).toEqual([-1, 0, 0]);
  });

  test('pushing the first box top up past the second keeps everything valid', () => {
    const { s, b } = besideBox();
    push(s, b, 200);
    const topA = facesAt(s, [500, 300, 300])[0]!.id;
    push(s, topA, 100);
    expect(facesAt(s, [500, 400, 300]).map((f) => f.id)).toEqual([topA]);
  });
});
