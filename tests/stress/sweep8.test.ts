import { describe, test } from 'vitest';
import { randomMixedRun } from '../helpers/randomMixed';
import { paintRun } from '../helpers/randomPaint';

/*
 * Slow randomized sweep, run with npm run test:stress (not part of npm test).
 * Milestone 5: paint follows faces through boxes, rectangles drawn on faces,
 * push/pull, erased edges, offsets and moves (see tests/helpers/randomPaint.ts),
 * 400 seeds of 60 steps; and milestone 5 mixed with everything before it (tags,
 * materials, painting, grain, cut list settings), 200 seeds of 60 steps.
 */
describe('stress sweep 8: paint follows faces; milestone 5 mixed', () => {
  test.each(Array.from({ length: 400 }, (_, i) => 8000 + i))('seed %i, 60 steps', (seed) => {
    paintRun(seed, 60);
  });
  test.each(Array.from({ length: 200 }, (_, i) => 8500 + i))('mixed, seed %i, 60 steps', (seed) => {
    randomMixedRun(seed, 60, 5);
  });
});
