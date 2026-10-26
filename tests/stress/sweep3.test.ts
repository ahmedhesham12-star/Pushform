import { describe, test } from 'vitest';
import { randomAssemblyRun } from '../helpers/randomAssembly';

/*
 * Slow randomized sweep, run with npm run test:stress (not part of npm test).
 * Extract, move or turn, and merge back: the kernel side of groups, explode
 * and copies. 300 seeds, 10 steps each.
 */
describe('stress sweep 3: extract and merge', () => {
  test.each(Array.from({ length: 300 }, (_, i) => 1000 + i))('seed %i, 10 steps', (seed) => {
    randomAssemblyRun(seed, 10);
  });
});
