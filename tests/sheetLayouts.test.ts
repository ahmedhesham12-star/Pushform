import { describe, expect, test } from 'vitest';
import { layoutBoards } from '../src/cutlist/boardLayouts';
import { DEFAULT_LAYOUT, layoutSheets, placedSize, type LayoutSettings, type Piece, type PlacedPiece, type SheetLayout, type SheetStock } from '../src/cutlist/sheetLayouts';

/* Cutting diagrams (milestone 6, step 4): sheet layouts and solid wood boards. */

const EPS = 1e-6;
const SHEET: SheetStock = { length: 2440, width: 1220, grain: false };

/** `count` copies of one part numbered `number`. */
const parts = (number: number, length: number, width: number, count = 1): Piece[] => Array.from({ length: count }, (_, i) => ({ number, copy: i + 1, length, width }));

/** Whether parts can be separated by one straight cut through the whole rectangle (a kerf wide), and then each side again. */
function guillotine(pieces: readonly PlacedPiece[], kerf: number): boolean {
  return pieces.length <= 1 || rootCut(pieces, kerf, 'length') || rootCut(pieces, kerf, 'width');
}

/** Whether a full cut in this direction ('length' runs along the sheet's length, a line of constant y) starts a guillotine layout. */
function rootCut(pieces: readonly PlacedPiece[], kerf: number, axis: 'length' | 'width'): boolean {
  const lo = (p: PlacedPiece) => (axis === 'width' ? p.x : p.y);
  const hi = (p: PlacedPiece) => lo(p) + placedSize(p)[axis === 'width' ? 0 : 1];
  return pieces.some((p) => {
    const c = hi(p);
    const before = pieces.filter((q) => hi(q) <= c + EPS);
    const after = pieces.filter((q) => lo(q) >= c + kerf - EPS);
    return before.length > 0 && after.length > 0 && before.length + after.length === pieces.length && guillotine(before, kerf) && guillotine(after, kerf);
  });
}

/**
 * Whether a sheet's first cuts run this way: one of them separates parts, or the parts form one
 * strip (one part spans the strip from side to side), whose first cut only takes off the rest.
 */
function startsWith(pieces: readonly PlacedPiece[], kerf: number, axis: 'length' | 'width'): boolean {
  const lo = (p: PlacedPiece) => (axis === 'width' ? p.x : p.y);
  const hi = (p: PlacedPiece) => lo(p) + placedSize(p)[axis === 'width' ? 0 : 1];
  return rootCut(pieces, kerf, axis) || pieces.some((p) => pieces.every((q) => lo(q) >= lo(p) - EPS && hi(q) <= hi(p) + EPS));
}

/** Every rule a layout must keep: each part once, inside the trimmed sheet, a kerf apart, the grain kept, and the counts. */
function checkLayout(layout: SheetLayout, pieces: readonly Piece[], stock: SheetStock, s: LayoutSettings): void {
  const placed = layout.sheets.flatMap((sh) => sh.pieces);
  const key = (p: Piece) => `${p.number}.${p.copy}`;
  expect([...placed, ...layout.tooLarge].map(key).sort()).toEqual(pieces.map(key).sort());
  for (const sheet of layout.sheets) {
    expect(sheet.pieces.length).toBeGreaterThan(0);
    for (const [i, a] of sheet.pieces.entries()) {
      const [al, aw] = placedSize(a);
      expect(a.x).toBeGreaterThanOrEqual(s.trim - EPS);
      expect(a.y).toBeGreaterThanOrEqual(s.trim - EPS);
      expect(a.x + al).toBeLessThanOrEqual(stock.length - s.trim + EPS);
      expect(a.y + aw).toBeLessThanOrEqual(stock.width - s.trim + EPS);
      if (stock.grain) expect(a.rotated).toBe(false);
      for (const b of sheet.pieces.slice(i + 1)) {
        const [bl, bw] = placedSize(b);
        const apart = a.x + al + s.kerf <= b.x + EPS || b.x + bl + s.kerf <= a.x + EPS || a.y + aw + s.kerf <= b.y + EPS || b.y + bw + s.kerf <= a.y + EPS;
        expect(apart, `${key(a)} and ${key(b)}`).toBe(true);
      }
    }
    if (s.guillotine) expect(guillotine(sheet.pieces, s.kerf)).toBe(true);
    const area = sheet.pieces.reduce((t, p) => t + p.length * p.width, 0);
    expect(sheet.utilization).toBeCloseTo(area / (stock.length * stock.width), 12);
    for (const o of sheet.offcuts) {
      expect(Math.min(o.length, o.width)).toBeGreaterThanOrEqual(s.minOffcut - EPS);
      for (const p of sheet.pieces) {
        const [pl, pw] = placedSize(p);
        const apart = o.x + o.length <= p.x + EPS || p.x + pl <= o.x + EPS || o.y + o.width <= p.y + EPS || p.y + pw <= o.y + EPS;
        expect(apart).toBe(true);
      }
    }
  }
}

