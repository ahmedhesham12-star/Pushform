import { Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { createSession, definitionModel, type CommandSession } from '../src/commands';
import { checkModel, faceArea, listEdges, listFaces, solidVolume, type Model } from '../src/kernel';
import { createCenterArcTool, createThreePointArcTool, createTwoPointArcTool } from '../src/tools/arc';
import { createRectangleTool } from '../src/tools/rectangle';
import type { Tool, ToolContext } from '../src/tools/tool';
import { Frame } from '../src/viewport/frame';

/*
 * Arc regions on a box's top pushed down through it (checkpoint (c)): they cut
 * a through-hole or a through-notch with soft walls, as rectangles and circles
 * do. Pushed the full height they cut through; pushed further they stop there.
 * The box is 1000 x 1000 x 500 mm; its front face is at z 1000.
 */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

const H = 500;
const root = (s: CommandSession): Model => definitionModel(s.doc)!;
const tops = (s: CommandSession) => listFaces(root(s)).filter((f) => f.normal[1] === 1 && f.outer.every((p) => p[1] === H));
const faceWith = (s: CommandSession, normal: [number, number, number]) => listFaces(root(s)).find((f) => f.normal.every((v, i) => v === normal[i]))!.id;

function box() {
  const s = createSession();
  const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 1000, depth: 1000 }));
  ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: H }));
  return s;
}

/** Push the smaller of the two top faces down by `depth` and check it cut through, with `soft` soft walls between curved segments. */
function pushThrough(s: CommandSession, depth: number, soft: number) {
  const top = tops(s);
  expect(top.length).toBe(2);
  const region = top.reduce((a, b) => (faceArea(root(s), a.id) < faceArea(root(s), b.id) ? a : b));
  const area = faceArea(root(s), region.id);
  const before = solidVolume(root(s))!;
  const softBefore = listEdges(root(s)).filter((e) => e.soft).length;
  const out = ok(s.execute('core.pushPull', { faceId: region.id, distance: -depth }));
  expect(out.distance).toBeCloseTo(-H, 9);
  expect(checkModel(root(s))).toEqual([]);
  expect(listFaces(root(s)).some((f) => f.id === region.id)).toBe(false);
  expect(solidVolume(root(s))).toBeCloseTo(before - area * H, 3);
  // Only the top and the bottom are left facing up or down: nothing covers the hole.
  expect(listFaces(root(s)).filter((f) => Math.abs(f.normal[1]) === 1).length).toBe(2);
  expect(listEdges(root(s)).filter((e) => e.soft).length - softBefore).toBe(soft);
}

const top = (s: CommandSession) => tops(s)[0]!.id;
const drawings: [string, number, (s: CommandSession) => void][] = [
  ['a 2-point arc from one edge to the same edge', 11, (s) => void ok(s.execute('core.drawArc', { faceId: top(s), start: [300, H, 0], end: [700, H, 0], bulge: -200, segments: 12 }))],
  ['a 2-point arc cutting a corner off', 11, (s) => void ok(s.execute('core.drawArc', { faceId: top(s), start: [0, H, 300], end: [300, H, 0], bulge: -60, segments: 12 }))],
  [
    'an arc and a line inside the face',
    11,
    (s) => {
      ok(s.execute('core.drawArc', { faceId: top(s), start: [300, H, 500], end: [700, H, 500], bulge: -200, segments: 12 }));
      ok(s.execute('core.drawLine', { start: [300, H, 500], direction: [1, 0, 0], length: 400 }));
    },
  ],
  ['a pie inside the face', 11, (s) => void ok(s.execute('core.drawPie', { faceId: top(s), center: [500, H, 500], start: [800, H, 500], angle: 90, segments: 12 }))],
  ['an arc from a center, from one edge to the same edge', 11, (s) => void ok(s.execute('core.drawArcCenter', { faceId: top(s), center: [500, H, 0], start: [700, H, 0], angle: -180, segments: 12 }))],
  ['an arc from a center cutting a corner off', 11, (s) => void ok(s.execute('core.drawArcCenter', { faceId: top(s), center: [0, H, 0], start: [300, H, 0], angle: -90, segments: 12 }))],
  ['a rectangle inside the face', 0, (s) => void ok(s.execute('core.drawRectangle', { faceId: top(s), corner: [300, H, 300], width: 400, depth: 400 }))],
];

describe('arc regions pushed through a box (commands)', () => {
  for (const [name, soft, draw] of drawings)
    test.each([H, H + 300])(`${name}, pushed %i mm`, (depth) => {
      const s = box();
      draw(s);
      expect(checkModel(root(s))).toEqual([]);
      pushThrough(s, depth, soft);
    });
});

/*
 * The tools, with a stand-in viewport. Over the box's top front edge the pick
 * ray hits the front face first, as it did in the app: a shape started there
 * used to be drawn on the front face, so the top was never split and nothing
 * cut through.
 */

interface Under {
  face: { faceId: string; normal: Vector3; point: Vector3 };
  edge?: { point: Vector3; a: Vector3; b: Vector3 };
}

/** Looking down at the box from the front right. */
const VIEW = new Vector3(-1, -2, -1.5).normalize();
const SU = new Vector3(1, 0, 0).cross(VIEW).normalize();
const SV = VIEW.clone().cross(SU);

