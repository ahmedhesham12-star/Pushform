import { Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { createSession, definitionModel } from '../src/commands';
import { checkModel, listFaces, previewRectangle, rectangleAxes, type Vec3 } from '../src/kernel';
import { compose, findInstance, rotationAbout, translation, type Transform } from '../src/scene';
import { alignment, misaligned, rectangleInput } from '../src/tools/rectangleGeometry';
import { Frame } from '../src/viewport/frame';

/* All sizes in mm. */

const near = (a: readonly number[], b: readonly number[], tol = 1e-6) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
const up = new Vector3(0, 1, 0);
const deg = (d: number) => (d * Math.PI) / 180;

describe('inside a turned group, drawing follows the group axes', () => {
  // A group turned 30 degrees about blue and moved: its red axis points along (cos 30, 0, -sin 30) in the world.
  const world: Transform = compose(translation([2000, 0, 500]), rotationAbout([0, 0, 0], [0, 1, 0], deg(30)));
  const frame = new Frame('d2', world);
  const red = frame.dirToWorld([1, 0, 0]);
  const green = frame.dirToWorld([0, 0, 1]);

  test('a rectangle dragged along the group red axis has a width and no depth, and its corners follow the group axes', () => {
    const start = frame.toWorld([100, 0, 100]);
    const current = start.clone().addScaledVector(red, 600).addScaledVector(green, 400);
    const r = rectangleInput(frame, { normal: up, start, current, axis: null });
    expect(r.axis).toBeNull();
    expect(r.width).toBeCloseTo(600, 6);
    expect(r.depth).toBeCloseTo(400, 6);
    const corners = previewRectangle(r.normal, r.corner, r.width, r.depth, r.axis).map((p) => frame.toWorld(p));
    // The first side runs along the group's red axis, not the world's.
    const side = corners[1]!.clone().sub(corners[0]!).normalize();
    expect(near(side.toArray(), red.toArray())).toBe(true);
    expect(Math.abs(side.x - 1)).toBeGreaterThan(0.1);
  });

  test('circles and polygons start along the group red axis when no direction is given', () => {
    const s = createSession();
    const g = s.execute('core.makeGroup', {
      faceIds: (() => {
        const r = s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 100, depth: 100 });
        return r.ok ? r.output.faceIds : [];
      })(),
    });
    if (!g.ok) throw new Error(g.error.code);
    s.execute('core.rotate', { instanceIds: [g.output.instanceId], center: [0, 0, 0], axis: [0, 1, 0], angle: 30 });
    expect(findInstance(s.doc.scene, g.output.instanceId)!.instance.transform.rotation[1]).not.toBe(0);
    const p = s.execute('core.drawPolygon', { definitionId: g.output.definitionId, faceId: null, center: [1000, 0, 1000], radius: 300, sides: 6, direction: null });
    if (!p.ok) throw new Error(p.error.code);
    const m = definitionModel(s.doc, g.output.definitionId)!;
    const hex = listFaces(m).find((f) => f.outer.length === 6)!;
    // In the group's own coordinates the first corner is along its red axis, wherever the group is turned.
    expect(hex.outer.some((q) => near(q, [1300, 0, 1000]))).toBe(true);
  });
});

