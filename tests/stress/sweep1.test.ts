import { describe, test } from 'vitest';
import { randomRun } from '../helpers/randomRun';

/*
 * Slow randomized sweep, run with npm run test:stress (not part of npm test).
 * Must pass before a milestone is merged into main. 120 seeds, 60 steps each.
 * This sweep and sweep2 found the push/pull cases fixed in milestone 2; the
 * seeds that failed are also pinned in tests/crossings.test.ts.
 */
describe('stress sweep 1: rectangles and push/pull on horizontal faces', () => {
  test.each(Array.from({ length: 120 }, (_, i) => 300 + i))('seed %i, 60 steps', (seed) => {
    randomRun(seed, 60);
  });
});
