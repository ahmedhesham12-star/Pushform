import { describe, expect, test } from 'vitest';
import { createSession, type CommandSession , rootModel } from '../src/commands';
import { checkModel, listEdges, listFaces, type Point3 } from '../src/kernel';
import { randomRun } from './helpers/randomRun';

/* Edges from other planes that pass through newly drawn edges. All sizes in mm. */

const near = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]!) <= 1e-6);
function hasEdge(s: CommandSession, a: Point3, b: Point3): boolean {
  return listEdges(rootModel(s.doc)).some((e) => (near(e.a, a) && near(e.b, b)) || (near(e.a, b) && near(e.b, a)));
}

describe('a new edge crossing edges of another plane (review repro)', () => {
  /** A box from y = -250 to 250 over x 0..150, z 650..700, then a ground rectangle through its left wall. */
  function repro() {
    const s = createSession();
    const g = s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 650], width: 150, depth: 50 });
    if (!g.ok) throw new Error();
    s.execute('core.pushPull', { faceId: g.output.faceIds[0]!, distance: 250 });
    const bottom = listFaces(rootModel(s.doc)).find((f) => f.normal[1] === -1)!.id;
    const p = s.execute('core.pushPull', { faceId: bottom, distance: 250 });
    expect(p.ok && p.output.distance).toBe(250);
    const r = s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 600], width: 400, depth: 250 });
    expect(r.ok).toBe(true);
    return s;
  }

  test('the checker passes', () => {
    expect(checkModel(rootModel(repro().doc))).toEqual([]);
  });

  test('the new edge and the vertical edges are split at the crossings and share the new vertices', () => {
    const s = repro();
    for (const z of [650, 700]) {
      expect(hasEdge(s, [0, -250, z], [0, 0, z]), `lower vertical at z ${z}`).toBe(true);
      expect(hasEdge(s, [0, 0, z], [0, 250, z]), `upper vertical at z ${z}`).toBe(true);
      expect(hasEdge(s, [0, -250, z], [0, 250, z])).toBe(false);
    }
    expect(hasEdge(s, [0, 0, 600], [0, 0, 650])).toBe(true);
    expect(hasEdge(s, [0, 0, 650], [0, 0, 700])).toBe(true);
    expect(hasEdge(s, [0, 0, 700], [0, 0, 850])).toBe(true);
  });

  test('the box wall the edge runs across is split into two faces, as a line would split it', () => {
    const s = repro();
    const leftWall = listFaces(rootModel(s.doc)).filter((f) => f.normal[0] === -1 && f.outer.every((p) => p[0] === 0));
    expect(leftWall).toHaveLength(2);
  });
});

// Longer sweeps of the same run live in tests/stress (npm run test:stress).
describe('randomized rectangles and push/pull on horizontal faces', () => {
  test('seed 11, 80 steps (found the crossing bug)', () => {
    randomRun(11, 80);
  });

  test.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i, 40 steps', (seed) => {
    randomRun(seed, 40);
  });

  // Seeds that found bugs in longer sweeps: stretched edges crossing other edges (2), a stretched
  // vertex landing on an existing vertex (207, 210), stretched faces overlapping coplanar faces
  // (311, 339, 402, 409, 413). Each runs just past the step that failed.
  test.each([
    [207, 25],
    [210, 50],
    [311, 30],
    [339, 35],
    [402, 60],
    [409, 15],
    [413, 55],
  ])('regression seed %i, %i steps', (seed, steps) => {
    randomRun(seed, steps);
  });
});
