import { describe, expect, test } from 'vitest';
import { createSession, definitionModel, matchTypedValues, type CommandSession } from '../src/commands';
import { checkModel, faceArea, listEdges, listFaces, previewArc, serialize, solidVolume, threePointArc, twoPointArc, type Model } from '../src/kernel';
import { parseTypedValues } from '../src/units';
import { arcRun } from './helpers/randomArcs';

/* Arcs and pies (milestone 4, step 11): kernel geometry, commands, amend, and a rounded panel. Sizes in mm. */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

/** Type into the measurements box after a command, as the app does. */
function type(s: CommandSession, text: string) {
  const target = s.amendTarget()!;
  const parsed = parseTypedValues(text, s.doc.units.unit);
  if (!parsed.ok) throw new Error(`could not parse ${text}`);
  const matched = matchTypedValues(target.fields, parsed);
  if (!matched.ok) throw new Error(matched.error.code);
  return ok(s.amend(matched.value));
}

const root = (s: CommandSession): Model => definitionModel(s.doc)!;
const valid = (s: CommandSession) => expect(checkModel(root(s))).toEqual([]);
const curves = (m: Model) => Object.values(serialize(m).curves);
const near = (a: readonly number[], b: readonly number[], tol = 1e-6) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
const UP: [number, number, number] = [0, 1, 0];
/** A fan of `segments` triangles from the center over an arc of radius r through angle a: the area a drawn arc encloses with its center. */
const fan = (r: number, a: number, segments: number) => 0.5 * r * r * Math.sin(a / segments) * segments;

describe('arc geometry', () => {
  test('a bulge of half the chord is a half circle, its middle at the bulge', () => {
    const arc = twoPointArc(UP, [0, 0, 0], [1000, 0, 0], 500)!;
    expect(arc.radius).toBeCloseTo(500, 9);
    expect(near(arc.center, [500, 0, 0])).toBe(true);
    expect(Math.abs(arc.sweep)).toBeCloseTo(Math.PI, 9);
    const pts = previewArc(UP, arc.center, [0, 0, 0], arc.sweep, 2);
    // Positive bulge: to the left of start-to-end seen from above, which is -z here.
    expect(near(pts[1]!, [500, 0, -500])).toBe(true);
    expect(near(pts[2]!, [1000, 0, 0])).toBe(true);
  });

  test('a small bulge gives the smaller arc, a large one the larger; a radius picks the same arcs', () => {
    const minor = twoPointArc(UP, [0, 0, 0], [1000, 0, 0], -100)!;
    expect(minor.radius).toBeCloseTo(1300, 9);
    expect(Math.abs(minor.sweep)).toBeLessThan(Math.PI);
    const major = twoPointArc(UP, [0, 0, 0], [1000, 0, 0], 900)!;
    expect(Math.abs(major.sweep)).toBeGreaterThan(Math.PI);
    const byRadius = twoPointArc(UP, [0, 0, 0], [1000, 0, 0], -1, 1300)!;
    expect(near(byRadius.center, minor.center)).toBe(true);
    expect(byRadius.sweep).toBeCloseTo(minor.sweep, 9);
    expect(twoPointArc(UP, [0, 0, 0], [1000, 0, 0], 1, 400)).toBeNull();
    expect(twoPointArc(UP, [0, 0, 0], [1000, 0, 0], 0)).toBeNull();
  });

  test('three points give the arc through them, turning from the first past the second to the third', () => {
    const arc = threePointArc([0, 0, 0], [500, 0, -500], [1000, 0, 0])!;
    expect(near(arc.center, [500, 0, 0])).toBe(true);
    expect(arc.radius).toBeCloseTo(500, 9);
    expect(arc.sweep).toBeCloseTo(Math.PI, 9);
    const pts = previewArc(arc.normal, arc.center, [0, 0, 0], arc.sweep, 4);
    expect(near(pts[2]!, [500, 0, -500])).toBe(true);
    expect(threePointArc([0, 0, 0], [1, 0, 0], [2, 0, 0])).toBeNull();
  });
});

