import { describe, test } from 'vitest';
import { randomMoveRun } from '../helpers/randomMove';

/*
 * Slow randomized sweep, run with npm run test:stress (not part of npm test).
 * Moving random faces and edges of boxes: every accepted move leaves a valid
 * model. 1000 seeds, 20 steps each.
 */
describe('stress sweep 5: moving loose geometry', () => {
  test.each(Array.from({ length: 1000 }, (_, i) => 3000 + i))('seed %i, 20 steps', (seed) => {
    randomMoveRun(seed, 20);
  });

  // Milestone 4: single corners too, so faces fold.
  test.each(Array.from({ length: 500 }, (_, i) => 5000 + i))('seed %i with corners', (seed) => {
    randomMoveRun(seed, 20, true);
  });
});