function toolContext(s: CommandSession) {
  let under: Under | null = null;
  let tool: Tool | null = null;
  const pointer = () => under!.edge?.point ?? under!.face.point;
  const viewport = {
    frame: Frame.ROOT,
    planeUnderCursor: () => (under ? { faceId: under.face.faceId, onFace: true, normal: under.face.normal.clone(), point: under.face.point.clone() } : null),
    nearestSnap: () => null,
    pickEdge: () => (under?.edge ? { edgeId: 'e', path: [], relation: 'context', point: under.edge.point.clone(), a: under.edge.a.clone(), b: under.edge.b.clone() } : null),
    pickGuide: () => null,
    axisInference: () => null,
    axisDirection: () => new Vector3(1, 0, 0),
    closestOnLine: () => null,
    gridPoint: (_p: Vector3, _n: Vector3, raw: Vector3) => raw.clone(),
    picker: {
      // The line of sight through the pointer, met with the plane.
      rayPlane: (origin: Vector3, n: Vector3) => {
        const d = VIEW.dot(n);
        return Math.abs(d) < 1e-9 ? null : pointer().clone().addScaledVector(VIEW, origin.clone().sub(pointer()).dot(n) / d);
      },
      toScreen: (p: Vector3) => ({ x: p.dot(SU), y: p.dot(SV), z: 0 }),
    },
    showMarker: () => {},
    hideMarker: () => {},
    showGuides: () => {},
    showShapePreview: () => {},
    clearPreview: () => {},
  };
  const ctx = {
    session: s,
    viewport,
    units: () => s.doc.units,
    setMeasurement: () => {},
    hint: () => {},
    flash: () => {},
    flashError: (e: { code: string }) => {
      throw new Error(e.code);
    },
    cancel: () => tool?.reset(),
  } as unknown as ToolContext;
  return {
    ctx,
    use: (t: Tool) => (tool = t),
    /** Move the pointer over something, then click there when `click`. */
    at(u: Under, click = true) {
      under = u;
      tool!.move?.(undefined as never);
      if (click) tool!.down?.(undefined as never);
    },
  };
}

const UP = new Vector3(0, 1, 0);
const FRONT = new Vector3(0, 0, 1);

function scene() {
  const s = box();
  const front = faceWith(s, [0, 0, 1]);
  const topId = faceWith(s, [0, 1, 0]);
  /** On the top front edge at x: the front face is what the pick ray hits. */
  const onEdge = (x: number): Under => ({ face: { faceId: front, normal: FRONT, point: new Vector3(x, H, 1000) }, edge: { point: new Vector3(x, H, 1000), a: new Vector3(0, H, 1000), b: new Vector3(1000, H, 1000) } });
  const onTop = (x: number, z: number): Under => ({ face: { faceId: topId, normal: UP, point: new Vector3(x, H, z) } });
  const onFront = (x: number, y: number): Under => ({ face: { faceId: front, normal: FRONT, point: new Vector3(x, y, 1000) } });
  return { s, front, top: topId, onEdge, onTop, onFront, ...toolContext(s) };
}

describe('shapes started on an edge are drawn on the face the pointer is over', () => {
  test.each([H, H + 300])('a 2-point arc from the top edge to itself, bulging over the top, cuts through (%i mm)', (depth) => {
    const t = scene();
    t.use(createTwoPointArcTool(t.ctx));
    t.at(t.onEdge(300));
    t.at(t.onEdge(700));
    t.at(t.onTop(500, 800));
    expect(t.s.amendTarget()!.input.faceId).toBe(t.top);
    pushThrough(t.s, depth, 11);
  });

  test.each([H, H + 300])('an arc from a center on the top edge, ending on it, cuts through (%i mm)', (depth) => {
    const t = scene();
    t.use(createCenterArcTool(t.ctx, false));
    t.at(t.onEdge(500));
    t.at(t.onEdge(700));
    t.at(t.onTop(600, 850), false);
    t.at(t.onTop(500, 800), false);
    t.at(t.onTop(400, 850), false);
    t.at(t.onEdge(300));
    expect(t.s.amendTarget()!.input).toMatchObject({ faceId: t.top, angle: 180 });
    pushThrough(t.s, depth, 11);
  });

  test.each([H, H + 300])('a 3-point arc from the top edge to itself cuts through (%i mm)', (depth) => {
    const t = scene();
    t.use(createThreePointArcTool(t.ctx));
    t.at(t.onEdge(300));
    t.at(t.onTop(500, 800));
    t.at(t.onEdge(700));
    expect(t.s.amendTarget()!.input.faceId).toBe(t.top);
    pushThrough(t.s, depth, 11);
  });

  test.each([H, H + 300])('a rectangle from the top edge cuts a through-notch (%i mm)', (depth) => {
    const t = scene();
    t.use(createRectangleTool(t.ctx));
    t.at(t.onEdge(300));
    t.at(t.onTop(700, 800));
    pushThrough(t.s, depth, 0);
  });

  test('over the front face instead, the arc is drawn on the front face', () => {
    const t = scene();
    t.use(createTwoPointArcTool(t.ctx));
    t.at(t.onEdge(300));
    t.at(t.onEdge(700));
    t.at(t.onFront(500, 300));
    expect(t.s.amendTarget()!.input.faceId).toBe(t.front);
    expect(checkModel(root(t.s))).toEqual([]);
    expect(tops(t.s).length).toBe(1);
  });

  test('started inside a face, the plane stays that face', () => {
    const t = scene();
    t.use(createTwoPointArcTool(t.ctx));
    t.at(t.onTop(300, 700));
    t.at(t.onTop(700, 700));
    t.at(t.onFront(500, 300));
    expect(t.s.amendTarget()!.input.faceId).toBe(t.top);
  });
});