describe('arc commands', () => {
  test('an arc on its own is one curve with a radius, and no face', () => {
    const s = createSession();
    const out = ok(s.execute('core.drawArc', { faceId: null, start: [0, 0, 0], end: [1000, 0, 0], bulge: 300, segments: 12 }));
    valid(s);
    expect(out.faceIds).toEqual([]);
    expect(listEdges(root(s)).length).toBe(12);
    const [c] = curves(root(s));
    expect(c!.kind).toBe('arc');
    expect(c!.edges.length).toBe(12);
    expect(c!.radius).toBeCloseTo((500 * 500 + 300 * 300) / 600, 6);
  });

  test('a pie is a face of the arc and its two radii', () => {
    const s = createSession();
    const out = ok(s.execute('core.drawPie', { faceId: null, center: [0, 0, 0], start: [400, 0, 0], angle: 90, segments: 6 }));
    valid(s);
    expect(out.faceIds.length).toBe(1);
    expect(faceArea(root(s), out.faceIds[0]!)).toBeCloseTo(fan(400, Math.PI / 2, 6), 3);
    expect(listFaces(root(s))[0]!.normal).toEqual(UP);
    // Only the arc is the curve; the radii are plain edges.
    expect(curves(root(s))[0]!.edges.length).toBe(6);
  });

  test('an arc across a face splits it', () => {
    const s = createSession();
    const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 1000, depth: 1000 }));
    const out = ok(s.execute('core.drawArcCenter', { faceId: r.faceIds[0]!, center: [0, 0, 0], start: [500, 0, 0], angle: -90, segments: 12 }));
    valid(s);
    expect(listFaces(root(s)).length).toBe(2);
    // The larger piece keeps the face's id.
    expect(out.faceIds.length).toBe(1);
    const areas = listFaces(root(s)).map((f) => faceArea(root(s), f.id)).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(fan(500, Math.PI / 2, 12), 3);
    expect(areas[0]! + areas[1]!).toBeCloseTo(1000 * 1000, 3);
  });

  test('typing segments, a radius, then a bulge amends a 2-point arc', () => {
    const s = createSession();
    ok(s.execute('core.drawArc', { faceId: null, start: [0, 0, 0], end: [1000, 0, 0], bulge: 300, segments: 12 }));
    type(s, '24s');
    expect(curves(root(s))[0]!.edges.length).toBe(24);
    type(s, '600mmr');
    expect(curves(root(s))[0]!.radius).toBeCloseTo(600, 6);
    expect(s.amendTarget()!.input.radius).toBe(600);
    type(s, '500mm');
    expect(curves(root(s))[0]!.radius).toBeCloseTo(500, 6);
    expect(s.amendTarget()!.input.radius).toBeUndefined();
    valid(s);
    s.undo();
    expect(listEdges(root(s)).length).toBe(0);
  });

  test('typing an angle amends an arc around a center; a pie too', () => {
    const s = createSession();
    ok(s.execute('core.drawPie', { faceId: null, center: [0, 0, 0], start: [400, 0, 0], angle: 90, segments: 6 }));
    type(s, '180');
    const f = listFaces(root(s))[0]!;
    expect(faceArea(root(s), f.id)).toBeCloseTo(fan(400, Math.PI, 6), 3);
    type(s, '12s');
    expect(curves(root(s))[0]!.edges.length).toBe(12);
    valid(s);
  });

  test('too small a radius, no angle, a full turn and too few segments are refused', () => {
    const s = createSession();
    const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error!.code);
    expect(code(s.execute('core.drawArc', { faceId: null, start: [0, 0, 0], end: [1000, 0, 0], bulge: 1, radius: 400, segments: 12 }))).toBe('arcRadiusTooSmall');
    expect(code(s.execute('core.drawArcCenter', { faceId: null, center: [0, 0, 0], start: [400, 0, 0], angle: 0, segments: 12 }))).toBe('tooSmall');
    expect(code(s.execute('core.drawArcCenter', { faceId: null, center: [0, 0, 0], start: [400, 0, 0], angle: 360, segments: 12 }))).toBe('tooSmall');
    expect(code(s.execute('core.drawPie', { faceId: null, center: [0, 0, 0], start: [400, 0, 0], angle: 90, segments: 1 }))).toBe('invalidInput');
  });

  test('radii are typed with an r', () => {
    const r = parseTypedValues('300mmr, 12"r, 50r, 24s', 'mm');
    if (!r.ok) throw new Error('parse');
    expect([r.counts, r.lengths]).toEqual([[24], []]);
    [300, 304.8, 50].forEach((v, i) => expect(r.radii[i]).toBeCloseTo(v, 9));
  });
});

