import { validateBytes } from 'gltf-validator';
import { Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { createSession, definitionModel, type CommandSession } from '../src/commands';
import { exportGlb, worldTriangles } from '../src/export';
import { checkModel, createModel, deserialize, drawRegularPolygon, edgeCount, faceCount, listFaces, pushPull, serialize, solidVolume, transformGeometry, type Model } from '../src/kernel';
import {
  affineOf,
  applyNormal,
  applyPoint,
  compose,
  decompose,
  definitionBounds,
  determinant,
  findInstance,
  invert,
  multiply,
  putInstance,
  quatFromAxisAngle,
  rotationAbout,
  worldSnapPoints,
  type Transform,
} from '../src/scene';
import { Frame } from '../src/viewport/frame';

/* Scaled and mirrored instances (milestone 4): affine maps, placement, explode, export. All sizes in mm. */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

const near = (a: readonly number[], b: readonly number[], tol = 1e-9) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
const turn = (deg: number, axis: [number, number, number] = [0, 1, 0]) => quatFromAxisAngle(axis, (deg * Math.PI) / 180);
const trs = (rotation: Transform['rotation'], translation: [number, number, number], scale: [number, number, number]): Transform => ({ rotation, translation, scale });

/** A 1000 x 600 x 500 box made into a group; returns the session and the group. */
function boxGroup() {
  const s = createSession();
  const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 1000, depth: 600 }));
  ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: 500 }));
  const g = ok(s.execute('core.makeGroup', { faceIds: listFaces(definitionModel(s.doc)!).map((f) => f.id) }));
  return { s, g };
}

/** The session's document with an instance's scale (and rotation) set, as Scale and Flip will. */
function scaled(s: CommandSession, instanceId: string, scale: [number, number, number], rotation?: Transform['rotation']): CommandSession {
  const { instance, parent } = findInstance(s.doc.scene, instanceId)!;
  const transform = { ...instance.transform, scale, ...(rotation ? { rotation } : {}) };
  return createSession({ ...s.doc, scene: putInstance(s.doc.scene, parent.id, { ...instance, transform }) });
}

/** Signed volume enclosed by triangles: positive when they all face outward. */
const signedVolume = (tris: readonly (readonly number[])[][]) =>
  tris.reduce((sum, [a, b, c]) => sum + (a![0]! * (b![1]! * c![2]! - b![2]! * c![1]!) - a![1]! * (b![0]! * c![2]! - b![2]! * c![0]!) + a![2]! * (b![0]! * c![1]! - b![1]! * c![0]!)), 0) / 6;

describe('affine maps', () => {
  const t = trs(turn(30), [100, 200, -50], [2, -1, 0.5]);

  test('a transform as an affine map places points the same way', () => {
    const p: [number, number, number] = [3, 4, 5];
    expect(near(applyPoint(affineOf(t), p), applyPoint(t, p))).toBe(true);
    expect(determinant(t)).toBeCloseTo(-1, 12);
    expect(determinant(affineOf(t))).toBeCloseTo(-1, 12);
  });

  test('multiply, then invert, gives back every point', () => {
    const u = trs(turn(-70, [1, 0, 0]), [5, 6, 7], [1, 3, 1]);
    const both = multiply(t, u);
    const p: [number, number, number] = [11, -2, 9];
    expect(near(applyPoint(both, p), applyPoint(t, applyPoint(u, p)), 1e-9)).toBe(true);
    expect(near(applyPoint(invert(both), applyPoint(both, p)), p, 1e-9)).toBe(true);
  });

  test('a scaled or mirrored transform decomposes back; a skewed product does not', () => {
    const back = decompose(affineOf(t))!;
    const p: [number, number, number] = [1, 2, 3];
    expect(near(applyPoint(back, p), applyPoint(t, p), 1e-9)).toBe(true);
    // A stretch along red holding something turned about blue: its corners are no longer square.
    const skewed = multiply(trs([0, 0, 0, 1], [0, 0, 0], [2, 1, 1]), trs(turn(45), [0, 0, 0], [1, 1, 1]));
    expect(decompose(skewed)).toBeNull();
  });

  test('compose matches multiply for a uniformly scaled or rigid parent', () => {
    const parent = trs(turn(90), [10, 0, 0], [-2, -2, -2]);
    const child = trs(turn(30, [1, 0, 0]), [1, 2, 3], [1, 4, -1]);
    const p: [number, number, number] = [7, 8, 9];
    expect(near(applyPoint(compose(parent, child), p), applyPoint(multiply(parent, child), p), 1e-9)).toBe(true);
  });

  test('a stretched face normal stays square to the face', () => {
    const s = trs(turn(20), [0, 0, 0], [3, 1, 1]);
    // A face through (0,0,0), (1,0,-1) and (0,1,0): normal (1, 0, 1) / sqrt 2.
    const n = applyNormal(s, [Math.SQRT1_2, 0, Math.SQRT1_2]);
    for (const q of [[1, 0, -1] as const, [0, 1, 0] as const]) {
      const v = applyPoint(s, q);
      expect(Math.abs(n[0] * v[0] + n[1] * v[1] + n[2] * v[2])).toBeLessThan(1e-12);
    }
    expect(Math.hypot(...n)).toBeCloseTo(1, 12);
  });

  test('a frame inside a scaled group converts points, directions and normals both ways', () => {
    const world = multiply(trs(turn(30), [500, 0, 0], [2, 1, -1]), trs([0, 0, 0, 1], [0, 0, 0], [1, 1, 1]));
    const f = new Frame('d2', world);
    const p = f.toWorld([100, 50, 25]);
    expect(near(f.toLocal(p), [100, 50, 25], 1e-6)).toBe(true);
    // Lengths inside the group are its own: stretched twice along red, 10 local mm are 20 world mm.
    expect(f.dirToWorld([10, 0, 0]).length()).toBeCloseTo(20, 9);
    expect(near(f.dirToLocal(f.dirToWorld([10, 0, 0])), [10, 0, 0], 1e-9)).toBe(true);
    const n = f.normalToWorld([0, 1, 0]);
    expect(near(f.normalToLocal(new Vector3(n.x, n.y, n.z)), [0, 1, 0], 1e-9)).toBe(true);
  });
});

