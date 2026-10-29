import { describe, test } from 'vitest';
import { paintRun } from '../helpers/randomPaint';

/*
 * Slow randomized sweep, run with npm run test:stress (not part of npm test).
 * Milestone 5: paint follows faces through boxes, rectangles drawn on faces,
 * push/pull, erased edges, offsets and moves (see tests/helpers/randomPaint.ts).
 * 400 seeds of 60 steps.
 */
describe('stress sweep 8: paint follows faces', () => {
  test.each(Array.from({ length: 400 }, (_, i) => 8000 + i))('seed %i, 60 steps', (seed) => {
    paintRun(seed, 60);
  });
});
