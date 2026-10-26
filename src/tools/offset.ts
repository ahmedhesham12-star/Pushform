import type { Vector3 } from 'three';
import { definitionModel } from '../commands';
import { t } from '../i18n';
import { faceEdges, offsetDistance, offsetPath, type OffsetPath } from '../kernel';
import { dragStep, formatLength, parseLengthList } from '../units';
import { inferOnPlane } from './inference';
import { sameEntity, type Tool, type ToolContext } from './tool';

/** Offsets smaller than this (mm) are no offset at all. */
const MIN_DISTANCE = 0.1;

interface OffsetState {
  faceId: string | null;
  edgeIds: string[];
  /** What is offset, in the editing context's coordinates. */
  path: OffsetPath;
  /** The path's plane in world coordinates. */
  planePoint: Vector3;
  normal: Vector3;
  distance: number;
  /** The first click has been released; the next release finishes (or, as a double-click, repeats). */
  armed: boolean;
}

/**
 * Offset (F), as in SketchUp: click a face, move in or out so the new loop
 * follows the pointer, click again or type a distance. With connected edges
 * selected, they are offset instead. Points and edges under the pointer give
 * exact distances; otherwise they are rounded to the drag step.
 * Double-clicking a face repeats the last offset on it.
 */
export function createOffsetTool(ctx: ToolContext): Tool {
  let state: OffsetState | null = null;

  const fmt = (mm: number) => formatLength(Math.abs(mm), ctx.units());
  const model = () => definitionModel(ctx.session.doc, ctx.viewport.frame.definitionId)!;
  const target = (s: OffsetState) => (s.faceId ? { faceId: s.faceId } : { edgeIds: s.edgeIds });

  /** Offset distance whose loop passes through the pointer, by inference in the path's plane. */
  const pointerDistance = (s: OffsetState): number | null => {
    const raw = ctx.viewport.picker.rayPlane(s.planePoint, s.normal);
    if (!raw) return null;
    const at = inferOnPlane(ctx, s.planePoint, s.normal, raw, 'face');
    const d = offsetDistance(s.path, ctx.viewport.frame.toLocal(at.point));
    if (at.kind !== 'face') return d;
    const step = dragStep(ctx.units());
    return Math.round(d / step) * step;
  };

  const preview = (s: OffsetState) => {
    ctx.setMeasurement(t('measure.distance'), fmt(s.distance));
    if (Math.abs(s.distance) < MIN_DISTANCE) return ctx.viewport.hidePreview();
    const r = ctx.session.preview('core.offset', { definitionId: ctx.viewport.frame.definitionId, ...target(s), distance: s.distance });
    if (r.ok) ctx.showPreview(r.doc);
    else ctx.viewport.hidePreview();
  };

  const run = (faceOrEdges: { faceId: string } | { edgeIds: string[] }, distance: number) => {
    const r = ctx.session.execute('core.offset', { definitionId: ctx.viewport.frame.definitionId, ...faceOrEdges, distance });
    if (r.ok) ctx.flash(t('message.offset', { distance: fmt(distance) }));
    else ctx.flashError(r.error);
  };

  const commit = (distance?: number) => {
    if (!state) return;
    const s = state;
    const d = distance ?? s.distance;
    if (Math.abs(d) < MIN_DISTANCE) return ctx.cancel();
    ctx.cancel(true);
    run(target(s), d);
  };

  /** The distance of the last offset (as amended), for a double-click repeat. */
  const lastDistance = (): number | null => {
    const last = ctx.session.history().findLast((h) => h.commandId === 'core.offset');
    return last ? (last.input as { distance: number }).distance : null;
  };

  return {
    id: 'offset',
    cursor: 'crosshair',
    keepsSelection: true,
    hint: () => (state ? t('status.offset.active') : t('status.offset.idle')),
    measurementLabel: () => t('measure.distance'),
    busy: () => state !== null,

    down() {
      // An offset in progress finishes when the button is released (see up).
      if (state) return;
      const sel = ctx.selection;
      // Selected edges (and nothing else) are offset; otherwise the face under the pointer.
      const edgesOnly = sel.edges.size > 0 && !sel.faces.size && !sel.instances.size;
      const faceId = edgesOnly ? null : (ctx.viewport.pickFace()?.faceId ?? null);
      if (!edgesOnly && !faceId) return;
      const edgeIds = edgesOnly ? [...sel.edges] : [];
      const m = model();
      const found = offsetPath(m, faceId, edgeIds);
      if (!found.ok) return ctx.flashError({ code: found.error });
      const frame = ctx.viewport.frame;
      // Inference skips the boundary being offset: snapping to it would mean no offset.
      const own = faceId ? faceEdges(m, faceId) : edgeIds;
      ctx.viewport.setExcluded({ faces: new Set(faceId ? [faceId] : []), edges: new Set(own), instances: new Set() });
      ctx.selection.hovered = null;
      state = {
        faceId,
        edgeIds,
        path: found.path,
        planePoint: frame.toWorld(found.path.points[0]!),
        normal: frame.dirToWorld(found.path.normal).normalize(),
        distance: 0,
        armed: false,
      };
      state.distance = pointerDistance(state) ?? 0;
      preview(state);
      ctx.hint();
    },

    move() {
      if (state) {
        const d = pointerDistance(state);
        if (d === null) return;
        state.distance = d;
        preview(state);
        return;
      }
      const h = ctx.viewport.pickFace();
      const hovered = h ? { kind: 'face' as const, id: h.faceId } : null;
      if (!sameEntity(hovered, ctx.selection.hovered)) {
        ctx.selection.hovered = hovered;
        ctx.applyHighlights();
      }
    },

    up(_e, dragged, clicks) {
      if (!state) return;
      if (!state.armed) {
        // Click-drag-release finishes at the release; a plain click waits for the second one.
        if (dragged) return commit();
        state.armed = true;
        return;
      }
      if (clicks >= 2 && state.faceId) {
        // Double-click: repeat the last offset on this face instead.
        const faceId = state.faceId;
        const distance = lastDistance();
        ctx.cancel();
        if (distance !== null) run({ faceId }, distance);
        return;
      }
      commit();
    },

    submit(text) {
      if (!state) return ctx.flash(t('error.nothingToSize'), true);
      const r = parseLengthList(text, ctx.units().unit);
      if (!r.ok || r.mm.length !== 1 || r.mm[0] === 0) return ctx.flash(t('error.typeOneDistance'), true);
      // A typed distance goes the way the pointer is (inward when unclear); a minus sign flips it.
      commit((Math.sign(state.distance) || 1) * r.mm[0]!);
    },

    reset() {
      const had = state !== null;
      state = null;
      ctx.viewport.setExcluded(null);
      ctx.viewport.hidePreview();
      return had;
    },
  };
}