describe('placing geometry with a scale', () => {
  function cylinder(): Model {
    const r = drawRegularPolygon(createModel(), { kind: 'circle', faceId: null, center: [0, 0, 0], radius: 300, segments: 24 });
    if (!r.ok) throw new Error(r.error);
    return pushPull(r.model, r.faceIds[0]!, 400).model;
  }

  test('a mirror keeps every face facing outward and the solid valid', () => {
    const m = cylinder();
    const T = trs([0, 0, 0, 1], [0, 0, 0], [-1, 1, 1]);
    const placed = transformGeometry(m, (p) => applyPoint(T, p), (n) => applyNormal(T, n), { mirror: true, radiusScale: 1 });
    expect(checkModel(placed)).toEqual([]);
    expect(solidVolume(placed)).toBeCloseTo(solidVolume(m)!, 3);
    expect([faceCount(placed), edgeCount(placed)]).toEqual([faceCount(m), edgeCount(m)]);
  });

  test('a uniform scale scales curve radii; a stretch drops them and scales the volume', () => {
    const m = cylinder();
    const twice = trs([0, 0, 0, 1], [0, 0, 0], [2, 2, 2]);
    const big = transformGeometry(m, (p) => applyPoint(twice, p), (n) => applyNormal(twice, n), { radiusScale: 2 });
    const radii = (x: Model) => Object.values(serialize(x).curves).map((c) => c.radius);
    expect(radii(m)).toEqual([300, 300]);
    expect(radii(big)).toEqual([600, 600]);
    expect(solidVolume(big)).toBeCloseTo(solidVolume(m)! * 8, 0);
    const stretch = trs([0, 0, 0, 1], [0, 0, 0], [3, 1, 1]);
    const oval = transformGeometry(m, (p) => applyPoint(stretch, p), (n) => applyNormal(stretch, n), { radiusScale: null });
    expect(checkModel(oval)).toEqual([]);
    expect(solidVolume(oval)).toBeCloseTo(solidVolume(m)! * 3, 0);
    expect(radii(oval)).toEqual([undefined, undefined]);
    // A curve without a radius is saved and opened as one.
    const reopened = deserialize(JSON.parse(JSON.stringify(serialize(oval))))!;
    expect(checkModel(reopened)).toEqual([]);
    expect(radii(reopened)).toEqual([undefined, undefined]);
    expect(Object.keys(serialize(oval).curves).length).toBe(2);
  });
});

