import { describe, test } from 'vitest';
import { randomMixedRun } from '../helpers/randomMixed';

/*
 * Slow randomized sweep, run with npm run test:stress (not part of npm test).
 * Every milestone 3 command mixed at random: groups and components, moves,
 * rotations, copy arrays, offsets, explode, amend, undo and redo, with
 * invariant checks and a save and open after every step. 200 seeds, 60 steps each.
 */
describe('stress sweep 6: every milestone 3 command mixed', () => {
  test.each(Array.from({ length: 200 }, (_, i) => 4000 + i))('seed %i, 60 steps', (seed) => {
    randomMixedRun(seed, 60);
  });
});