describe('a rounded panel', () => {
  // A 600 x 400 rectangle with its corners rounded by 50 mm arcs of 12 segments.
  const R = 50;
  const build = () => {
    const s = createSession();
    ok(s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 600, depth: 400 }));
    for (const [x, z] of [
      [0, 0],
      [600, 0],
      [600, 400],
      [0, 400],
    ] as const) {
      const sx = x === 0 ? 1 : -1;
      const sz = z === 0 ? 1 : -1;
      const center: [number, number, number] = [x + sx * R, 0, z + sz * R];
      const start: [number, number, number] = [center[0], 0, z];
      const end: [number, number, number] = [x, 0, center[2]];
      // Counter-clockwise about up when turning from start to end does so.
      const turn = (start[2] - center[2]) * (end[0] - center[0]) - (start[0] - center[0]) * (end[2] - center[2]);
      const face = listFaces(root(s)).find((f) => f.outer.some((p) => near(p, [x, 0, z])))!.id;
      ok(s.execute('core.drawArcCenter', { faceId: face, center, start, angle: turn > 0 ? 90 : -90, segments: 12 }));
      valid(s);
    }
    // The eight short pieces of the rectangle's sides that run into the corners.
    const pieces = listEdges(root(s)).filter((e) => !e.curve && Math.abs(Math.hypot(e.a[0] - e.b[0], e.a[2] - e.b[2]) - R) < 1e-6);
    expect(pieces.length).toBe(8);
    ok(s.execute('core.erase', { faceIds: [], edgeIds: pieces.map((e) => e.id) }));
    valid(s);
    return s;
  };
  const area = 600 * 400 - 4 * (R * R - fan(R, Math.PI / 2, 12));

  test('rounding the corners leaves one face with four arcs', () => {
    const s = build();
    const faces = listFaces(root(s));
    expect(faces.length).toBe(1);
    expect(faceArea(root(s), faces[0]!.id)).toBeCloseTo(area, 3);
    expect(curves(root(s)).map((c) => [c.kind, c.radius])).toEqual(Array(4).fill(['arc', R]));
  });

  test('pushed up 18 mm it is a solid with soft walls along the arcs', () => {
    const s = build();
    ok(s.execute('core.pushPull', { faceId: listFaces(root(s))[0]!.id, distance: 18 }));
    valid(s);
    expect(solidVolume(root(s))).toBeCloseTo(area * 18, 1);
    // Between the 12 walls of each arc: 11 soft edges.
    const soft = listEdges(root(s)).filter((e) => e.soft && Math.abs(e.a[1] - e.b[1]) === 18);
    expect(soft.length).toBe(44);
  });

  test('an offset keeps the arcs, with smaller radii', () => {
    const s = build();
    ok(s.execute('core.offset', { faceId: listFaces(root(s))[0]!.id, distance: 10 }));
    valid(s);
    const radii = curves(root(s))
      .map((c) => c.radius!)
      .sort((a, b) => a - b);
    expect(radii.length).toBe(8);
    radii.slice(0, 4).forEach((r) => expect(r).toBeCloseTo(R - 10 / Math.cos(Math.PI / 4 / 12), 6));
  });
});

describe('random arcs', () => {
  // A few seeds here; the long sweep is in tests/stress.
  test.each([1, 2, 3, 4, 5, 6, 7, 8])('arcs and pies among rectangles and push/pulls keep the model valid (seed %i)', (seed) => {
    // Most of the drawing succeeds: the run is not just refusals.
    expect(curves(root(arcRun(seed, 20))).length).toBeGreaterThan(2);
  });
});
