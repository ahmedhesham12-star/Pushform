import { describe, expect, test } from 'vitest';
import { pushPull } from '../src/kernel/pushPull';
import { faceArea } from '../src/kernel/query';
import { drawRectangle, drawRegularPolygon, MAX_SEGMENTS, type RegularPolygonSpec } from '../src/kernel/shapes';
import { emptyTopology, type Topology } from '../src/kernel/types';
import { validate } from '../src/kernel/validate';

/* All sizes in mm. */

function shape(t: Topology, spec: Partial<RegularPolygonSpec>) {
  const r = drawRegularPolygon(t, { kind: 'circle', faceId: null, center: [0, 0, 0], radius: 500, segments: 24, ...spec });
  if (!r.ok) throw new Error(r.error);
  expect(validate(r.topology)).toEqual([]);
  return r;
}

describe('circles', () => {
  test('a circle on the ground is one face bounded by one curve of 24 edges', () => {
    const r = shape(emptyTopology(), {});
    expect(r.topology.faces.size).toBe(1);
    expect(r.topology.edges.size).toBe(24);
    const [curve] = [...r.topology.curves.values()];
    expect(curve).toMatchObject({ kind: 'circle', segments: 24, radius: 500, center: [0, 0, 0] });
    expect(curve!.edges).toHaveLength(24);
    // A 24-gon inscribed in r = 500.
    expect(faceArea(r.topology, r.faceIds[0]!)).toBeCloseTo(0.5 * 24 * 500 * 500 * Math.sin((2 * Math.PI) / 24), 3);
    expect(r.topology.faces.get(r.faceIds[0]!)!.normal).toEqual([0, 1, 0]);
  });

  test('the first corner follows the given direction', () => {
    const r = shape(emptyTopology(), { segments: 4, direction: [0, 0, 1] });
    const corners = [...r.topology.vertices.values()].map((v) => v.p);
    expect(corners).toContainEqual([0, 0, 500]);
  });

  test('a circle overlapping a rectangle splits both; its curve keeps its segment count', () => {
    const rect = drawRectangle(emptyTopology(), { faceId: null, corner: [0, 0, -1000], width: 2000, depth: 2000 });
    if (!rect.ok) throw new Error();
    // Off-center so the rectangle's edge crosses the middle of circle segments.
    const r = shape(rect.topology, { center: [130, 0, 0], radius: 800 });
    expect(r.topology.faces.size).toBe(3);
    const [curve] = [...r.topology.curves.values()];
    expect(curve!.segments).toBe(24);
    expect(curve!.edges.length).toBeGreaterThan(24);
  });

  test('a circle drawn on the top of a box cuts a hole and fills it', () => {
    const g = drawRectangle(emptyTopology(), { faceId: null, corner: [-1000, 0, -1000], width: 2000, depth: 2000 });
    if (!g.ok) throw new Error();
    const top = g.faceIds[0]!;
    const boxed = pushPull(g.topology, top, 1000).topology;
    const r = shape(boxed, { faceId: top, center: [0, 1000, 0], radius: 400 });
    expect(r.topology.faces.get(top)!.holes).toHaveLength(1);
    expect(r.topology.faces.get(r.faceIds[0]!)!.normal).toEqual([0, 1, 0]);
  });
});

describe('polygons', () => {
  test('a hexagon on a side wall of a box', () => {
    const g = drawRectangle(emptyTopology(), { faceId: null, corner: [0, 0, 0], width: 3000, depth: 2000 });
    if (!g.ok) throw new Error();
    const boxed = pushPull(g.topology, g.faceIds[0]!, 1000).topology;
    const wall = [...boxed.faces].find(([, f]) => f.normal[2] === 1)![0];
    const r = shape(boxed, { kind: 'polygon', faceId: wall, center: [1500, 500, 2000], radius: 300, segments: 6 });
    expect(r.topology.faces.get(wall)!.holes).toHaveLength(1);
    expect(r.topology.faces.get(r.faceIds[0]!)!.normal).toEqual([0, 0, 1]);
    expect([...r.topology.curves.values()][0]).toMatchObject({ kind: 'polygon', segments: 6 });
  });
});

describe('limits', () => {
  test.each([
    ['fewer than 3 segments', { segments: 2 }, 'tooSmall'],
    ['too many segments', { segments: MAX_SEGMENTS + 1 }, 'tooSmall'],
    ['a fractional count', { segments: 6.5 }, 'tooSmall'],
    ['a tiny radius', { radius: 0.01 }, 'tooSmall'],
    ['a center off the plane', { center: [0, 50, 0] as [number, number, number] }, 'notOnPlane'],
    ['a missing face', { faceId: 'f999' }, 'noSuchFace'],
  ])('rejects %s', (_, spec, error) => {
    const r = drawRegularPolygon(emptyTopology(), { kind: 'circle', faceId: null, center: [0, 0, 0], radius: 500, segments: 24, ...spec });
    expect(r).toEqual({ ok: false, error });
  });
});
