import { describe, expect, test } from 'vitest';
import { createSession, definitionModel, matchTypedValues, type CommandSession } from '../src/commands';
import { checkModel, listFaces, serialize, solidVolume, type Model } from '../src/kernel';
import { decompose, determinant, findInstance, planeScale, quatFromAxisAngle, scaling, worldAnnotations } from '../src/scene';
import { boxGrips, gripFactors, type ScaleBox } from '../src/tools/scale';
import { parseTypedValues } from '../src/units';

/* Scale and mirror (milestone 4, step 8): the kernel's affine transformSelection and core.scale. Sizes in mm. */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}
const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error!.code);

/** Type into the measurements box after a command, as the app does. */
function type(s: CommandSession, text: string) {
  const target = s.amendTarget()!;
  const parsed = parseTypedValues(text, s.doc.units.unit);
  if (!parsed.ok) throw new Error(`could not parse ${text}`);
  const matched = matchTypedValues(target.fields, parsed);
  if (!matched.ok) throw new Error(matched.error.code);
  return ok(s.amend(matched.value));
}

/** A loose 1000 x 600 x 500 box at the origin (x 0..1000, y 0..500, z -600..0). */
function box() {
  const s = createSession();
  const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 1000, depth: 600 }));
  ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: 500 }));
  return s;
}
const root = (s: CommandSession): Model => definitionModel(s.doc)!;
const allFaces = (s: CommandSession) => listFaces(root(s)).map((f) => f.id);
const valid = (s: CommandSession) => expect(checkModel(root(s))).toEqual([]);
const extent = (s: CommandSession) => {
  const ps = listFaces(root(s)).flatMap((f) => f.outer);
  const min = [0, 1, 2].map((i) => Math.min(...ps.map((p) => p[i]!)));
  const max = [0, 1, 2].map((i) => Math.max(...ps.map((p) => p[i]!)));
  return [...min, ...max];
};
const radii = (m: Model) => Object.values(serialize(m).curves).map((c) => c.radius);
const RED: [number, number, number] = [1, 0, 0];
const UP: [number, number, number] = [0, 1, 0];
const GREEN: [number, number, number] = [0, 0, 1];

describe('scale maps', () => {
  test('a scale about a point keeps the point and scales along its axes only', () => {
    const m = scaling([100, 0, 0], [RED], [2]);
    expect(decompose(m)!.scale).toEqual([2, 1, 1]);
    expect(m.t).toEqual([-100, 0, 0]);
    expect(determinant(scaling([0, 0, 0], [], [-1]))).toBe(-1);
    const d = Math.SQRT1_2;
    // Along a diagonal: the matrix has no rotation-free form, but it is still one affine map.
    expect(determinant(scaling([0, 0, 0], [[d, d, 0]], [3]))).toBeCloseTo(3, 12);
  });

  test('a plane keeps its circles when the map scales it the same both ways', () => {
    expect(planeScale(scaling([0, 0, 0], [UP], [3]), UP)).toBeCloseTo(1, 12);
    expect(planeScale(scaling([0, 0, 0], [UP], [3]), RED)).toBeNull();
    expect(planeScale(scaling([0, 0, 0], [], [-2]), [0.6, 0, 0.8])).toBeCloseTo(2, 12);
  });
});

