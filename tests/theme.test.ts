// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LineBasicMaterial } from 'three';
import { describe, expect, test } from 'vitest';
import { loadViewSettings, saveViewSettings } from '../src/storage';
import { ContextMenu } from '../src/ui/contextMenu';
import { applyTheme } from '../src/ui/theme';
import { FACE_COLOR } from '../src/viewport/materials';
import { DARK_PALETTE, GREY_PALETTE, LIGHT_PALETTE, palette, PALETTES, setPalette, themedColor, type Palette } from '../src/viewport/palette';

/* Light and dark themes (milestone 6, step 2): contrast of the 3D view's lines and highlights, and the setting. */

const css = readFileSync(join(__dirname, '../src/ui/styles.css'), 'utf8');

/** A custom property's value in the first rule whose selector is `selector`. */
function token(selector: string, name: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf('}', start));
  return new RegExp(`${name}:\\s*(#[0-9a-f]{6})`).exec(block)![1]!;
}

/** WCAG relative luminance of a #rrggbb color. */
function luminance(hex: number): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((hex >> 16) & 255) + 0.7152 * channel((hex >> 8) & 255) + 0.0722 * channel(hex & 255);
}

const contrast = (a: number, b: number) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const LINES = ['edge', 'guide', 'selected', 'hover', 'erase', 'preview', 'tangent'] as const;
const canvasOf = (selector: string) => parseInt(token(selector, '--canvas').slice(1), 16);

/** Each theme, and the lines that must stand out 3:1 from its canvas as well as from faces. */
const themes: [string, Palette, number, readonly (typeof LINES)[number][]][] = [
  ['light', LIGHT_PALETTE, canvasOf(':root'), LINES],
  ['dark', DARK_PALETTE, canvasOf(":root[data-theme='dark']"), LINES],
  // A grey view cannot give a colored line 3:1 against both it and the near-white faces: there they show by hue.
  ['dark, grey view', GREY_PALETTE, canvasOf(":root[data-theme='dark-grey']"), ['edge', 'guide']],
];

describe('the 3D view in every theme', () => {
  test.each(themes)('%s: lines stand out at least 3:1 from the default face color, and from the canvas where required', (_, p, canvas, onCanvas) => {
    for (const name of LINES) {
      if (onCanvas.includes(name)) expect(contrast(p[name], canvas), `${name} on the canvas`).toBeGreaterThanOrEqual(3);
      expect(contrast(p[name], FACE_COLOR), `${name} on a face`).toBeGreaterThanOrEqual(3);
    }
    for (const a of ['x', 'y', 'z'] as const) expect(contrast(p.axis[a], canvas), `axis ${a}`).toBeGreaterThanOrEqual(3);
  });

  test.each(themes)('%s: edges still show on selected, hovered and about-to-be-erased faces, and selected lines on selected faces', (_, p) => {
    for (const face of ['faceSelected', 'faceHover', 'faceErase'] as const) expect(contrast(p.edge, p[face][0]), face).toBeGreaterThanOrEqual(3);
    expect(contrast(p.selected, p.faceSelected[0])).toBeGreaterThanOrEqual(3);
  });

  test('the dark colors follow the system setting and data-theme alike', () => {
    const block = (start: number) =>
      css
        .slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    const media = css.indexOf(":root:not([data-theme='light'])");
    expect(css).toContain('--palette: grey;');
    expect(Object.keys(PALETTES)).toEqual(['light', 'dark', 'grey']);
    expect(block(media)).toEqual(block(css.indexOf(":root[data-theme='dark']")));
  });

  test('switching palettes recolors every themed material', () => {
    const m = themedColor(new LineBasicMaterial(), (p) => p.edge);
    expect(m.color.getHex()).toBe(palette().edge);
    expect(setPalette(DARK_PALETTE)).toBe(true);
    expect(m.color.getHex()).toBe(DARK_PALETTE.edge);
    expect(setPalette(DARK_PALETTE)).toBe(false);
    setPalette(LIGHT_PALETTE);
    expect(m.color.getHex()).toBe(LIGHT_PALETTE.edge);
  });
});

describe('the theme setting', () => {
  test('is kept per device, following the system by default', () => {
    localStorage.clear();
    expect(loadViewSettings().theme).toBe('system');
    saveViewSettings({ ...loadViewSettings(), theme: 'light' });
    expect(loadViewSettings().theme).toBe('light');
    localStorage.setItem('pushform.view.v1', JSON.stringify({ theme: 'sepia' }));
    expect(loadViewSettings().theme).toBe('system');
  });

  test('sets data-theme for Light and Dark, and removes it to follow the system', () => {
    const root = document.documentElement;
    applyTheme(root, 'dark');
    expect(root.dataset.theme).toBe('dark');
    applyTheme(root, 'light');
    expect(root.dataset.theme).toBe('light');
    applyTheme(root, 'system');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  test('the View menu marks the theme in use', () => {
    const menu = new ContextMenu();
    document.body.replaceChildren(menu.element);
    menu.open(0, 0, [
      { label: 'Light Theme', enabled: true, checked: false, run: () => {} },
      { label: 'Dark Theme', enabled: true, checked: true, run: () => {} },
      { label: 'Hide Guides', enabled: true, run: () => {} },
    ]);
    const items = [...menu.element.querySelectorAll('button')].map((b) => [b.getAttribute('role'), b.getAttribute('aria-checked'), !!b.querySelector('svg')]);
    expect(items).toEqual([
      ['menuitemradio', 'false', false],
      ['menuitemradio', 'true', true],
      ['menuitem', null, false],
    ]);
  });
});
