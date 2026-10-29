import { connectedGeometry, edgeFaces, faceEdges, getFace, listFaces, type FaceSide, type Model } from '../kernel';

/**
 * What a Paint Bucket click paints, as in SketchUp:
 * - one: the face clicked;
 * - adjacent (Ctrl, Option on a Mac): the faces reached from it across
 *   edges, through faces with the same material on that side;
 * - all (Shift): every face of the context with that material;
 * - object (Ctrl+Shift): those in the same connected geometry.
 */
export type PaintFill = 'one' | 'adjacent' | 'all' | 'object';

export function paintTargets(m: Model, faceId: string, side: FaceSide, fill: PaintFill): string[] {
  const material = (id: string) => getFace(m, id)?.paint?.[side] ?? null;
  const same = material(faceId);
  if (fill === 'one') return [faceId];
  if (fill === 'all') return listFaces(m).filter((f) => (f.paint?.[side] ?? null) === same).map((f) => f.id);
  if (fill === 'object') return connectedGeometry(m, [faceId], []).faceIds.filter((f) => material(f) === same);
  const out = new Set([faceId]);
  const todo = [faceId];
  while (todo.length) {
    for (const e of faceEdges(m, todo.pop()!)) {
      for (const g of edgeFaces(m, e)) {
        if (out.has(g) || material(g) !== same) continue;
        out.add(g);
        todo.push(g);
      }
    }
  }
  return [...out];
}

/** The fill a click's modifiers ask for: Ctrl (Option on a Mac) adjacent, Shift all, both the connected object. */
export function fillFor(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean }, mac: boolean): PaintFill {
  const adjacent = mac ? e.altKey : e.ctrlKey;
  return adjacent && e.shiftKey ? 'object' : adjacent ? 'adjacent' : e.shiftKey ? 'all' : 'one';
}
