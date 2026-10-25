import { describe, expect, test } from 'vitest';
import { drawLine } from '../src/kernel/lines';
import { pushPull } from '../src/kernel/pushPull';
import { faceArea } from '../src/kernel/query';
import { drawRectangle } from '../src/kernel/shapes';
import { emptyTopology, type Point3, type Topology } from '../src/kernel/types';
import { validate } from '../src/kernel/validate';

/* All sizes in mm. */

function line(t: Topology, a: Point3, b: Point3) {
  const r = drawLine(t, a, b);
  expect(validate(r.topology), `after line ${a} to ${b}`).toEqual([]);
  return r;
}

function polyline(t: Topology, pts: Point3[]) {
  let last = { topology: t, edgeIds: [] as string[], faceIds: [] as string[] };
  for (let i = 0; i + 1 < pts.length; i++) last = line(last.topology, pts[i]!, pts[i + 1]!);
  return last;
}

function rect(t: Topology, x0: number, z0: number, x1: number, z1: number) {
  const r = drawRectangle(t, { faceId: null, corner: [x0, 0, z0], width: x1 - x0, depth: z1 - z0 });
  if (!r.ok) throw new Error(r.error);
  return r;
}

const ground = (x: number, z: number): Point3 => [x, 0, z];

describe('closing loops creates faces', () => {
  test('four lines on the ground make a face only when the loop closes', () => {
    let t = emptyTopology();
    const corners = [ground(0, 0), ground(2000, 0), ground(2000, 1000), ground(0, 1000)];
    for (let i = 0; i < 3; i++) {
      t = line(t, corners[i]!, corners[i + 1]!).topology;
      expect(t.faces.size).toBe(0);
    }
    const last = line(t, corners[3]!, corners[0]!);
    expect(last.topology.faces.size).toBe(1);
    expect(last.faceIds).toHaveLength(1);
    const f = last.topology.faces.get(last.faceIds[0]!)!;
    expect(f.normal).toEqual([0, 1, 0]);
    expect(faceArea(last.topology, last.faceIds[0]!)).toBeCloseTo(2e6, 6);
  });

  test('a triangle in a vertical plane gets a face with a positive normal', () => {
    const r = polyline(emptyTopology(), [
      [0, 0, 0],
      [1000, 0, 0],
      [500, 800, 0],
      [0, 0, 0],
    ]);
    expect(r.topology.faces.size).toBe(1);
    expect([...r.topology.faces.values()][0]!.normal).toEqual([0, 0, 1]);
  });

  test('a triangle in a slanted plane gets a face', () => {
    const r = polyline(emptyTopology(), [
      [0, 0, 0],
      [1000, 300, 0],
      [200, 600, 900],
      [0, 0, 0],
    ]);
    expect(r.topology.faces.size).toBe(1);
  });

  test('lines that do not close a planar loop stay loose', () => {
    const r = polyline(emptyTopology(), [
      [0, 0, 0],
      [1000, 0, 0],
      [1000, 1000, 0],
      [1000, 1000, 1000],
    ]);
    expect(r.topology.faces.size).toBe(0);
    expect(r.topology.edges.size).toBe(3);
  });
});

describe('lines on faces', () => {
  test('a line across a face from edge to edge splits it in two', () => {
    const t = rect(emptyTopology(), 0, 0, 2000, 2000).topology;
    const r = line(t, ground(1000, 0), ground(1000, 2000));
    expect(r.topology.faces.size).toBe(2);
    expect([...r.topology.faces.keys()].map((f) => Math.round(faceArea(r.topology, f)))).toEqual([2e6, 2e6]);
  });

  test('a line from an edge into the face does not split it', () => {
    const t = rect(emptyTopology(), 0, 0, 2000, 2000).topology;
    const r = line(t, ground(1000, 0), ground(1000, 800));
    expect(r.topology.faces.size).toBe(1);
    expect(r.topology.edges.size).toBe(6);
  });

  test('two lines finishing the cut split the face', () => {
    let t = rect(emptyTopology(), 0, 0, 2000, 2000).topology;
    t = line(t, ground(1000, 0), ground(1000, 800)).topology;
    const r = line(t, ground(1000, 800), ground(1000, 2000));
    expect(r.topology.faces.size).toBe(2);
  });

  test('a line across two faces sharing an edge splits both and the shared edge', () => {
    let t = rect(emptyTopology(), 0, 0, 2000, 2000).topology;
    t = rect(t, 2000, 0, 4000, 2000).topology;
    const r = line(t, ground(0, 1000), ground(4000, 1000));
    expect(r.topology.faces.size).toBe(4);
    expect(r.edgeIds).toHaveLength(2);
  });

  test('a diagonal on the top of a box splits the top; a cut down a wall splits the wall', () => {
    const g = rect(emptyTopology(), 0, 0, 2000, 2000);
    const boxed = pushPull(g.topology, g.faceIds[0]!, 1000).topology;
    const diag = line(boxed, [0, 1000, 0], [2000, 1000, 2000]);
    expect(diag.topology.faces.size).toBe(7);
    const down = line(boxed, [1000, 1000, 2000], [1000, 0, 2000]);
    expect(down.topology.faces.size).toBe(7);
  });
});

describe('lines meeting other lines', () => {
  test('two crossing lines share a vertex at the crossing', () => {
    let t = line(emptyTopology(), ground(0, 0), ground(2000, 2000)).topology;
    const r = line(t, ground(0, 2000), ground(2000, 0));
    t = r.topology;
    expect(t.edges.size).toBe(4);
    expect(t.vertices.size).toBe(5);
  });

  test('a line ending inside another line splits it (T junction)', () => {
    let t = line(emptyTopology(), ground(0, 0), ground(2000, 0)).topology;
    t = line(t, ground(1000, 0), ground(1000, 1000)).topology;
    expect(t.edges.size).toBe(3);
    expect(t.vertices.size).toBe(4);
  });

  test('a line in open space ending inside another line splits it too', () => {
    let t = line(emptyTopology(), [0, 500, 0], [2000, 500, 0]).topology;
    t = line(t, [1000, 500, 0], [1000, 500, 1000]).topology;
    expect(t.edges.size).toBe(3);
  });

  test('a line running along an existing line reuses it', () => {
    let t = line(emptyTopology(), ground(0, 0), ground(2000, 0)).topology;
    const r = line(t, ground(-500, 0), ground(1000, 0));
    t = r.topology;
    expect(t.edges.size).toBe(3);
    expect(r.edgeIds).toHaveLength(2);
  });

  test('a line with both ends on one vertex adds nothing', () => {
    const t = line(emptyTopology(), ground(0, 0), ground(2000, 0)).topology;
    expect(drawLine(t, ground(0, 0), ground(0, 0.0005)).topology).toBe(t);
  });
});
