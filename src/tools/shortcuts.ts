import type { ToolId } from './tool';

/**
 * Single-key tool shortcuts. They match SketchUp's defaults, because our users
 * come from SketchUp and rely on that muscle memory. Tools SketchUp gives no
 * default key (Polygon, Arc, 3-Point Arc, Pie) get none here either.
 */
export const TOOL_SHORTCUTS: Readonly<Record<string, ToolId>> = {
  ' ': 'select',
  m: 'move',
  q: 'rotate',
  s: 'scale',
  l: 'line',
  r: 'rectangle',
  c: 'circle',
  a: 'arc',
  p: 'pushPull',
  f: 'offset',
  e: 'erase',
  t: 'tape',
  o: 'orbit',
  h: 'pan',
};

/**
 * Keys reserved for SketchUp tools we have not built yet, so they keep their
 * SketchUp meaning when we do. Never assign them to anything else.
 */
export const RESERVED_SHORTCUTS: Readonly<Record<string, string>> = {
  b: 'Paint Bucket',
};

export type ActionId = 'makeComponent';

/** Single-key actions that are not tools, also as in SketchUp. */
export const ACTION_SHORTCUTS: Readonly<Record<string, ActionId>> = {
  g: 'makeComponent',
};

export function shortcutFor(tool: ToolId): string | null {
  return Object.entries(TOOL_SHORTCUTS).find(([, id]) => id === tool)?.[0] ?? null;
}

/** Whether we run on a Mac, where Option takes the place of Ctrl as a modifier. */
export function isMac(): boolean {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const platform = (nav as { userAgentData?: { platform?: string } } | undefined)?.userAgentData?.platform ?? nav?.platform ?? '';
  return /mac|iphone|ipad/i.test(platform);
}

export type SelectionMode = 'replace' | 'toggle' | 'add' | 'remove';

/**
 * How a click changes the selection, as in SketchUp: no modifier replaces it,
 * Shift toggles, Ctrl adds only, Ctrl+Shift removes only. On a Mac, Option
 * takes the place of Ctrl.
 */
export function selectionMode(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean }, mac: boolean): SelectionMode {
  const add = mac ? e.altKey : e.ctrlKey;
  if (add && e.shiftKey) return 'remove';
  if (add) return 'add';
  if (e.shiftKey) return 'toggle';
  return 'replace';
}
