import { ColorManagement, type Color } from 'three';

// Match the r128 prototype: colors are used as given, with no sRGB conversion.
// Set here, before any view module makes its materials.
ColorManagement.enabled = false;

type Pair = readonly [front: number, back: number];

/**
 * The colors of lines and highlights in the 3D view for one theme, as
 * #rrggbb numbers shown as written. Faces, materials and tag colors look
 * the same in both themes.
 */
export interface Palette {
  /** Model edges and dimension lines. */
  readonly edge: number;
  readonly guide: number;
  /** Lines of selected, hovered and about-to-be-erased edges, guides, dimensions and instance boxes. */
  readonly selected: number;
  readonly hover: number;
  readonly erase: number;
  /** Faces in those states, front and back. */
  readonly faceSelected: Pair;
  readonly faceHover: Pair;
  readonly faceErase: Pair;
  /** Lines of what a tool is about to make; an arc tangent to an edge. */
  readonly preview: number;
  readonly tangent: number;
  /** Red, blue (up) and green axes, which are x, y and z; also the Scale grips. */
  readonly axis: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * Dark lines on the light canvas, as the view has shown them since
 * milestone 1 (hover, tangent and green darkened for contrast), and the
 * light highlight colors the face materials were always given.
 */
export const LIGHT_PALETTE: Palette = {
  edge: 0x050608,
  guide: 0x1b2229,
  selected: 0x1d5c86,
  hover: 0x3f80b3,
  erase: 0xc0392b,
  faceSelected: [0x8fbde0, 0x6f9dc4],
  faceHover: [0xd5e5f1, 0xa9bed2],
  faceErase: [0xf1c3ba, 0xd29a90],
  preview: 0x1d5c86,
  tangent: 0x0f7f9c,
  axis: { x: 0xc4443b, y: 0x3a62c2, z: 0x34874a },
};

/**
 * The dark interface around a medium grey view (product owner, milestone 6),
 * so edges can stay near-black and show on every face, back faces and
 * mid-tone materials included. Colored lines must still read on the
 * near-white default faces, so they stay dark; against the grey canvas they
 * show by hue more than by lightness. The axes are light, as they run
 * mostly over the canvas.
 */
export const DARK_PALETTE: Palette = {
  edge: 0x0b0d0f,
  guide: 0x111417,
  selected: 0x1d5c86,
  hover: 0x3f80b3,
  erase: 0xc0392b,
  faceSelected: [0x8fbde0, 0x6f9dc4],
  faceHover: [0xd5e5f1, 0xa9bed2],
  faceErase: [0xf1c3ba, 0xd29a90],
  preview: 0x1d5c86,
  tangent: 0x0f7f9c,
  axis: { x: 0xff9c94, y: 0x9dbbff, z: 0x7fd88a },
};

let current: Palette = LIGHT_PALETTE;
const themed: [{ color: Color }, (p: Palette) => number][] = [];

/** The palette in use. */
export const palette = (): Palette => current;

/** A material whose color follows the theme, colored now from the palette in use. */
export function themedColor<M extends { color: Color }>(material: M, pick: (p: Palette) => number): M {
  themed.push([material, pick]);
  material.color.setHex(pick(current));
  return material;
}

/** Use a palette: every themed material takes its color from it. False when it was already in use. */
export function setPalette(p: Palette): boolean {
  if (p === current) return false;
  current = p;
  for (const [m, pick] of themed) m.color.setHex(pick(p));
  return true;
}

/** A color as red, green and blue fractions, for vertex colors. */
export const rgb = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
