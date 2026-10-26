import { afterEach, describe, expect, test, vi } from 'vitest';
import { ACTION_SHORTCUTS, isMac, RESERVED_SHORTCUTS, selectionMode, shortcutFor, TOOL_SHORTCUTS } from '../src/tools/shortcuts';

describe('tool shortcuts match SketchUp defaults', () => {
  test('the assigned keys', () => {
    expect(TOOL_SHORTCUTS).toEqual({
      ' ': 'select',
      m: 'move',
      q: 'rotate',
      l: 'line',
      r: 'rectangle',
      c: 'circle',
      p: 'pushPull',
      f: 'offset',
      e: 'erase',
      o: 'orbit',
      h: 'pan',
    });
  });

  test('Polygon has no shortcut, as in SketchUp', () => {
    expect(shortcutFor('polygon')).toBeNull();
  });

  test('keys reserved for later SketchUp tools are not assigned', () => {
    expect(Object.keys(RESERVED_SHORTCUTS).sort()).toEqual(['a', 'b', 's', 't']);
    for (const key of Object.keys(RESERVED_SHORTCUTS)) {
      expect(TOOL_SHORTCUTS[key], key).toBeUndefined();
      expect(ACTION_SHORTCUTS[key], key).toBeUndefined();
    }
  });

  test('G makes a component, as in SketchUp, and no tool uses it', () => {
    expect(ACTION_SHORTCUTS).toEqual({ g: 'makeComponent' });
    expect(TOOL_SHORTCUTS.g).toBeUndefined();
  });
});

describe('selection modifiers', () => {
  const click = (mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean }>) => ({
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    ...mods,
  });

  test('Windows and Linux: Shift toggles, Ctrl adds, Ctrl+Shift removes', () => {
    expect(selectionMode(click({}), false)).toBe('replace');
    expect(selectionMode(click({ shiftKey: true }), false)).toBe('toggle');
    expect(selectionMode(click({ ctrlKey: true }), false)).toBe('add');
    expect(selectionMode(click({ ctrlKey: true, shiftKey: true }), false)).toBe('remove');
  });

  test('Mac: Option takes the place of Ctrl', () => {
    expect(selectionMode(click({ altKey: true }), true)).toBe('add');
    expect(selectionMode(click({ altKey: true, shiftKey: true }), true)).toBe('remove');
    expect(selectionMode(click({ shiftKey: true }), true)).toBe('toggle');
    // Ctrl-click on a Mac is a right click, not a selection modifier.
    expect(selectionMode(click({ ctrlKey: true }), true)).toBe('replace');
  });

  describe('platform detection', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    test.each([
      ['MacIntel', true],
      ['iPad', true],
      ['Win32', false],
      ['Linux x86_64', false],
    ])('%s', (platform, mac) => {
      vi.stubGlobal('navigator', { platform });
      expect(isMac()).toBe(mac);
    });
  });
});