/** A seeded random number generator (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('sheet layouts', () => {
  test('kerf between parts and trim around the sheet', () => {
    const stock = { length: 1000, width: 500, grain: true };
    const s = { ...DEFAULT_LAYOUT, kerf: 3, trim: 10 };
    // 980 x 480 usable: two 488.5 mm parts and a kerf fill the length exactly; 490 mm ones do not.
    const fit = layoutSheets(parts(1, 488.5, 480, 2), stock, s);
    expect(fit.sheets).toHaveLength(1);
    expect(fit.sheets[0]!.pieces.map((p) => [p.x, p.y])).toEqual([
      [10, 10],
      [501.5, 10],
    ]);
    expect(layoutSheets(parts(1, 490, 480, 2), stock, s).sheets).toHaveLength(2);
    expect(layoutSheets(parts(1, 980, 480), stock, s).tooLarge).toEqual([]);
    expect(layoutSheets(parts(1, 980.5, 480), stock, s).tooLarge).toEqual(parts(1, 980.5, 480));
    expect(layoutSheets(parts(1, 980, 480.5), stock, s).sheets).toEqual([]);
  });

  test("grain keeps a part's length along the sheet; without grain it may turn", () => {
    const s = { ...DEFAULT_LAYOUT, trim: 10 };
    // 200 long and 1300 wide: wider than the sheet's 1200 usable width.
    const across = parts(1, 200, 1300);
    expect(layoutSheets(across, { ...SHEET, grain: true }, s).tooLarge).toHaveLength(1);
    const turned = layoutSheets(across, SHEET, s);
    expect(turned.tooLarge).toEqual([]);
    expect(turned.sheets[0]!.pieces[0]!.rotated).toBe(true);
    // Turning lets four 1200 x 600 parts and two 1000 x 400 ones share one sheet.
    const mixed = [...parts(1, 1200, 600, 2), ...parts(2, 400, 1000, 2)];
    const free = layoutSheets(mixed, SHEET, { ...s, kerf: 0, trim: 0 });
    checkLayout(free, mixed, SHEET, { ...s, kerf: 0, trim: 0 });
    expect(free.sheets).toHaveLength(1);
    const grained = layoutSheets(mixed, { ...SHEET, grain: true }, { ...s, kerf: 0, trim: 0 });
    checkLayout(grained, mixed, { ...SHEET, grain: true }, { ...s, kerf: 0, trim: 0 });
  });

  test('first cuts along the length, across it, or whichever gives the better layout', () => {
    const pieces = [...parts(1, 800, 500, 3), ...parts(2, 600, 300, 4), ...parts(3, 450, 450, 3), ...parts(4, 2000, 150, 2)];
    const results = (['length', 'width', 'best'] as const).map((firstCut) => {
      const s = { ...DEFAULT_LAYOUT, firstCut };
      const layout = layoutSheets(pieces, SHEET, s);
      checkLayout(layout, pieces, SHEET, s);
      return layout;
    });
    for (const sheet of results[0]!.sheets) expect(startsWith(sheet.pieces, 3, 'length')).toBe(true);
    for (const sheet of results[1]!.sheets) expect(startsWith(sheet.pieces, 3, 'width')).toBe(true);
    expect(results[2]!.sheets.length).toBeLessThanOrEqual(Math.min(results[0]!.sheets.length, results[1]!.sheets.length));
  });

  test('the same parts give the same layout in any order', () => {
    const next = random(7);
    const pieces = Array.from({ length: 40 }, (_, i) => ({ number: 1 + (i % 9), copy: 1 + Math.floor(i / 9), length: 100 + Math.round(next() * 900), width: 60 + Math.round(next() * 500) }));
    for (const guillotine of [true, false]) {
      const s = { ...DEFAULT_LAYOUT, guillotine };
      const a = layoutSheets(pieces, SHEET, s);
      const shuffled = [...pieces].sort(() => next() - 0.5);
      expect(layoutSheets(shuffled, SHEET, s)).toEqual(a);
      expect(layoutSheets([...pieces].reverse(), SHEET, s)).toEqual(a);
    }
  });

  test('utilization: part area over sheet area, per sheet and in all', () => {
    const s = { ...DEFAULT_LAYOUT };
    const layout = layoutSheets(parts(1, 1000, 500, 3), SHEET, s);
    expect(layout.sheets).toHaveLength(1);
    expect(layout.sheets[0]!.utilization).toBeCloseTo((3 * 1000 * 500) / (2440 * 1220), 12);
    const two = layoutSheets(parts(1, 2000, 1000, 2), SHEET, s);
    expect(two.sheets).toHaveLength(2);
    expect(two.utilization).toBeCloseTo((2 * 2000 * 1000) / (2 * 2440 * 1220), 12);
  });

  test('offcuts: what is left, less the kerf, when its short side reaches the smallest usable size', () => {
    const s = { ...DEFAULT_LAYOUT, kerf: 3, trim: 10, minOffcut: 100 };
    // A part as long as the usable sheet leaves one strip: 1200 - 600 - 3 = 597 wide.
    const strip = layoutSheets(parts(1, 2420, 600), SHEET, s);
    expect(strip.sheets[0]!.offcuts).toEqual([{ x: 10, y: 613, length: 2420, width: 597 }]);
    // 1200 - 1150 - 3 = 47 is too narrow to keep.
    expect(layoutSheets(parts(1, 2420, 1150), SHEET, s).sheets[0]!.offcuts).toEqual([]);
    expect(layoutSheets(parts(1, 2420, 1150), SHEET, { ...s, minOffcut: 40 }).sheets[0]!.offcuts).toEqual([{ x: 10, y: 1163, length: 2420, width: 47 }]);
    // A corner part: the guillotine leftovers, joined where they share a side.
    const corner = layoutSheets(parts(1, 1000, 500), SHEET, s);
    const area = corner.sheets[0]!.offcuts.reduce((a, o) => a + o.length * o.width, 0);
    expect(area).toBeLessThanOrEqual(2420 * 1200 - 1000 * 500);
    expect(area).toBeGreaterThan(2420 * 1200 - 1003 * 503 - 3 * 2420 - 3 * 1200);
  });

  test('randomized parts give valid layouts in every mode, and "best" is never worse', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const next = random(seed);
      const grain = next() < 0.5;
      const stock = { ...SHEET, grain };
      const pieces: Piece[] = [];
      const rows = 1 + Math.floor(next() * 8);
      for (let n = 1; n <= rows; n++) pieces.push(...parts(n, 50 + Math.round(next() * 1500), 40 + Math.round(next() * 700), 1 + Math.floor(next() * 5)));
      const counts: Record<string, number> = {};
      for (const [guillotine, firstCut] of [
        [true, 'length'],
        [true, 'width'],
        [true, 'best'],
        [false, 'best'],
      ] as const) {
        const s = { ...DEFAULT_LAYOUT, guillotine, firstCut, kerf: 4, trim: 8, minOffcut: 80 };
        const layout = layoutSheets(pieces, stock, s);
        checkLayout(layout, pieces, stock, s);
        if (guillotine && firstCut !== 'best') for (const sheet of layout.sheets) expect(startsWith(sheet.pieces, 4, firstCut), `seed ${seed}, ${firstCut}`).toBe(true);
        counts[`${guillotine}-${firstCut}`] = layout.sheets.length;
      }
      expect(counts['true-best']!, `seed ${seed}`).toBeLessThanOrEqual(Math.min(counts['true-length']!, counts['true-width']!));
    }
  });
});

describe('solid wood boards', () => {
  test('longest first, each in the first board with room; trim at both ends and a kerf after each part', () => {
    const s = { kerf: 3, trim: 10, minOffcut: 100 };
    // 2400 board: 2380 usable. 840 + 3 + 840 = 1683; adding 3 + 700 would need 2386, so 700 starts
    // a second board, but 500 still fits on the first (1683 + 3 + 500 = 2186).
    const layout = layoutBoards([...parts(1, 840, 540, 2), ...parts(2, 700, 60), ...parts(3, 500, 60)], 2400, s);
    expect(layout.boards.map((b) => b.pieces.map((p) => [p.number, p.x]))).toEqual([
      [
        [1, 10],
        [1, 853],
        [3, 1696],
      ],
      [[2, 10]],
    ]);
    expect(layout.boards.map((b) => b.offcut)).toEqual([2380 - 2180 - 9, 2380 - 700 - 3]);
    expect(layout.boards[0]!.utilization).toBeCloseTo(2180 / 2400, 12);
    expect(layout.utilization).toBeCloseTo(2880 / 4800, 12);
  });

  test('a part as long as the usable board fits with nothing left; a longer one does not fit', () => {
    const s = { kerf: 3, trim: 10, minOffcut: 100 };
    expect(layoutBoards(parts(1, 2380, 90), 2400, s).boards).toEqual([{ pieces: [{ number: 1, copy: 1, length: 2380, width: 90, x: 10 }], offcut: 0, utilization: 2380 / 2400 }]);
    expect(layoutBoards(parts(1, 2380.5, 90), 2400, s)).toMatchObject({ boards: [], tooLarge: parts(1, 2380.5, 90) });
    // Short offcuts are not kept.
    expect(layoutBoards(parts(1, 2300, 90), 2400, s).boards[0]!.offcut).toBe(0);
    expect(layoutBoards(parts(1, 2300, 90), 2400, { ...s, minOffcut: 50 }).boards[0]!.offcut).toBe(77);
  });
});
