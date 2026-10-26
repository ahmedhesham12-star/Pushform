import { describe, test } from 'vitest';
import { randomSceneRun } from '../helpers/randomScene';

/*
 * Slow randomized sweep, run with npm run test:stress (not part of npm test).
 * Groups, components, copies, explode, make unique and erase mixed with
 * drawing and push/pull, in the root and inside definitions. 150 seeds, 60 steps each.
 */
describe('stress sweep 4: scene commands', () => {
  test.each(Array.from({ length: 150 }, (_, i) => 2000 + i))('seed %i, 60 steps', (seed) => {
    randomSceneRun(seed, 60);
  });
});
