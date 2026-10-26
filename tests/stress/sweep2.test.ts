import { describe, test } from 'vitest';
import { randomRun } from '../helpers/randomRun';

/* Second slow sweep (see sweep1.test.ts): 120 more seeds, 60 steps each. */
describe('stress sweep 2: rectangles and push/pull on horizontal faces', () => {
  test.each(Array.from({ length: 120 }, (_, i) => 500 + i))('seed %i, 60 steps', (seed) => {
    randomRun(seed, 60);
  });
});
