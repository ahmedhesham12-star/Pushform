/**
 * Cutting diagrams for sheet goods (milestone 6): the parts of one material
 * laid out on as few sheets as the heuristics find, deterministically.
 *
 * Coordinates are in mm from the sheet's corner: x along its length, y
 * along its width. Kerf is handled by growing every part, and the usable
 * sheet, by one kerf: neighbors then sit a saw blade apart, and the far edge
 * loses nothing. Trim is cut off every edge of the sheet first.
 */

/** The direction of the first, full-sheet cuts of a guillotine layout, or whichever gives the better layout. */
export type FirstCut = 'length' | 'width' | 'best';

export interface LayoutSettings {
  /** Saw blade width, mm. */
  readonly kerf: number;
  /** Cut off each edge of a sheet (and each end of a board) before parts, mm. */
  readonly trim: number;
  /** Only layouts a panel saw can cut: every cut runs through the whole piece it divides. */
  readonly guillotine: boolean;
  readonly firstCut: FirstCut;
  /** Leftovers whose short side is at least this (mm) are listed as offcuts. */
  readonly minOffcut: number;
}

export const DEFAULT_LAYOUT: LayoutSettings = { kerf: 3, trim: 10, guillotine: true, firstCut: 'best', minOffcut: 100 };

/** One part to cut: its cut list number, which copy of the row it is (1, 2, ...), and its size in mm. */
export interface Piece {
  readonly number: number;
  readonly copy: number;
  readonly length: number;
  readonly width: number;
}

/** A part on a sheet: where its corner is, and whether it is turned so its length runs along the sheet's width. */
export interface PlacedPiece extends Piece {
  readonly x: number;
  readonly y: number;
  readonly rotated: boolean;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  /** Along the sheet's length and width. */
  readonly length: number;
  readonly width: number;
}

export interface LaidOutSheet {
  readonly pieces: readonly PlacedPiece[];
  /** Leftovers large enough to keep, largest first. */
  readonly offcuts: readonly Rect[];
  /** Part area over the whole sheet's area. */
  readonly utilization: number;
}

export interface SheetLayout {
  readonly sheets: readonly LaidOutSheet[];
  /** Parts larger than the usable sheet (in the directions the grain allows). */
  readonly tooLarge: readonly Piece[];
  /** Part area over the area of all sheets used. */
  readonly utilization: number;
}

export interface SheetStock {
  readonly length: number;
  readonly width: number;
  /** Parts keep their length along the sheet's length; without grain they may turn. */
  readonly grain: boolean;
}

/** The size a piece takes along the sheet's length and width as placed. */
export const placedSize = (p: PlacedPiece): [number, number] => (p.rotated ? [p.width, p.length] : [p.length, p.width]);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Sort = 'area' | 'long' | 'length' | 'width';
type Fit = 'area' | 'short';
type Split = 'shorter' | 'longer' | 'area';
type Mode = 'length' | 'width' | 'free';

interface Run {
  sort: Sort;
  fit: Fit;
  split: Split;
  mode: Mode;
}

const SORTS: Sort[] = ['area', 'long', 'length', 'width'];
const FITS: Fit[] = ['area', 'short'];
const SPLITS: Split[] = ['shorter', 'longer', 'area'];
const EPS = 1e-6;