describe('aligning a rectangle to an edge (improvement over SketchUp)', () => {
  const n: Vec3 = [0, 1, 0];
  const turned: Vec3 = [Math.cos(deg(30)), 0, -Math.sin(deg(30))];

  test('started on an edge that runs along neither axis: the edge', () => {
    const edge: [Vec3, Vec3] = [[0, 0, 0], [turned[0] * 1000, 0, turned[2] * 1000]];
    const dir = alignment(n, [100, 0, 0], edge, null);
    expect(dir && near(dir.map((v) => v / 1000), turned)).toBe(true);
  });

  test('started on an edge along an axis, or in empty space: the usual axes', () => {
    expect(alignment(n, [100, 0, 0], [[0, 0, 0], [1000, 0, 0]], null)).toBeNull();
    expect(alignment(n, [100, 0, 0], [[0, 0, 0], [0, 0, 1000]], null)).toBeNull();
    expect(alignment(n, [100, 0, 0], null, null)).toBeNull();
  });

  test('started on a face whose edges are all turned: the nearest edge', () => {
    const across: Vec3 = [-turned[2], 0, turned[0]];
    const sq: Vec3[] = [
      [0, 0, 0],
      [turned[0] * 1000, 0, turned[2] * 1000],
      [turned[0] * 1000 + across[0] * 600, 0, turned[2] * 1000 + across[2] * 600],
      [across[0] * 600, 0, across[2] * 600],
    ];
    // Near the second side (from corner 1 to corner 2).
    const start: Vec3 = [sq[1]![0] * 0.98 + sq[2]![0] * 0.02 + across[0] * 300, 0, sq[1]![2] * 0.98 + sq[2]![2] * 0.02 + across[2] * 300];
    const dir = alignment(n, start, null, sq)!;
    expect(misaligned(n, dir)).toBe(true);
    const unit = dir.map((v) => v / Math.hypot(...dir));
    expect(near(unit, across) || near(unit, across.map((v) => -v))).toBe(true);
  });

  test('a face with any edge along an axis keeps the usual axes', () => {
    const tri: Vec3[] = [
      [0, 0, 0],
      [1000, 0, 0],
      [300, 0, 700],
    ];
    expect(alignment(n, [400, 0, 100], null, tri)).toBeNull();
  });

  test('an aligned rectangle is drawn with its sides along the edge', () => {
    const s = createSession();
    // A box turned 30 degrees, loose geometry at the model level.
    const r = s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 1000, depth: 600 });
    if (!r.ok) throw new Error(r.error.code);
    s.execute('core.pushPull', { faceId: r.output.faceIds[0]!, distance: 300 });
    const box = listFaces(definitionModel(s.doc)!).map((f) => f.id);
    s.execute('core.rotate', { faceIds: box, center: [0, 0, 0], axis: [0, 1, 0], angle: 30 });
    const top = listFaces(definitionModel(s.doc)!).find((f) => f.normal[1] === 1)!;
    const dir = alignment([0, 1, 0], top.outer[0]!, null, top.outer)!;
    expect(dir).not.toBeNull();
    const out = s.execute('core.drawRectangle', { faceId: top.id, corner: [...top.outer[0]!] as [number, number, number], width: 200, depth: 100, axis: [dir[0], dir[1], dir[2]] });
    if (!out.ok) throw new Error(out.error.code);
    expect(checkModel(definitionModel(s.doc)!)).toEqual([]);
    // The new rectangle's sides run along the turned box's edges.
    const rect = listFaces(definitionModel(s.doc)!).find((f) => f.id === out.output.faceIds.find((id) => listFaces(definitionModel(s.doc)!).find((x) => x.id === id)!.outer.length === 4))!;
    for (let i = 0; i < 4; i++) {
      const a = rect.outer[i]!;
      const b = rect.outer[(i + 1) % 4]!;
      expect(misaligned([0, 1, 0], [b[0] - a[0], b[1] - a[1], b[2] - a[2]])).toBe(true);
    }
  });
});

describe('rectangle axes', () => {
  test('on a plane along the axes they are the usual ones', () => {
    expect(rectangleAxes([0, 1, 0])).toEqual([
      [1, 0, 0],
      [0, 0, 1],
    ]);
    expect(rectangleAxes([1, 0, 0])).toEqual([
      [0, 0, 1],
      [0, 1, 0],
    ]);
  });

  test('on a slanted face both sides lie in the face', () => {
    const n: Vec3 = [Math.SQRT1_2, 0, Math.SQRT1_2];
    const [u, v] = rectangleAxes(n);
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(Math.abs(dot(u, n))).toBeLessThan(1e-12);
    expect(Math.abs(dot(v, n))).toBeLessThan(1e-12);
    expect(Math.abs(dot(u, v))).toBeLessThan(1e-12);
  });

  test('a given first side is projected into the plane', () => {
    const [u, v] = rectangleAxes([0, 1, 0], [1, 0.5, 1]);
    expect(near(u, [Math.SQRT1_2, 0, Math.SQRT1_2])).toBe(true);
    // The second side turns from the first as z does from x on the ground.
    expect(near(v, [-Math.SQRT1_2, 0, Math.SQRT1_2])).toBe(true);
  });
});
