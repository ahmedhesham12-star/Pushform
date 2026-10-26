import { definitionModel } from '../commands';
import { t } from '../i18n';
import { edgeGroup, faceEdges, listEdges } from '../kernel';
import { formatNumber, parseTypedValues, type LengthUnit } from '../units';
import { entityOf, type ToolContext } from './tool';

/** The selection a Move or Rotate works on, as command input. */
export interface Taken {
  faceIds: string[];
  edgeIds: string[];
  instanceIds: string[];
  /** A corner taken on its own (nothing selected, the pointer on an endpoint). */
  vertexIds?: string[];
}

/**
 * For an array (x3, /4) typed before the first copy is placed: the message
 * asking for that copy first. Null when the text is not an array.
 */
export function arrayBeforeCopy(text: string, unit: LengthUnit): string | null {
  const r = parseTypedValues(text, unit);
  const a = r.ok ? r.arrays[0] : undefined;
  if (!a) return null;
  return t('error.arrayNeedsCopy', { array: t(a.divide ? 'measure.divide' : 'measure.multiply', { count: formatNumber(a.count) }) });
}

export const hasSelection = (ctx: ToolContext) => ctx.selection.faces.size + ctx.selection.edges.size + ctx.selection.instances.size > 0;

/**
 * The selection to move or rotate: the current one, or with nothing selected
 * the face, edge, group or component under the pointer (which becomes the
 * selection, as in SketchUp). With `corners` (Move), an endpoint under the
 * pointer moves on its own. Inference skips what was taken from now on, so it
 * cannot snap to itself. Null when there is nothing to take.
 */
export function takeSelection(ctx: ToolContext, corners = false): Taken | null {
  const { selection } = ctx;
  const m = definitionModel(ctx.session.doc, ctx.viewport.frame.definitionId)!;
  const corner = corners && cornerUnder(ctx);
  if (corner) {
    const frame = ctx.viewport.frame;
    const at = frame.toWorld(corner.point);
    const middles = listEdges(m)
      .filter((e) => [e.a, e.b].some((p) => p.every((c, i) => c === corner.point[i])))
      .map((e) => frame.toWorld([(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2]));
    ctx.viewport.setExcluded({ faces: new Set(), edges: new Set(), instances: new Set(), points: [at, ...middles] });
    return { faceIds: [], edgeIds: [], instanceIds: [], vertexIds: [corner.vertex] };
  }
  if (!hasSelection(ctx)) {
    const hit = entityOf(ctx.viewport.pick());
    if (!hit) return null;
    if (hit.kind === 'face') selection.faces.add(hit.id);
    else if (hit.kind === 'edge') for (const e of edgeGroup(m, hit.id)) selection.edges.add(e);
    else selection.instances.add(hit.id);
    selection.hovered = null;
    ctx.applyHighlights();
  }
  const edges = new Set([...selection.edges, ...[...selection.faces].flatMap((f) => faceEdges(m, f))]);
  ctx.viewport.setExcluded({ faces: new Set(selection.faces), edges, instances: new Set(selection.instances) });
  return { faceIds: [...selection.faces], edgeIds: [...selection.edges], instanceIds: [...selection.instances] };
}

/** After the command: what moved (or the copies) is the selection, as in SketchUp. */
export function selectResult(ctx: ToolContext, out: Taken): void {
  const { selection } = ctx;
  selection.faces.clear();
  selection.edges.clear();
  selection.instances.clear();
  for (const f of out.faceIds) selection.faces.add(f);
  for (const e of out.edgeIds) selection.edges.add(e);
  for (const i of out.instanceIds) selection.instances.add(i);
  ctx.applyHighlights();
}

/** With nothing selected: the editing context's endpoint under the pointer, which Move and Rotate take on their own. */
function cornerUnder(ctx: ToolContext): { vertex: string; point: [number, number, number] } | null {
  if (hasSelection(ctx)) return null;
  const snap = ctx.viewport.nearestSnap(() => true);
  const context = ctx.contextPath();
  if (snap?.kind !== 'end' || !snap.vertex || snap.path.length !== context.length || snap.path.some((id, i) => id !== context[i])) return null;
  return { vertex: snap.vertex, point: ctx.viewport.frame.toLocal(snap.point) };
}

/** Hover feedback while idle: with nothing selected, highlight what a click would take (nothing for a corner). */
export function hoverTakeable(ctx: ToolContext, corners = false): void {
  if (hasSelection(ctx)) return;
  const hovered = corners && cornerUnder(ctx) ? null : entityOf(ctx.viewport.pick());
  const h = ctx.selection.hovered;
  if (hovered?.kind !== h?.kind || hovered?.id !== h?.id) {
    ctx.selection.hovered = hovered;
    ctx.applyHighlights();
  }
}