/** Lay pieces of one material on sheets of its size; the same pieces always give the same layout, in any order. */
export function layoutSheets(pieces: readonly Piece[], stock: SheetStock, settings: LayoutSettings): SheetLayout {
  const { kerf, trim } = settings;
  const binW = stock.length - 2 * trim + kerf;
  const binH = stock.width - 2 * trim + kerf;
  const fits = (p: Piece, rotated: boolean) => {
    const [w, h] = rotated ? [p.width + kerf, p.length + kerf] : [p.length + kerf, p.width + kerf];
    return w <= binW + EPS && h <= binH + EPS;
  };
  const sorted = [...pieces].sort((a, b) => a.number - b.number || a.copy - b.copy);
  const tooLarge = sorted.filter((p) => !fits(p, false) && (stock.grain || !fits(p, true)));
  const placeable = sorted.filter((p) => !tooLarge.includes(p));

  const runs: Run[] = [];
  const modes: Mode[] = !settings.guillotine ? ['free'] : settings.firstCut === 'best' ? ['length', 'width', 'free'] : [settings.firstCut];
  for (const mode of modes) for (const sort of SORTS) for (const fit of FITS) for (const split of settings.guillotine ? SPLITS : (['shorter'] as Split[])) runs.push({ sort, fit, split, mode });

  const filled = (sheets: Packed[]) => sheets.map((s) => s.pieces.reduce((a, p) => a + p.length * p.width, 0));
  let bestSheets: Packed[] | null = null;
  for (const run of runs) {
    const order = ordered(placeable, run.sort);
    const sheets = settings.guillotine ? packGuillotine(order, binW, binH, kerf, !stock.grain, run) : packMaxRects(order, binW, binH, kerf, !stock.grain);
    if (!bestSheets || better(filled(sheets), filled(bestSheets))) bestSheets = sheets;
  }

  const sheetArea = stock.length * stock.width;
  const out: LaidOutSheet[] = (bestSheets ?? []).map((s) => {
    const placed = s.pieces.map(({ box: _box, ...p }) => ({ ...p, x: p.x + trim, y: p.y + trim }));
    const area = placed.reduce((a, p) => a + p.length * p.width, 0);
    const free = settings.guillotine ? mergeFree(s.free) : disjointFree(s.pieces.map((p) => p.box), binW, binH);
    const offcuts = free
      .map((f) => ({ x: f.x + trim, y: f.y + trim, length: f.w - kerf, width: f.h - kerf }))
      .filter((r) => Math.min(r.length, r.width) >= settings.minOffcut - EPS && r.length > EPS && r.width > EPS)
      .sort((a, b) => b.length * b.width - a.length * a.width || a.x - b.x || a.y - b.y);
    return { pieces: placed, offcuts, utilization: area / sheetArea };
  });
  const total = out.reduce((a, s) => a + s.pieces.reduce((b, p) => b + p.length * p.width, 0), 0);
  return { sheets: out, tooLarge, utilization: out.length ? total / (out.length * sheetArea) : 0 };
}

/** Fewer sheets; then the first sheet fuller, then the second, and so on. */
function better(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return a.length < b.length;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > EPS) return a[i]! > b[i]!;
  return false;
}

function ordered(pieces: readonly Piece[], sort: Sort): Piece[] {
  const key: Record<Sort, (p: Piece) => number> = {
    area: (p) => p.length * p.width,
    long: (p) => Math.max(p.length, p.width),
    length: (p) => p.length,
    width: (p) => p.width,
  };
  // Ties go by size, then number and copy, so the order never depends on the input's.
  return [...pieces].sort((a, b) => key[sort](b) - key[sort](a) || b.length * b.width - a.length * a.width || a.number - b.number || a.copy - b.copy);
}

type Packed = { pieces: (PlacedPiece & { box: Box })[]; free: Box[] };

/** The orientations to try: as given, then turned when the grain allows. */
const turns = (p: Piece, rotate: boolean, kerf: number): [number, number, boolean][] => {
  const out: [number, number, boolean][] = [[p.length + kerf, p.width + kerf, false]];
  if (rotate && Math.abs(p.length - p.width) > EPS) out.push([p.width + kerf, p.length + kerf, true]);
  return out;
};

/**
 * Guillotine packing: each sheet keeps disjoint free rectangles; a part goes
 * in the one it fits best, and the rest of that rectangle is split in two
 * by one straight cut. With a first-cut direction, a free rectangle running
 * the whole usable length (or width) is always split along it, so the sheet
 * is first cut into strips that way.
 */
function packGuillotine(pieces: readonly Piece[], W: number, H: number, kerf: number, rotate: boolean, run: Run): Packed[] {
  const sheets: Packed[] = [];
  for (const p of pieces) {
    let done = false;
    for (const sheet of [...sheets, null]) {
      const s = sheet ?? { pieces: [], free: [{ x: 0, y: 0, w: W, h: H }] };
      let pick: { i: number; w: number; h: number; rotated: boolean; score: number } | null = null;
      for (const [i, f] of s.free.entries()) {
        for (const [w, h, rotated] of turns(p, rotate, kerf)) {
          if (w > f.w + EPS || h > f.h + EPS) continue;
          const score = run.fit === 'area' ? f.w * f.h - w * h : Math.min(f.w - w, f.h - h);
          if (!pick || score < pick.score - EPS) pick = { i, w, h, rotated, score };
        }
      }
      if (!pick) continue;
      const { i, w, h, rotated } = pick;
      const f = s.free[i]!;
      s.free.splice(i, 1);
      const lw = f.w - w;
      const lh = f.h - h;
      let along: boolean;
      if (run.mode === 'length' && f.x < EPS && f.w > W - EPS) along = true;
      else if (run.mode === 'width' && f.y < EPS && f.h > H - EPS) along = false;
      else if (run.split === 'shorter') along = lw <= lh;
      else if (run.split === 'longer') along = lw > lh;
      else along = lw * h <= w * lh;
      // A cut along the length leaves a full-width piece above; across, a full-height piece beside.
      const right = { x: f.x + w, y: f.y, w: lw, h: along ? h : f.h };
      const top = { x: f.x, y: f.y + h, w: along ? f.w : w, h: lh };
      for (const r of [right, top]) if (r.w > EPS && r.h > EPS) s.free.push(r);
      const box = { x: f.x, y: f.y, w, h };
      s.pieces.push({ ...p, x: f.x, y: f.y, rotated, box });
      if (!sheet) sheets.push(s);
      done = true;
      break;
    }
    if (!done) throw new Error('a piece that fits an empty sheet was not placed');
  }
  return sheets;
}

