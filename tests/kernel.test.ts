import { describe, expect, test } from 'vitest';
import {
  createModel,
  deleteFace,
  deserialize,
  drawRectangle,
  faceArea,
  faceCount,
  getFace,
  listFaces,
  pushPull,
  renderEdges,
  serialize,
  snapPoints,
  type FaceView,
  type Model,
  type Point3,
} from '../src/kernel';

/* All sizes in mm. */

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected success, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
}

/** 3000 x 2000 rectangle on the ground with one corner at the origin. */
function groundRect(): { model: Model; id: string } {
  const r = ok(drawRectangle(createModel(), { faceId: null, corner: [0, 0, 0], width: 3000, depth: 2000 }));
  return { model: r.model, id: r.faceId };
}

/** The ground rectangle pushed up 1000 into a box. */
function box(): { model: Model; top: string } {
  const { model, id } = groundRect();
  return { model: pushPull(model, id, 1000).model, top: id };
}

const centroid = (f: FaceView): Point3 => {
  const s = f.outer.reduce<[number, number, number]>((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
  return [s[0] / f.outer.length, s[1] / f.outer.length, s[2] / f.outer.length];
};
const ys = (f: FaceView) => [...new Set(f.outer.map((p) => +p[1].toFixed(6)))];
const xs = (f: FaceView) => f.outer.map((p) => p[0]);
const face = (m: Model, id: string) => getFace(m, id)!;
const findByNormal = (m: Model, n: Point3) =>
  listFaces(m).filter((f) => f.normal.every((v, i) => Math.abs(v - n[i]!) < 1e-9));

describe('push/pull: extrude a lone face', () => {
  test('makes a closed box of six faces and keeps the bottom', () => {
    const { model, id } = groundRect();
    const r = pushPull(model, id, 1000);
    expect(r.distance).toBe(1000);
    expect(faceCount(r.model)).toBe(6);

    const top = face(r.model, id);
    expect(top.normal).toEqual([0, 1, 0]);
    expect(ys(top)).toEqual([1000]);

    const bottoms = findByNormal(r.model, [0, -1, 0]);
    expect(bottoms).toHaveLength(1);
    expect(ys(bottoms[0]!)).toEqual([0]);
  });

  test('every face points outward', () => {
    const { model } = box();
    const center: Point3 = [1500, 500, 1000];
    for (const f of listFaces(model)) {
      const c = centroid(f);
      const out = f.normal[0] * (c[0] - center[0]) + f.normal[1] * (c[1] - center[1]) + f.normal[2] * (c[2] - center[2]);
      expect(out, `face ${f.id}`).toBeGreaterThan(0);
    }
  });

  test('has 12 drawn edges and 8 endpoint plus 12 midpoint snaps', () => {
    const { model } = box();
    expect(renderEdges(model)).toHaveLength(12);
    const snaps = snapPoints(model);
    expect(snaps.filter((s) => s.kind === 'end')).toHaveLength(8);
    expect(snaps.filter((s) => s.kind === 'mid')).toHaveLength(12);
  });

  test('pulling downward keeps the original face facing up at the ground', () => {
    const { model, id } = groundRect();
    const r = pushPull(model, id, -500);
    expect(faceCount(r.model)).toBe(6);
    expect(face(r.model, id).normal).toEqual([0, -1, 0]);
    expect(ys(face(r.model, id))).toEqual([-500]);
    const up = findByNormal(r.model, [0, 1, 0]);
    expect(up).toHaveLength(1);
    expect(ys(up[0]!)).toEqual([0]);
    const center: Point3 = [1500, -250, 1000];
    for (const f of listFaces(r.model)) {
      const c = centroid(f);
      const out = f.normal[0] * (c[0] - center[0]) + f.normal[1] * (c[1] - center[1]) + f.normal[2] * (c[2] - center[2]);
      expect(out, `face ${f.id}`).toBeGreaterThan(0);
    }
  });

  test('does not modify the input model', () => {
    const { model, id } = groundRect();
    const before = JSON.stringify(serialize(model));
    pushPull(model, id, 1000);
    expect(JSON.stringify(serialize(model))).toBe(before);
  });
});

describe('push/pull: re-push', () => {
  test('stretches the walls instead of adding faces', () => {
    const { model, top } = box();
    const r = pushPull(model, top, 500);
    expect(r.distance).toBe(500);
    expect(faceCount(r.model)).toBe(6);
    expect(serialize(r.model).next).toBe(serialize(model).next);
    expect(ys(face(r.model, top))).toEqual([1500]);
    for (const wall of listFaces(r.model).filter((f) => f.normal[1] === 0)) {
      expect(ys(wall).sort((a, b) => a - b)).toEqual([0, 1500]);
    }
    expect(renderEdges(r.model)).toHaveLength(12);
  });

  test('a zero distance changes nothing and returns the same model', () => {
    const { model, top } = box();
    const r = pushPull(model, top, 0);
    expect(r.distance).toBe(0);
    expect(r.model).toBe(model);
  });
});

describe('push/pull: clamping', () => {
  test('pushing the top through the bottom stops 1 mm short', () => {
    const { model, top } = box();
    const r = pushPull(model, top, -5000);
    expect(r.distance).toBeCloseTo(-999, 9);
    expect(ys(face(r.model, top))).toEqual([1]);
    expect(faceCount(r.model)).toBe(6);
  });

  test('a fully clamped push returns the same model', () => {
    const { model, top } = box();
    const flat = pushPull(model, top, -999).model;
    const r = pushPull(flat, top, -10);
    expect(r.distance).toBe(0);
    expect(r.model).toBe(flat);
  });
});

describe('push/pull: pockets', () => {
  function pocket() {
    const { model, top } = box();
    const inset = ok(drawRectangle(model, { faceId: top, corner: [1000, 1000, 500], width: 1000, depth: 1000 }));
    return { model: inset.model, top, pocket: inset.faceId };
  }

  test('a rectangle inside a face cuts a hole and fills it', () => {
    const { model, top, pocket: p } = pocket();
    expect(faceCount(model)).toBe(7);
    expect(face(model, top).holes).toHaveLength(1);
    expect(face(model, p).normal).toEqual([0, 1, 0]);
    expect(faceArea(model, top)).toBeCloseTo(3000 * 2000 - 1000 * 1000, 6);
  });

  test('pushing the inset face down makes a pocket with four inward walls', () => {
    const { model, pocket: p } = pocket();
    const r = pushPull(model, p, -300);
    expect(r.distance).toBe(-300);
    expect(faceCount(r.model)).toBe(11);
    expect(ys(face(r.model, p))).toEqual([700]);
    expect(face(r.model, p).normal).toEqual([0, 1, 0]);
    const center: Point3 = [1500, 850, 1000];
    const walls = listFaces(r.model).filter((f) => f.normal[1] === 0 && Math.min(...xs(f)) >= 1000 && Math.max(...xs(f)) <= 2000);
    expect(walls).toHaveLength(4);
    for (const w of walls) {
      const c = centroid(w);
      const toward = w.normal[0] * (center[0] - c[0]) + w.normal[2] * (center[2] - c[2]);
      expect(toward, `wall ${w.id}`).toBeGreaterThan(0);
    }
  });

  test('re-pushing the pocket deepens it without new faces', () => {
    const { model, pocket: p } = pocket();
    const once = pushPull(model, p, -300).model;
    const twice = pushPull(once, p, -200);
    expect(faceCount(twice.model)).toBe(11);
    expect(ys(face(twice.model, p))).toEqual([500]);
  });

  test('the pocket floor cannot be pulled above the top surface', () => {
    const { model, pocket: p } = pocket();
    const once = pushPull(model, p, -300).model;
    const r = pushPull(once, p, 1000);
    expect(r.distance).toBeCloseTo(299, 9);
    expect(ys(face(r.model, p))).toEqual([999]);
  });

  test('pushing the outer face carries an unpushed inset face with it', () => {
    const { model, top, pocket: p } = pocket();
    const r = pushPull(model, top, 200);
    expect(faceCount(r.model)).toBe(7);
    expect(ys(face(r.model, top))).toEqual([1200]);
    expect(ys(face(r.model, p))).toEqual([1200]);
  });
});

describe('push/pull: side walls', () => {
  test('pushing a side wall stretches top, bottom and neighbouring walls', () => {
    const { model, top } = box();
    const wall = findByNormal(model, [1, 0, 0])[0]!;
    const r = pushPull(model, wall.id, 500);
    expect(r.distance).toBe(500);
    expect(faceCount(r.model)).toBe(6);
    expect(Math.max(...xs(face(r.model, top)))).toBe(3500);
    expect(faceArea(r.model, top)).toBeCloseTo(3500 * 2000, 6);
    const bottom = findByNormal(r.model, [0, -1, 0])[0]!;
    expect(faceArea(r.model, bottom.id)).toBeCloseTo(3500 * 2000, 6);
  });

  test('pushing a side wall inward is clamped by the opposite wall', () => {
    const { model } = box();
    const wall = findByNormal(model, [1, 0, 0])[0]!;
    const r = pushPull(model, wall.id, -4000);
    expect(r.distance).toBeCloseTo(-2999, 9);
  });
});

describe('rectangles', () => {
  test('draws on the ground with the given signed sizes', () => {
    const r = ok(drawRectangle(createModel(), { faceId: null, corner: [100, 0, 100], width: -600, depth: 400 }));
    const f = face(r.model, r.faceId);
    expect(f.normal).toEqual([0, 1, 0]);
    expect(Math.min(...xs(f))).toBe(-500);
    expect(faceArea(r.model, r.faceId)).toBeCloseTo(240000, 6);
  });

  test.each([
    ['tooSmall', { faceId: null, corner: [0, 0, 0], width: 4, depth: 1000 }],
    ['notOnPlane', { faceId: null, corner: [0, 50, 0], width: 1000, depth: 1000 }],
    ['noSuchFace', { faceId: 'f999', corner: [0, 0, 0], width: 1000, depth: 1000 }],
  ] as const)('rejects %s', (error, spec) => {
    expect(drawRectangle(createModel(), { ...spec, corner: [...spec.corner] })).toEqual({ ok: false, error });
  });

  test('rejects rectangles that reach the face edge or overlap a hole', () => {
    const { model, top } = box();
    expect(drawRectangle(model, { faceId: top, corner: [2500, 1000, 500], width: 1000, depth: 500 })).toEqual({
      ok: false,
      error: 'outsideFace',
    });
    expect(drawRectangle(model, { faceId: top, corner: [0, 1000, 500], width: 1000, depth: 500 })).toEqual({
      ok: false,
      error: 'outsideFace',
    });
    const inset = ok(drawRectangle(model, { faceId: top, corner: [1000, 1000, 500], width: 1000, depth: 1000 }));
    expect(drawRectangle(inset.model, { faceId: top, corner: [1500, 1000, 1200], width: 1000, depth: 500 })).toEqual({
      ok: false,
      error: 'overlapsHole',
    });
    expect(drawRectangle(inset.model, { faceId: top, corner: [1000, 500, 500], width: 500, depth: 500 })).toEqual({
      ok: false,
      error: 'notOnPlane',
    });
  });

  test('draws on a side wall', () => {
    const { model } = box();
    const wall = findByNormal(model, [0, 0, 1])[0]!;
    const r = ok(drawRectangle(model, { faceId: wall.id, corner: [500, 200, 2000], width: 800, depth: 500 }));
    expect(face(r.model, r.faceId).normal).toEqual([0, 0, 1]);
    expect(face(r.model, wall.id).holes).toHaveLength(1);
  });
});

describe('delete and serialization', () => {
  test('deleteFace removes one face and leaves the input untouched', () => {
    const { model, top } = box();
    const after = deleteFace(model, top);
    expect(faceCount(after)).toBe(5);
    expect(faceCount(model)).toBe(6);
    expect(deleteFace(model, 'nope')).toBe(model);
  });

  test('round-trips through JSON', () => {
    const { model } = box();
    const json = JSON.parse(JSON.stringify(serialize(model)));
    const back = deserialize(json);
    expect(back).not.toBeNull();
    expect(serialize(back!)).toEqual(serialize(model));
  });

  test.each([null, 1, {}, { kind: 'face-loop', version: 2, next: 1, faces: {} }, { kind: 'face-loop', version: 1, next: 1, faces: { f1: { outer: [[0, 0]], holes: [], normal: [0, 1, 0], side: false } } }])(
    'rejects invalid data %#',
    (bad) => {
      expect(deserialize(bad)).toBeNull();
    },
  );
});
