import { describe, expect, test } from 'vitest';
import { flipMessage } from '../src/ui/messages';

/* Flip feedback (milestone 6, step 3): the status bar confirms every flip, even of a symmetric part. */

describe('the flip message', () => {
  test('names the axis, a lone group or component by its own axis, and the count when several items flipped', () => {
    expect(flipMessage('red', null, 1)).toBe('Flipped along red.');
    expect(flipMessage('green', 'group', 1)).toBe("Flipped along the group's green.");
    expect(flipMessage('blue', 'component', 1)).toBe("Flipped along the component's blue.");
    expect(flipMessage('red', null, 18)).toBe('Flipped 18 items along red.');
    expect(flipMessage('green', null, 1200)).toBe('Flipped 1200 items along green.');
  });
});
