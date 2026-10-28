import { describe, test } from 'vitest';
import { arcRun } from '../helpers/randomArcs';
import { randomMixedRun } from '../helpers/randomMixed';

/*
 * Slow randomized sweep, run with npm run test:stress (not part of npm test).
 * Milestone 4 mixed with everything before it: corners moved on their own
 * (folding), scale and flip, arcs and pies, guides, dimensions and text, with
 * invariant checks, anchors that follow, and a save and open after every step.
 * 200 seeds of 60 steps; then 300 seeds of arcs and pies among rectangles and
 * push/pulls, 30 steps each.
 */
describe('stress sweep 7: milestone 4 mixed', () => {
  test.each(Array.from({ length: 200 }, (_, i) => 7000 + i))('seed %i, 60 steps', (seed) => {
    randomMixedRun(seed, 60, true);
  });
  test.each(Array.from({ length: 300 }, (_, i) => 7500 + i))('arcs, seed %i, 30 steps', (seed) => {
    arcRun(seed, 30);
  });
});
