// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { createMoveTool } from '../src/tools/move';
import { createRotateTool } from '../src/tools/rotate';
import type { ToolContext } from '../src/tools/tool';
import { arrayBeforeCopy } from '../src/tools/transformSelection';

/*
 * Feedback while copying with Move and Rotate: a plus beside the cursor and
 * a "Copy" label in the measurements box while copying, and an array typed
 * before the first copy is placed asks for that copy, quoting what was typed.
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

describe('copying shows in the cursor and the measurements label', () => {
  function context() {
    const labels: string[] = [];
    const none = () => undefined;
    const viewport = { setExcluded: none, hidePreview: none, clearPreview: none };
    const ctx = { viewport, hint: none, setMeasurementLabel: (l: string) => labels.push(l) } as unknown as ToolContext;
    return { ctx, labels };
  }
  const ctrl = new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true });

  test.each([
    ['Move', createMoveTool, 'move', 'Distance', 'Copy distance'],
    ['Rotate', createRotateTool, 'crosshair', 'Angle', 'Copy angle'],
  ] as const)('%s: Ctrl toggles both; Esc ends copying', (_name, create, cursor, plain, copying) => {
    const { ctx, labels } = context();
    const tool = create(ctx);
    expect(tool.cursor).toBe(cursor);
    expect(tool.measurementLabel()).toBe(plain);

    expect(tool.key!(ctrl)).toBe(true);
    expect(tool.cursor.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(tool.cursor.endsWith(`, ${cursor}`)).toBe(true);
    expect(tool.measurementLabel()).toBe(copying);
    expect(labels).toEqual([copying]);

    tool.key!(ctrl);
    expect(tool.cursor).toBe(cursor);
    expect(labels).toEqual([copying, plain]);

    tool.key!(ctrl);
    tool.reset();
    expect(tool.cursor).toBe(cursor);
    expect(tool.measurementLabel()).toBe(plain);
  });
});
