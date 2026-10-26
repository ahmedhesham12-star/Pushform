// @vitest-environment happy-dom
import { Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { inferOnPlane, inferPoint } from '../src/tools/inference';
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
