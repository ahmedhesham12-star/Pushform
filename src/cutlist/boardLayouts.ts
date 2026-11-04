/**
 * Solid wood on stock boards (milestone 6): parts laid end to end along
 * boards of the material's stock length, longest first, each in the first
 * board with room. Only lengths count: each part is taken as ripped from a
 * board of its own width, so widths are never combined.
 */
import type { LayoutSettings, Piece } from './sheetLayouts';

/** A part on a board: how far from the board's end it starts, in mm. */
export interface BoardPiece extends Piece {
  readonly x: number;
}

export interface LaidOutBoard {
  readonly pieces: readonly BoardPiece[];
  /** What is left at the end once the last part is cut, in mm (0 when nothing usable is). */
  readonly offcut: number;
  /** Part length over the board's length. */
  readonly utilization: number;
}

export interface BoardLayout {
  readonly boards: readonly LaidOutBoard[];
  /** Parts longer than a board less its trim. */
  readonly tooLarge: readonly Piece[];
  /** Part length over the length of all boards used. */
  readonly utilization: number;
}

const EPS = 1e-6;

/** Lay pieces on boards `length` mm long; the trim comes off each end and a kerf after each part. */
export function layoutBoards(pieces: readonly Piece[], length: number, settings: Pick<LayoutSettings, 'kerf' | 'trim' | 'minOffcut'>): BoardLayout {
  const { kerf, trim } = settings;
  // Each part takes its length and a kerf; the board gets one kerf more, as the last part needs no cut after it.
  const capacity = length - 2 * trim + kerf;
  const sorted = [...pieces].sort((a, b) => b.length - a.length || a.number - b.number || a.copy - b.copy);
  const tooLarge = sorted.filter((p) => p.length + kerf > capacity + EPS);
  const boards: { pieces: BoardPiece[]; used: number }[] = [];
  for (const p of sorted) {
    if (tooLarge.includes(p)) continue;
    let board = boards.find((b) => b.used + p.length + kerf <= capacity + EPS);
    if (!board) boards.push((board = { pieces: [], used: 0 }));
    board.pieces.push({ ...p, x: trim + board.used });
    board.used += p.length + kerf;
  }
  const out = boards.map((b) => {
    const left = capacity - b.used - kerf;
    const parts = b.pieces.reduce((a, p) => a + p.length, 0);
    return { pieces: b.pieces, offcut: left >= settings.minOffcut - EPS && left > EPS ? left : 0, utilization: parts / length };
  });
  const total = out.reduce((a, b) => a + b.pieces.reduce((c, p) => c + p.length, 0), 0);
  return { boards: out, tooLarge: [...tooLarge].sort((a, b) => a.number - b.number || a.copy - b.copy), utilization: out.length ? total / (out.length * length) : 0 };
}
