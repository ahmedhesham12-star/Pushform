// @vitest-environment happy-dom
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { inferOnPlane, inferPoint } from '../src/tools/inference';
import { guideSegment } from '../src/viewport/guidesView';
import { meet } from '../src/viewport/meet';
import type { ToolContext } from '../src/tools/tool';

/*
 * Inference priority, with a stand-in viewport: whatever the pointer is over,
 * an endpoint or midpoint wins, then a point on an edge, and only then the
 * face or ground. This is what every drawing tool goes through.
 */

interface Under {
  snap?: { point: Vector3; kind: 'end' | 'mid' };
  edge?: Vector3;
  face?: { point: Vector3; normal: Vector3 };
  /** A guide line under the pointer: the closest point on it, and its direction. */
  guide?: { point: Vector3; direction: Vector3 };
}

function context(under: Under) {
  const markers: string[] = [];
  const viewport = {
    nearestSnap: (filter: (p: Vector3) => boolean) => (under.snap && filter(under.snap.point) ? { ...under.snap, path: [] } : null),
    pickEdge: () =>
      under.edge ? { edgeId: 'e1', point: under.edge.clone(), a: under.edge.clone(), b: under.edge.clone().setX(0), path: [], relation: 'context' } : null,
    axisInference: () => null,
    axisDirection: () => new Vector3(1, 0, 0),
    closestOnLine: () => null,
    pickGuide: () => (under.guide ? { guideId: 'g1', kind: 'line', ...under.guide, path: [], relation: 'context' } : null),
    planeUnderCursor: () => (under.face ? { faceId: 'f1', onFace: true, ...under.face } : null),
    gridPoint: (_p: Vector3, _n: Vector3, raw: Vector3) => raw.clone(),
    showMarker: (_p: Vector3, kind: string) => markers.push(kind),
  };
  const ctx = { viewport, units: () => ({ unit: 'mm', precision: 0 }) } as unknown as ToolContext;
  return { ctx, markers };
}

const up = new Vector3(0, 1, 0);
const onTop = { point: new Vector3(300, 500, 400), normal: up };

describe('inference priority', () => {
  test('an edge under the pointer wins over the face it bounds', () => {
    const { ctx } = context({ edge: new Vector3(333, 500, 1000), face: onTop });
    expect(inferPoint(ctx, null, null)?.kind).toBe('edge');
    expect(inferPoint(ctx, new Vector3(0, 500, 0), null)?.kind).toBe('edge');
  });

  test('an endpoint wins over an edge', () => {
    const { ctx } = context({ snap: { point: new Vector3(1000, 500, 1000), kind: 'end' }, edge: new Vector3(990, 500, 1000), face: onTop });
    expect(inferPoint(ctx, null, null)?.kind).toBe('end');
  });

  test('with nothing else under the pointer, the face', () => {
    const { ctx } = context({ face: onTop });
    expect(inferPoint(ctx, null, null)?.kind).toBe('face');
  });

  test('drawing tools: an edge in the drawing plane wins over the face', () => {
    const { ctx, markers } = context({ edge: new Vector3(333, 500, 1000), face: onTop });
    const r = inferOnPlane(ctx, onTop.point, up, onTop.point, 'face');
    expect(r.kind).toBe('edge');
    expect(r.point.toArray()).toEqual([333, 500, 1000]);
    expect(markers).toEqual(['edge']);
  });

  test('drawing tools: an edge off the drawing plane does not pull the point off it', () => {
    const { ctx } = context({ edge: new Vector3(1000, 250, 1000), face: onTop });
    const r = inferOnPlane(ctx, onTop.point, up, onTop.point, 'face');
    expect(r.kind).toBe('face');
    expect(r.point.y).toBe(500);
  });

  test('drawing tools: a point on the plane wins over an edge', () => {
    const { ctx } = context({ snap: { point: new Vector3(1000, 500, 1000), kind: 'mid' }, edge: new Vector3(990, 500, 1000), face: onTop });
    expect(inferOnPlane(ctx, onTop.point, up, onTop.point, 'face').kind).toBe('mid');
  });
});

describe('guides in inference', () => {
  test('a point on a guide line wins over the face; an edge wins over the guide', () => {
    const guide = { point: new Vector3(400, 500, 600), direction: new Vector3(1, 0, 0) };
    expect(inferPoint(context({ guide, face: onTop }).ctx, null, null)).toMatchObject({ kind: 'guide' });
    expect(inferPoint(context({ guide, edge: new Vector3(333, 500, 1000), face: onTop }).ctx, null, null)?.kind).toBe('edge');
  });

  test('drawing tools: a guide line in the drawing plane counts, one off it does not', () => {
    const inPlane = context({ guide: { point: new Vector3(400, 500, 600), direction: new Vector3(1, 0, 0) }, face: onTop });
    expect(inferOnPlane(inPlane.ctx, onTop.point, up, onTop.point, 'face').kind).toBe('guide');
    const across = context({ guide: { point: new Vector3(400, 300, 600), direction: new Vector3(0, 1, 0) }, face: onTop });
    expect(inferOnPlane(across.ctx, onTop.point, up, onTop.point, 'face').kind).toBe('face');
  });

  test('a guide line gives rectangles its direction to align to', () => {
    const r = inferPoint(context({ guide: { point: new Vector3(400, 500, 600), direction: new Vector3(0.6, 0, 0.8) } }).ctx, null, null)!;
    const d = r.edge!.b.clone().sub(r.edge!.a);
    expect(d.x).toBeCloseTo(0.6, 9);
    expect(d.z).toBeCloseTo(0.8, 9);
  });
});

describe('where lines meet (guide intersections)', () => {
  test('two crossing lines meet at one point; parallel or skew lines do not', () => {
    const r = meet(new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(300, 0, -100), new Vector3(0, 0, 1))!;
    expect(r.point.toArray()).toEqual([300, 0, 0]);
    expect(r.t).toBe(100);
    expect(meet(new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 0, 50), new Vector3(1, 0, 0))).toBeNull();
    expect(meet(new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(300, 5, -100), new Vector3(0, 0, 1))).toBeNull();
  });
});

describe('drawing guide lines', () => {
  test('a guide line is cut to the part in front of the camera, so lines through it still draw', () => {
    const camera = new PerspectiveCamera(45, 1, 1, 600_000);
    camera.position.set(0, 1000, 10_000);
    const target = new Vector3(0, 0, 0);
    camera.lookAt(target);
    // Along green (z), passing under the camera: one end would be behind it.
    const seg = guideSegment(new Vector3(0, 0, 0), new Vector3(0, 0, 1), camera, target)!;
    const forward = target.clone().sub(camera.position).normalize();
    for (const p of seg) expect(p.clone().sub(camera.position).dot(forward)).toBeGreaterThan(0);
    // Across the view: both ends far out to the sides.
    const across = guideSegment(new Vector3(0, 0, 0), new Vector3(1, 0, 0), camera, target)!;
    expect(across[0].x).toBeLessThan(-100_000);
    expect(across[1].x).toBeGreaterThan(100_000);
    // Wholly behind the camera: nothing to draw.
    expect(guideSegment(new Vector3(0, 0, 20_000), new Vector3(1, 0, 0), camera, target)).toBeNull();
  });
});
