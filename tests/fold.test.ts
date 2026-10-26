import { describe, expect, test } from 'vitest';
import { moveGeometry, transformSelection } from '../src/kernel/move';
import { pushPull } from '../src/kernel/pushPull';
import { drawRectangle, drawRegularPolygon } from '../src/kernel/shapes';
import { emptyTopology, type Point3, type Topology } from '../src/kernel/types';
import { validate } from '../src/kernel/validate';

/*
 * Folding: a stretched face bent out of its plane folds into flat pieces,
 * as checked in SketchUp 2023 (PROJECT.md, "Verified in SketchUp"). Our axes
 * are Y up, so SketchUp's (x, y, z) is our (x, z, y). All sizes in mm.
 */

function box(x: number, z: number, w: number, d: number, h: number): Topology {
  const r = drawRectangle(emptyTopology(), { faceId: null, corner: [x, 0, z], width: w, depth: d });
  if (!r.ok) throw new Error(r.error);
  return pushPull(r.topology, r.faceIds[0]!, h).topology;
}

function cylinder(radius: number, segments: number, h: number): Topology {
  const r = drawRegularPolygon(emptyTopology(), { kind: 'circle', faceId: null, center: [0, 0, 0], radius, segments, direction: [1, 0, 0] });
  if (!r.ok) throw new Error(r.error);
  return pushPull(r.topology, r.faceIds[0]!, h).topology;
}

const vertexAt = (t: Topology, p: Point3) => [...t.vertices].find(([, v]) => v.p.every((c, i) => Math.abs(c - p[i]!) < 1e-6))![0];
const edgeAlong = (t: Topology, test: (a: Point3, b: Point3) => boolean) =>
  [...t.edges].find(([, e]) => test(t.vertices.get(e.v[0])!.p, t.vertices.get(e.v[1])!.p))![0];

function valid(r: ReturnType<typeof moveGeometry>): Topology {
  if (!r.ok) throw new Error(r.error);
  expect(validate(r.topology)).toEqual([]);
  return r.topology;
}

/** Edges in `after` that `before` did not have, as their two points. */
function newEdges(before: Topology, after: Topology) {
  const P = (v: string) => after.vertices.get(v)!.p;
  return [...after.edges]
    .filter(([id]) => !before.edges.has(id))
    .map(([, e]) => ({ points: [P(e.v[0]), P(e.v[1])].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]), soft: e.soft }));
}

describe('folding moved geometry', () => {
  test('a box top corner moved up folds the top along the diagonal through the corner', () => {
    const t = box(0, 0, 1000, 1000, 500);
    const corner = vertexAt(t, [1000, 500, 1000]);
    const m = valid(moveGeometry(t, [], [], [0, 200, 0], [corner]));
    expect(m.faces.size).toBe(7);
    expect(newEdges(t, m)).toEqual([{ points: [[0, 500, 0], [1000, 700, 1000]], soft: false }]);
  });

  test('a box top edge moved up slopes the top without folding', () => {
    const t = box(0, 0, 1000, 1000, 500);
    const front = edgeAlong(t, (a, b) => a[1] === 500 && b[1] === 500 && a[2] === 0 && b[2] === 0);
    const m = valid(moveGeometry(t, [], [front], [0, 200, 0]));
    expect(m.faces.size).toBe(6);
    expect(newEdges(t, m)).toEqual([]);
  });

  test('a box top edge slid along itself folds both side walls, each as a ridge', () => {
    const t = box(0, 0, 1000, 1000, 500);
    const front = edgeAlong(t, (a, b) => a[1] === 500 && b[1] === 500 && a[2] === 0 && b[2] === 0);
    const m = valid(moveGeometry(t, [], [front], [300, 0, 0]));
    expect(m.faces.size).toBe(8);
    expect(newEdges(t, m)).toEqual(
      expect.arrayContaining([
        // The wall it bulges out of: through the moved corner.
        { points: [[1000, 0, 1000], [1300, 500, 0]], soft: false },
        // The wall it moves into: between the moved corner's neighbors.
        { points: [[0, 0, 0], [0, 500, 1000]], soft: false },
      ]),
    );
  });

  test('a vertex of a twelve-sided top moved up folds it into a fan from that vertex', () => {
    const t = cylinder(500, 12, 400);
    const v = vertexAt(t, [500, 400, 0]);
    const m = valid(moveGeometry(t, [], [], [0, 150, 0], [v]));
    const added = newEdges(t, m);
    expect(added).toHaveLength(9);
    for (const e of added) expect(e.points.some((p) => p[0] === 500 && p[1] === 550 && p[2] === 0)).toBe(true);
    expect(added.every((e) => !e.soft)).toBe(true);
  });

  test('folds inside a smooth surface (a cylinder wall) are soft', () => {
    const t = cylinder(500, 12, 400);
    const v = vertexAt(t, [500, 400, 0]);
    const m = valid(moveGeometry(t, [], [], [0, 0, 150], [v]));
    const added = newEdges(t, m);
    expect(added).toHaveLength(2);
    expect(added.every((e) => e.soft)).toBe(true);
  });

  test('turning a box top folds the walls instead of refusing', () => {
    const t = box(0, 0, 1000, 1000, 500);
    const top = [...t.faces].find(([, f]) => f.normal[1] === 1)![0];
    const turn = (p: readonly number[]): [number, number, number] => {
      const [c, s] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
      return [500 + (p[0]! - 500) * c + (p[2]! - 500) * s, p[1]!, 500 - (p[0]! - 500) * s + (p[2]! - 500) * c];
    };
    const m = valid(transformSelection(t, [top], [], { mapPoint: turn, mapVector: (v) => turn([v[0] + 500, v[1], v[2] + 500]).map((x, i) => x - (i === 1 ? 0 : 500)) as [number, number, number] }));
    expect(m.faces.size).toBe(10);
    expect(m.faces.has(top)).toBe(true);
  });

  test('a corner moved in (down) folds between its neighbors; a piece keeps the face id', () => {
    const t = box(0, 0, 1000, 1000, 500);
    const top = [...t.faces].find(([, f]) => f.normal[1] === 1)![0];
    const corner = vertexAt(t, [1000, 500, 1000]);
    const m = valid(moveGeometry(t, [], [], [0, -100, 0], [corner]));
    expect(newEdges(t, m)).toEqual([{ points: [[0, 500, 1000], [1000, 500, 0]], soft: false }]);
    expect(m.faces.has(top)).toBe(true);
    expect([...m.faces.values()].filter((f) => f.normal[0] === 0 && f.normal[1] === 1 && f.normal[2] === 0)).toHaveLength(1);
  });

  test('a fold that would run a wall through itself is refused', () => {
    const t = box(0, 0, 1000, 1000, 500);
    const corner = vertexAt(t, [1000, 500, 1000]);
    expect(moveGeometry(t, [], [], [0, -600, 0], [corner])).toEqual({ ok: false, error: 'moveCrosses' });
  });
});