describe('scaling loose geometry', () => {
  test('a uniform scale of a whole box multiplies its volume by the cube', () => {
    const s = box();
    ok(s.execute('core.scale', { faceIds: allFaces(s), origin: [0, 0, 0], axes: [], factor: 2, sizes: [1300] }));
    valid(s);
    expect(solidVolume(root(s))).toBeCloseTo(8 * 1000 * 600 * 500, 0);
    expect(extent(s)).toEqual([0, 0, 0, 2000, 1000, 1200]);
  });

  test('a scale along one axis stretches the box that way only', () => {
    const s = box();
    ok(s.execute('core.scale', { faceIds: allFaces(s), origin: [0, 0, 0], axes: [UP], factor: 1.5, sizes: [500] }));
    valid(s);
    expect(extent(s)).toEqual([0, 0, 0, 1000, 750, 600]);
  });

  test('scaling the top face about its center tapers the box; its sides stretch', () => {
    const s = box();
    const top = listFaces(root(s)).find((f) => f.normal[1] > 0.9)!.id;
    ok(s.execute('core.scale', { faceIds: [top], origin: [500, 500, 300], axes: [RED, GREEN], factor: 0.5, factor2: 0.5, sizes: [1000, 600] }));
    valid(s);
    // A frustum of a rectangle: h/3 (A1 + A2 + sqrt(A1 A2)).
    const a1 = 1000 * 600;
    const a2 = a1 / 4;
    expect(solidVolume(root(s))).toBeCloseTo((500 / 3) * (a1 + a2 + Math.sqrt(a1 * a2)), 0);
  });

  test('a mirror keeps every face facing outward', () => {
    const s = box();
    const before = listFaces(root(s)).length;
    ok(s.execute('core.scale', { faceIds: allFaces(s), origin: [0, 0, 0], axes: [RED], factor: -1, sizes: [1000] }));
    valid(s);
    expect(solidVolume(root(s))).toBeCloseTo(1000 * 600 * 500, 0);
    expect(listFaces(root(s)).length).toBe(before);
    expect(extent(s)).toEqual([-1000, 0, 0, 0, 500, 600]);
    const left = listFaces(root(s)).find((f) => f.outer.every((p) => p[0] === -1000))!;
    expect(left.normal[0]).toBeCloseTo(-1, 12);
  });

  test('circles stay circles when their plane scales evenly, and lose their radius when it stretches', () => {
    const make = () => {
      const s = createSession();
      const c = ok(s.execute('core.drawCircle', { faceId: null, center: [0, 0, 0], radius: 300, direction: null, segments: 24 }));
      ok(s.execute('core.pushPull', { faceId: c.faceIds[0]!, distance: 400 }));
      return s;
    };
    const taller = make();
    ok(taller.execute('core.scale', { faceIds: allFaces(taller), origin: [0, 0, 0], axes: [UP], factor: 2, sizes: [400] }));
    valid(taller);
    expect(radii(root(taller))).toEqual([300, 300]);
    const wider = make();
    ok(wider.execute('core.scale', { faceIds: allFaces(wider), origin: [0, 0, 0], axes: [RED], factor: 2, sizes: [600] }));
    valid(wider);
    expect(radii(root(wider))).toEqual([undefined, undefined]);
    const bigger = make();
    ok(bigger.execute('core.scale', { faceIds: allFaces(bigger), origin: [0, 0, 0], axes: [], factor: -0.5, sizes: [500] }));
    valid(bigger);
    expect(radii(root(bigger))).toEqual([150, 150]);
  });

  test('a scale that shrinks an edge to nothing is refused', () => {
    const s = box();
    const r = s.execute('core.scale', { faceIds: allFaces(s), origin: [0, 0, 0], axes: [RED], factor: 1e-12, sizes: [1000] });
    expect(code(r)).toBe('scaleTooSmall');
  });

  test('a factor of one changes nothing; bad axes, factors and sizes are refused', () => {
    const s = box();
    const doc = s.doc;
    expect(ok(s.execute('core.scale', { faceIds: allFaces(s), origin: [0, 0, 0], axes: [], factor: 1, sizes: [1] })).faceIds.length).toBe(6);
    expect(s.doc).toBe(doc);
    const faceIds = allFaces(s);
    expect(code(s.execute('core.scale', { faceIds, origin: [0, 0, 0], axes: [], factor: 0, sizes: [1] }))).toBe('invalidInput');
    expect(code(s.execute('core.scale', { faceIds, origin: [0, 0, 0], axes: [RED, [1, 1, 0]], factor: 2, factor2: 2, sizes: [1, 1] }))).toBe('invalidInput');
    expect(code(s.execute('core.scale', { faceIds, origin: [0, 0, 0], axes: [RED], factor: 2, factor2: 2, sizes: [1] }))).toBe('invalidInput');
    expect(code(s.execute('core.scale', { faceIds, origin: [0, 0, 0], axes: [RED, UP], factor: 2, factor2: 2, sizes: [1] }))).toBe('invalidInput');
  });
});

describe('scaling groups and components', () => {
  const group = () => {
    const s = box();
    const g = ok(s.execute('core.makeGroup', { faceIds: allFaces(s) }));
    return { s, g };
  };
  const transformOf = (s: CommandSession, id: string) => findInstance(s.doc.scene, id)!.instance.transform;

  test('a group takes the scale into its transform; its geometry is unchanged', () => {
    const { s, g } = group();
    const model = s.doc.scene.definitions.get(g.definitionId)!.model;
    ok(s.execute('core.scale', { instanceIds: [g.instanceId], origin: [0, 0, 0], axes: [UP], factor: 2, sizes: [500] }));
    expect(transformOf(s, g.instanceId).scale).toEqual([1, 2, 1]);
    expect(s.doc.scene.definitions.get(g.definitionId)!.model).toBe(model);
    ok(s.execute('core.scale', { instanceIds: [g.instanceId], origin: [500, 0, 0], axes: [RED], factor: -1, sizes: [1000] }));
    const t = transformOf(s, g.instanceId);
    expect(determinant(t)).toBeCloseTo(-2, 12);
    expect(t.translation).toEqual([1000, 0, 0]);
  });

  test('a turned group scales along its own axes, and is refused along others', () => {
    const { s, g } = group();
    ok(s.execute('core.rotate', { instanceIds: [g.instanceId], center: [0, 0, 0], axis: UP, angle: 30 }));
    const own = transformOf(s, g.instanceId);
    const red = quatFromAxisAngle(UP, Math.PI / 6);
    const axis: [number, number, number] = [Math.cos(Math.PI / 6), 0, -Math.sin(Math.PI / 6)];
    expect(code(s.execute('core.scale', { instanceIds: [g.instanceId], origin: [0, 0, 0], axes: [RED], factor: 2, sizes: [1000] }))).toBe('scaleWouldSkew');
    expect(transformOf(s, g.instanceId)).toEqual(own);
    ok(s.execute('core.scale', { instanceIds: [g.instanceId], origin: [0, 0, 0], axes: [axis], factor: 2, sizes: [1000] }));
    const t = transformOf(s, g.instanceId);
    expect(t.scale.map((v) => Math.abs(v))).toEqual([2, 1, 1]);
    expect(Math.abs(t.rotation[1])).toBeCloseTo(Math.abs(red[1]), 9);
    // The same in every direction always works.
    ok(s.execute('core.scale', { instanceIds: [g.instanceId], origin: [0, 0, 0], axes: [], factor: 0.5, sizes: [1] }));
    expect(transformOf(s, g.instanceId).scale.map((v) => Math.abs(v))).toEqual([1, 0.5, 0.5]);
  });

  test('dimensions in the selection, and those attached to scaled geometry, follow', () => {
    const s = box();
    ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [1000, 0, 0], offset: [0, 0, 200] }));
    ok(s.execute('core.scale', { faceIds: allFaces(s), origin: [0, 0, 0], axes: [RED], factor: 1.5, sizes: [1000] }));
    expect(worldAnnotations(s.doc.scene).map((a) => a.length)).toEqual([1500]);
  });
});

