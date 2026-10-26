/**
 * Window and crossing selection in screen space, as in SketchUp. Dragging
 * left to right is a window: it selects items lying fully inside it.
 * Dragging right to left is a crossing: it also selects items it touches.
 * Hidden items are selected too, so a window can take a box's bottom face.
 */

/** A point on screen in pixels; `visible` is false behind the camera. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

export interface WindowItem {
  readonly id: string;
  /** Points that must all be inside for a window to take the item (a face's corners, a box's corners). */
  readonly points: readonly ScreenPoint[];
  /** Segments a crossing may touch (edges). */
  readonly segments: readonly (readonly [ScreenPoint, ScreenPoint])[];
  /** Areas a crossing selects when it lies inside them (a face larger than the window). */
  readonly areas?: readonly (readonly ScreenPoint[])[];
}

export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The rectangle between two corners, and whether it is a crossing (dragged right to left). */
export function dragRect(start: { x: number; y: number }, end: { x: number; y: number }): { rect: Rect; crossing: boolean } {
  return {
    rect: { x0: Math.min(start.x, end.x), y0: Math.min(start.y, end.y), x1: Math.max(start.x, end.x), y1: Math.max(start.y, end.y) },
    crossing: end.x < start.x,
  };
}

const inside = (p: ScreenPoint, r: Rect) => p.visible && p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

/** Whether segment ab meets the rectangle (Liang-Barsky clipping). */
export function segmentTouchesRect(a: ScreenPoint, b: ScreenPoint, r: Rect): boolean {
  if (!a.visible || !b.visible) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - r.x0],
    [dx, r.x1 - a.x],
    [-dy, a.y - r.y0],
    [dy, r.y1 - a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

function pointInPolygon(x: number, y: number, poly: readonly ScreenPoint[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Ids of the items a window (or a crossing) selects. */
export function windowHits(items: readonly WindowItem[], rect: Rect, crossing: boolean): string[] {
  return items
    .filter((item) => {
      if (!item.points.length) return false;
      if (item.points.every((p) => inside(p, rect))) return true;
      if (!crossing) return false;
      if (item.points.some((p) => inside(p, rect))) return true;
      if (item.segments.some(([a, b]) => segmentTouchesRect(a, b, rect))) return true;
      const cx = (rect.x0 + rect.x1) / 2;
      const cy = (rect.y0 + rect.y1) / 2;
      return (item.areas ?? []).some((poly) => poly.every((p) => p.visible) && pointInPolygon(cx, cy, poly));
    })
    .map((item) => item.id);
}