describe('scaled and mirrored instances', () => {
  test('snap points, bounds and the volume follow the scale', () => {
    const { s, g } = boxGroup();
    const t = scaled(s, g.instanceId, [2, 1, -1]);
    const corners = worldSnapPoints(t.doc.scene).filter((p) => p.kind === 'end' && p.path.length === 1);
    expect(corners.some((c) => near(c.point, [2000, 500, -600]))).toBe(true);
    const b = definitionBounds(t.doc.scene, t.doc.scene.rootId)!;
    expect([...b.min, ...b.max]).toEqual([0, 0, -600, 2000, 500, 0]);
    const def = t.doc.scene.definitions.get(g.definitionId)!;
    expect(solidVolume(def.model)! * Math.abs(determinant(findInstance(t.doc.scene, g.instanceId)!.instance.transform))).toBeCloseTo(2 * 1000 * 600 * 500, 0);
  });

  test('exploding a mirrored group keeps its faces facing outward', () => {
    const { s, g } = boxGroup();
    const t = scaled(s, g.instanceId, [-1, 1, 1]);
    ok(t.execute('core.explode', { instanceIds: [g.instanceId] }));
    const m = definitionModel(t.doc)!;
    expect(checkModel(m)).toEqual([]);
    expect(solidVolume(m)).toBeCloseTo(1000 * 600 * 500, 0);
    const right = listFaces(m).find((f) => f.normal[0] < -0.9)!;
    expect(right.outer.every((p) => p[0] === -1000)).toBe(true);
  });

  test('exploding a stretched group scales its geometry and the groups inside', () => {
    const { s, g } = boxGroup();
    const inner = ok(s.execute('core.makeGroup', { instanceIds: [g.instanceId] }));
    const t = scaled(s, inner.instanceId, [1, 2, 1]);
    const out = ok(t.execute('core.explode', { instanceIds: [inner.instanceId] }));
    const child = findInstance(t.doc.scene, out.instanceIds[0]!)!.instance;
    expect(near(child.transform.scale, [1, 2, 1])).toBe(true);
    expect(definitionBounds(t.doc.scene, t.doc.scene.rootId)!.max).toEqual([1000, 1000, 600]);
  });

  test('exploding a stretched group holding a turned one is refused rather than skewing it', () => {
    const { s, g } = boxGroup();
    ok(s.execute('core.rotate', { instanceIds: [g.instanceId], center: [0, 0, 0], axis: [0, 1, 0], angle: 30 }));
    const outer = ok(s.execute('core.makeGroup', { instanceIds: [g.instanceId] }));
    const t = scaled(s, outer.instanceId, [2, 1, 1]);
    const r = t.execute('core.explode', { instanceIds: [outer.instanceId] });
    expect(r.ok ? null : r.error.code).toBe('explodeWouldSkew');
    // Uniform scale and turned children are fine.
    const u = scaled(s, outer.instanceId, [2, 2, 2]);
    expect(u.execute('core.explode', { instanceIds: [outer.instanceId] }).ok).toBe(true);
  });

  test('moving and turning a scaled instance keeps its scale', () => {
    const { s, g } = boxGroup();
    const t = scaled(s, g.instanceId, [-1, 2, 1]);
    ok(t.execute('core.rotate', { instanceIds: [g.instanceId], center: [0, 0, 0], axis: [0, 1, 0], angle: 90 }));
    ok(t.execute('core.move', { instanceIds: [g.instanceId], direction: [1, 0, 0], distance: 100 }));
    expect(findInstance(t.doc.scene, g.instanceId)!.instance.transform.scale).toEqual([-1, 2, 1]);
    expect(definitionBounds(t.doc.scene, t.doc.scene.rootId)!.max[1]).toBe(1000);
  });

  test('a mirrored instance exports outward-facing STL triangles and a valid GLB', async () => {
    const { s, g } = boxGroup();
    const t = scaled(s, g.instanceId, [-1, 1, 1]);
    expect(signedVolume(worldTriangles(t.doc.scene))).toBeCloseTo(1000 * 600 * 500, 0);
    const stretched = scaled(s, g.instanceId, [1, 1, -2], rotationAbout([0, 0, 0], [0, 1, 0], 0.4).rotation);
    expect(signedVolume(worldTriangles(stretched.doc.scene))).toBeCloseTo(2 * 1000 * 600 * 500, 0);
    const report = await validateBytes(exportGlb(stretched.doc.scene, 'Mirrored'));
    expect(report.issues.numErrors).toBe(0);
    expect(report.issues.numWarnings).toBe(0);
    const json = JSON.parse(new TextDecoder().decode(exportGlb(t.doc.scene).slice(20, 20 + new DataView(exportGlb(t.doc.scene).buffer).getUint32(12, true))));
    expect(json.nodes.some((n: { scale?: number[] }) => n.scale?.join() === '-1,1,1')).toBe(true);
  });
});
