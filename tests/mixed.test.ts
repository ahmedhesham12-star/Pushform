import { describe, expect, test } from 'vitest';
import { randomMixedRun } from './helpers/randomMixed';

/*
 * Every milestone 3 command mixed at random, with invariant checks and a
 * save and open after every step (see helpers/randomMixed.ts). More seeds run
 * in stress sweep 6.
 */
describe('randomized mixed commands', () => {
  test.each([1, 2, 3, 4, 5, 6])('seed %i, 50 steps', (seed) => {
    randomMixedRun(seed, 50);
  });

  // Found by stress sweep 6, run up to the step that failed: a hole moved out of the face around it
  // in one jump (4040, 4042, 4077, 4104, 4150), and loose lines crossing in a plane that a push gave
  // its first face (4057).
  test.each([
    [4040, 40],
    [4042, 30],
    [4057, 35],
    [4077, 12],
    [4104, 38],
    [4150, 42],
  ])('seed %i, %i steps (regression)', (seed, steps) => {
    randomMixedRun(seed, steps);
  });

  test('the runs exercise every command', () => {
    const total: Record<string, number> = {};
    for (let seed = 1; seed <= 6; seed++) {
      for (const [k, v] of Object.entries(randomMixedRun(seed, 50).counts)) total[k] = (total[k] ?? 0) + v;
    }
    for (const id of [
      'core.drawRectangle',
      'core.pushPull',
      'core.makeGroup',
      'core.makeComponent',
      'core.move',
      'core.rotate',
      'core.moveCopies',
      'core.rotateCopies',
      'core.offset',
      'core.explode',
      'core.erase',
      'amend',
      'undoRedo',
    ]) {
      expect(total[id] ?? 0, id).toBeGreaterThan(0);
    }
  });
});
