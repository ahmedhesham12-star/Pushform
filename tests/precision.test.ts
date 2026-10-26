import { describe, expect, test } from 'vitest';
import { createSession, rootModel, type CommandSession } from '../src/commands';
import { getFace, listFaces, serialize, snapLength } from '../src/kernel';
import { parseLength, parseLengthList } from '../src/units';

/* Imperial input converted to mm is rarely exact in floating point. These tests
   check that what reaches the model is rounded to 1e-6 mm, so equal decimal
   values are stored as identical numbers. */

const inches = (text: string) => {
  const r = parseLength(text, 'in');
  if (!r.ok) throw new Error(text);
  return r.mm;
};

/** Every stored coordinate, as written to the file. */
const allCoordinates = (s: CommandSession) =>
  Object.values(serialize(rootModel(s.doc)).vertices).flat();

describe('snapLength', () => {
  test('rounds to the closest double of the 1e-6 mm decimal', () => {
    expect(inches('24"')).toBe(609.5999999999999);
    expect(snapLength(609.5999999999999)).toBe(609.6);
    expect(snapLength(304.79999999999995)).toBe(304.8);
    expect(snapLength(774.6999999999999)).toBe(774.7);
    expect(snapLength(0.1 + 0.2)).toBe(0.3);
    expect(snapLength(1.0000004)).toBe(1);
    expect(snapLength(1.0000006)).toBe(1.000001);
  });

  test('is idempotent and never returns -0', () => {
    for (const v of [609.6, 1e5 + 0.123456, -914.4, 1 / 64]) expect(snapLength(snapLength(v))).toBe(snapLength(v));
    expect(Object.is(snapLength(-0), 0)).toBe(true);
    expect(Object.is(snapLength(-1e-9), 0)).toBe(true);
  });
});

describe('imperial input is stored exactly', () => {
  function rectangle(corner: string, size: string) {
    const s = createSession();
    const c = inches(corner);
    const [w, d] = (parseLengthList(size, 'in') as { ok: true; mm: number[] }).mm;
    const r = s.execute('core.drawRectangle', { faceId: null, corner: [c, 0, c], width: w!, depth: d! });
    if (!r.ok) throw new Error(r.error.code);
    return { s, id: r.output.faceIds[0]! };
  }

  test('command inputs are rounded on entry', () => {
    const { s } = rectangle('0"', '24", 2\' 6 1/2"');
    expect(s.history()[0]!.input).toMatchObject({ width: 609.6, depth: 774.7 });
  });

  test('rectangle corners match the decimal values exactly', () => {
    const { s, id } = rectangle('12"', '24", 24"');
    const outer = getFace(rootModel(s.doc), id)!.outer;
    const xs = new Set(outer.map((p) => p[0]));
    const zs = new Set(outer.map((p) => p[2]));
    // 304.8 + 609.6 is 914.4000000000001 in plain floating point.
    expect([...xs].sort()).toEqual([304.8, 914.4]);
    expect([...zs].sort()).toEqual([304.8, 914.4]);
  });

  test('pushed faces land exactly on the typed height, also after a re-push', () => {
    const { s, id } = rectangle('0"', '24", 24"');
    s.execute('core.pushPull', { faceId: id, distance: inches('2\' 6 1/2"') });
    expect(new Set(getFace(rootModel(s.doc), id)!.outer.map((p) => p[1]))).toEqual(new Set([774.7]));
    s.undo();
    s.execute('core.pushPull', { faceId: id, distance: inches('24"') });
    s.execute('core.pushPull', { faceId: id, distance: inches('12"') });
    // 609.6 + 304.8 is 914.4000000000001 in plain floating point.
    expect(new Set(getFace(rootModel(s.doc), id)!.outer.map((p) => p[1]))).toEqual(new Set([914.4]));
  });

  test('shared corners are identical numbers on every face that uses them', () => {
    const { s, id } = rectangle('12"', '24", 2\' 6 1/2"');
    s.execute('core.pushPull', { faceId: id, distance: inches('3/4"') });
    const top = getFace(rootModel(s.doc), id)!.outer;
    for (const corner of top) {
      const users = listFaces(rootModel(s.doc)).filter((f) => f.outer.some((p) => p.every((v, i) => v === corner[i])));
      expect(users, JSON.stringify(corner)).toHaveLength(3);
    }
  });

  test('every stored coordinate is already rounded', () => {
    const { s, id } = rectangle('1 1/16"', '23 5/8", 17 3/32"');
    s.execute('core.pushPull', { faceId: id, distance: inches('11/16"') });
    const inset = s.execute('core.drawRectangle', {
      faceId: id,
      corner: [inches('4 1/8"'), inches('11/16"'), inches('4 1/8"')],
      width: inches('5 3/8"'),
      depth: inches('3 1/4"'),
    });
    if (inset.ok) s.execute('core.pushPull', { faceId: inset.output.faceIds[0]!, distance: -inches('1/4"') });
    const coords = allCoordinates(s);
    expect(coords.length).toBeGreaterThan(0);
    for (const v of coords) expect(snapLength(v)).toBe(v);
  });

  test('amended values are rounded too', () => {
    const { s } = rectangle('0"', '24", 24"');
    s.amend([inches('2\' 6 1/2"'), inches('24"')]);
    expect(s.history()[0]!.input).toMatchObject({ width: 774.7, depth: 609.6 });
  });
});