/** Free layout: MaxRects with best short side fit, the first sheet with room taking each part. */
function packMaxRects(pieces: readonly Piece[], W: number, H: number, kerf: number, rotate: boolean): Packed[] {
  const sheets: Packed[] = [];
  for (const p of pieces) {
    let done = false;
    for (const sheet of [...sheets, null]) {
      const s = sheet ?? { pieces: [], free: [{ x: 0, y: 0, w: W, h: H }] };
      let pick: { box: Box; rotated: boolean; key: number[] } | null = null;
      for (const f of s.free) {
        for (const [w, h, rotated] of turns(p, rotate, kerf)) {
          if (w > f.w + EPS || h > f.h + EPS) continue;
          const short = Math.min(f.w - w, f.h - h);
          const long = Math.max(f.w - w, f.h - h);
          // Best short side, then long side; ties to the lowest, then leftmost spot.
          const key = [short, long, f.y, f.x];
          if (!pick || lexLess(key, pick.key)) pick = { box: { x: f.x, y: f.y, w, h }, rotated, key };
        }
      }
      if (!pick) continue;
      const { box, rotated } = pick;
      s.free = subtract(s.free, box);
      s.pieces.push({ ...p, x: box.x, y: box.y, rotated, box });
      if (!sheet) sheets.push(s);
      done = true;
      break;
    }
    if (!done) throw new Error('a piece that fits an empty sheet was not placed');
  }
  return sheets;
}

/** Whether a comes before b, comparing numbers in turn (equal within EPS). */
function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > EPS) return a[i]! < b[i]!;
  return false;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
const contains = (a: Box, b: Box) => b.x >= a.x - EPS && b.y >= a.y - EPS && b.x + b.w <= a.x + a.w + EPS && b.y + b.h <= a.y + a.h + EPS;

/** Maximal free rectangles once `box` is taken out of them. */
function subtract(free: readonly Box[], box: Box): Box[] {
  const out: Box[] = [];
  for (const f of free) {
    if (!overlaps(f, box)) {
      out.push(f);
      continue;
    }
    if (box.x > f.x + EPS) out.push({ x: f.x, y: f.y, w: box.x - f.x, h: f.h });
    if (box.x + box.w < f.x + f.w - EPS) out.push({ x: box.x + box.w, y: f.y, w: f.x + f.w - box.x - box.w, h: f.h });
    if (box.y > f.y + EPS) out.push({ x: f.x, y: f.y, w: f.w, h: box.y - f.y });
    if (box.y + box.h < f.y + f.h - EPS) out.push({ x: f.x, y: box.y + box.h, w: f.w, h: f.y + f.h - box.y - box.h });
  }
  return out.filter((a, i) => !out.some((b, j) => j !== i && contains(b, a) && (!contains(a, b) || j < i)));
}

/** Leftovers of a free layout as rectangles that do not overlap: the largest maximal one, then the largest of what remains, and so on. */
function disjointFree(boxes: readonly Box[], W: number, H: number): Box[] {
  let free: Box[] = [{ x: 0, y: 0, w: W, h: H }];
  for (const b of boxes) free = subtract(free, b);
  const out: Box[] = [];
  while (free.length) {
    const largest = [...free].sort((a, b) => b.w * b.h - a.w * a.h || a.y - b.y || a.x - b.x)[0]!;
    out.push(largest);
    free = subtract(free, largest);
  }
  return out;
}

/** Free rectangles of a guillotine layout, with neighbors sharing a whole side joined. */
function mergeFree(free: readonly Box[]): Box[] {
  const out = free.map((f) => ({ ...f }));
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++)
      for (let j = 0; j < out.length && !merged; j++) {
        if (i === j) continue;
        const a = out[i]!;
        const b = out[j]!;
        const same = (u: number, v: number) => Math.abs(u - v) <= EPS;
        if (same(a.y, b.y) && same(a.h, b.h) && same(a.x + a.w, b.x)) a.w += b.w;
        else if (same(a.x, b.x) && same(a.w, b.w) && same(a.y + a.h, b.y)) a.h += b.h;
        else continue;
        out.splice(j, 1);
        merged = true;
      }
  }
  return out;
}