describe('typing after a scale', () => {
  test('a plain number is a factor; a length with units scales to that size', () => {
    const s = box();
    ok(s.execute('core.scale', { faceIds: allFaces(s), origin: [0, 0, 0], axes: [RED], factor: 2, sizes: [1000] }));
    type(s, '3');
    expect(extent(s)[3]).toBe(3000);
    type(s, '1200mm');
    expect(extent(s)[3]).toBe(1200);
    type(s, '-1');
    expect(extent(s).slice(0, 4)).toEqual([-1000, 0, 0, 0]);
    valid(s);
    // Still one undo step.
    s.undo();
    expect(extent(s)[3]).toBe(1000);
  });

  test('two directions take two values; a uniform scale takes one', () => {
    const s = box();
    ok(s.execute('core.scale', { faceIds: allFaces(s), origin: [0, 0, 0], axes: [RED, UP], factor: 2, factor2: 2, sizes: [1000, 500] }));
    type(s, '0.5, 1m');
    expect(extent(s)).toEqual([0, 0, 0, 500, 1000, 600]);
    const target = s.amendTarget()!;
    const one = parseTypedValues('2', 'mm');
    expect(one.ok && matchTypedValues(target.fields, one).ok).toBe(false);
    const u = box();
    ok(u.execute('core.scale', { faceIds: allFaces(u), origin: [0, 0, 0], axes: [], factor: 2, sizes: [1000] }));
    type(u, '500mm');
    expect(extent(u)).toEqual([0, 0, 0, 500, 250, 300]);
  });

  test('plain numbers are told apart from lengths with units', () => {
    const r = parseTypedValues('2, -0.5, 600mm, 2"', 'mm');
    expect(r.ok && r.plain).toEqual([2, -0.5, null, null]);
  });
});

describe('scale grips', () => {
  const box: ScaleBox = { center: [500, 250, 300], axes: [RED, UP, GREEN], half: [500, 250, 300] };

  test('a box has 8 corners, 12 edge middles and 6 side middles; a flat one only its own 8', () => {
    const grips = boxGrips(box);
    expect(grips.length).toBe(26);
    expect(grips.filter((g) => g.corner).length).toBe(8);
    expect(grips.filter((g) => g.along.length === 2).length).toBe(12);
    const flat = boxGrips({ ...box, half: [500, 0, 300] });
    expect(flat.length).toBe(8);
    expect(flat.filter((g) => g.corner).map((g) => g.along)).toEqual([[0, 2], [0, 2], [0, 2], [0, 2]]);
  });

  test('a corner scales evenly along its diagonal; a side along its axis; Ctrl about the center', () => {
    const grips = boxGrips(box);
    const corner = grips.find((g) => g.signs.join() === '1,1,1')!;
    expect(corner.opposite).toEqual([0, 0, 0]);
    expect(gripFactors(box, corner, [2000, 1000, 1200], true, false)).toEqual([2]);
    expect(gripFactors(box, corner, [2000, 500, 600], false, false)).toEqual([2, 1, 1]);
    const side = grips.find((g) => g.signs.join() === '0,1,0')!;
    expect(gripFactors(box, side, [123, 750, 45], false, false)).toEqual([1.5]);
    expect(gripFactors(box, side, [0, 750, 0], false, true)).toEqual([2]);
    // Past the fixed grip: a mirror.
    expect(gripFactors(box, side, [0, -500, 0], false, false)).toEqual([-1]);
  });
});
