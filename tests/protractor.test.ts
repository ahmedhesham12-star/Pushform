// @vitest-environment happy-dom
import { Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { angleBetween, snappedAngle } from '../src/tools/protractorGeometry';
import type { Inferred } from '../src/tools/inference';

/* The protractor's angles, shared by Rotate and the Protractor tool. */

const up = new Vector3(0, 1, 0);
const red = new Vector3(1, 0, 0);
const at = (degrees: number) => red.clone().applyAxisAngle(up, (degrees * Math.PI) / 180);
const inferred = (kind: Inferred['kind']): Inferred => ({ point: new Vector3(), kind, axis: null });

describe('protractor angles', () => {
  test('angles are counter-clockwise looking against the axis', () => {
    expect(angleBetween(red, at(30), up)).toBeCloseTo(30, 9);
    expect(angleBetween(red, at(-100), up)).toBeCloseTo(-100, 9);
  });

  test('near a 15 degree step the angle snaps to it; farther off it does not', () => {
    expect(snappedAngle(red, at(44), up, inferred('face'))).toBe(45);
    expect(snappedAngle(red, at(40), up, inferred('face'))).toBe(40);
  });

  test('points, edges and guides give exact angles', () => {
    for (const kind of ['end', 'mid', 'edge', 'guide', 'guidePoint', 'intersection'] as const) {
      expect(snappedAngle(red, at(44), up, inferred(kind)), kind).toBe(44);
    }
  });
});
