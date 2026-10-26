// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { arrayBeforeCopy } from '../src/tools/transformSelection';

/*
 * Feedback while copying with Move and Rotate: an array typed before the
 * first copy is placed asks for that copy, quoting what was typed.
 */

describe('an array typed before the first copy', () => {
  test.each([
    ['x3', 'x3'],
    ['X3', 'x3'],
    ['3x', 'x3'],
    ['*3', 'x3'],
    ['/4', '/4'],
  ])('%s asks for the first copy', (typed, shown) => {
    expect(arrayBeforeCopy(typed, 'mm')).toBe(`Place the first copy, then type ${shown}.`);
  });

  test.each(['600mm', '45', '2\' 6"', '24s'])('%s is not an array', (typed) => {
    expect(arrayBeforeCopy(typed, 'mm')).toBeNull();
  });
});
