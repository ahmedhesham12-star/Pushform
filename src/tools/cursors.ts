/** Strokes for the cursors below, drawn in a 32 px box around the hotspot at 12, 12. */
const SHAPES = {
  move: 'M12 3V21M3 12H21M9 6L12 3L15 6M9 18L12 21L15 18M6 9L3 12L6 15M18 9L21 12L18 15',
  crosshair: 'M12 2V22M2 12H22',
};
const PLUS = 'M25 21V29M21 25H29';

/**
 * The tool's cursor with a plus beside it, as SketchUp shows while Move or
 * Rotate copies. Drawn inline (no file to load), white under black so it
 * reads on any face; the built-in cursor is the fallback.
 */
export function copyCursor(base: keyof typeof SHAPES): string {
  const d = `${SHAPES[base]}${PLUS}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" stroke-linecap="square">` +
    `<path d="${d}" stroke="#fff" stroke-width="3.5"/><path d="${d}" stroke="#000" stroke-width="1.5"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, ${base}`;
}
