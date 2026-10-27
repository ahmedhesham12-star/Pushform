import type { Vector3 } from 'three';
import { definitionModel } from '../commands';
import { t } from '../i18n';
import { faceEdges } from '../kernel';
import { dragStep, formatLength, parseLengthList } from '../units';
import { toVector, type MarkerKind } from '../viewport';
import { sameEntity, type Tool, type ToolContext } from './tool';

/** Distances below this (mm) are treated as no push at all. */
const MIN_DISTANCE = 0.1;

interface PushState {
  faceId: string;
  /** Point where the face was clicked. */
  origin: Vector3;
  normal: Vector3;
  startY: number;
  /** Distance of the current preview after clamping, in the context's own mm. */
  distance: number;
  /** Local mm per world mm along the normal (1 unless the context is scaled). */
  toLocal: number;
}

/** A push distance, and what it was inferred from (shown with the marker), if anything. */
interface Pointed {
  distance: number;
  at: { point: Vector3; kind: MarkerKind } | null;
}

/**
 * Click a face, move to set the distance, click again (or type a distance).
 * Hovering a point, edge or face anywhere else in the model ends the face
 * level with it, as in SketchUp. Double-clicking a face repeats the last
 * push/pull distance on it.
 */
export function createPushPullTool(ctx: ToolContext): Tool {
  let state: PushState | null = null;

  /**
   * The push distance for the pointer: level with an endpoint or midpoint,
   * an edge or a face under the pointer (anywhere, including other groups and
   * faded geometry); otherwise the distance along the face normal closest to
   * the pointer ray, snapped to a point at that level or to the drag step.
   */
  const pointerDistance = (s: PushState, e: PointerEvent): Pointed => {
    const vp = ctx.viewport;
    const along = (p: Vector3) => p.clone().sub(s.origin).dot(s.normal);
    // Anything level with the face itself (its own edges, coplanar neighbours) would mean no push.
    const off = (p: Vector3) => Math.abs(along(p)) > 0.01;
    const snap = vp.nearestSnap(off);
    if (snap) return { distance: along(snap.point), at: { point: snap.point, kind: snap.kind } };
    const edge = vp.pickEdge('all');
    if (edge && off(edge.point)) return { distance: along(edge.point), at: { point: edge.point, kind: 'edge' } };
    const hit = vp.pickVisiblePoint();
    if (hit && off(hit)) return { distance: along(hit), at: { point: hit, kind: 'face' } };

    const { origin: o, direction: dir } = vp.picker.ray;
    const w0 = s.origin.clone().sub(o);
    const b = s.normal.dot(dir);
    const d1 = s.normal.dot(w0);
    const e1 = dir.dot(w0);
    const den = 1 - b * b;
    const range = vp.camera.distance;
    // Looking straight along the normal there is no closest point: use vertical mouse travel.
    const raw = den < 1e-3 ? (s.startY - e.clientY) * range * 0.002 : (b * e1 - d1) / den;

    const tolerance = range * 0.012;
    let level: number | null = null;
    let best = Infinity;
    for (const c of vp.snapCandidates) {
      const a = along(c.point);
      if (Math.abs(a) > 0.01 && Math.abs(a - raw) < Math.min(tolerance, best)) {
        best = Math.abs(a - raw);
        level = a;
      }
    }
    if (level !== null) return { distance: level, at: { point: s.origin.clone().addScaledVector(s.normal, level), kind: 'plane' } };
    const step = dragStep(ctx.units());
    return { distance: Math.round(raw / step) * step, at: null };
  };

  const preview = (s: PushState, distance: number, at: Pointed['at']) => {
    const r = ctx.session.preview('core.pushPull', { definitionId: ctx.viewport.frame.definitionId, faceId: s.faceId, distance });
    if (!r.ok) return;
    s.distance = r.output.distance;
    ctx.showPreview(r.doc);
    ctx.viewport.paint(s.faceId, 'selected');
    ctx.setMeasurement(t('measure.distance'), formatLength(s.distance, ctx.units()));
    if (at) ctx.viewport.showMarker(at.point, at.kind);
    else ctx.viewport.showMarker(s.origin.clone().addScaledVector(s.normal, s.distance / s.toLocal), 'face');
  };

  const push = (faceId: string, distance: number) => {
    const r = ctx.session.execute('core.pushPull', { definitionId: ctx.viewport.frame.definitionId, faceId, distance });
    if (r.ok) ctx.flash(t('message.pushed', { distance: formatLength(Math.abs(r.output.distance), ctx.units()) }));
    else ctx.flashError(r.error);
  };

  const commit = () => {
    if (!state || Math.abs(state.distance) < MIN_DISTANCE) return ctx.cancel();
    const { faceId, distance } = state;
    ctx.cancel(true);
    push(faceId, distance);
  };

  /** The distance of the last push/pull (as amended), for a double-click repeat. */
  const lastDistance = (): number | null => {
    const last = ctx.session
      .history()
      .findLast((h) => h.commandId === 'core.pushPull');
    return last ? (last.input as { distance: number }).distance : null;
  };

  return {
    id: 'pushPull',
    cursor: 'crosshair',
    hint: () => (state ? t('status.pushPull.active') : t('status.pushPull.idle')),
    measurementLabel: () => t('measure.distance'),
    busy: () => state !== null,

    down(e) {
      if (state) return commit();
      const h = ctx.viewport.pickFace();
      const normal = h && ctx.viewport.normalOf(h.faceId);
      if (!h || !normal) return;
      ctx.selection.hovered = null;
      const frame = ctx.viewport.frame;
      const toLocal = toVector(frame.dirToLocal(normal)).dot(toVector(frame.normalToLocal(normal)));
      state = { faceId: h.faceId, origin: h.point, normal, startY: e.clientY, distance: 0, toLocal };
      // Inference skips the face being pushed and its edges.
      const m = definitionModel(ctx.session.doc, ctx.viewport.frame.definitionId)!;
      ctx.viewport.setExcluded({ faces: new Set([h.faceId]), edges: new Set(faceEdges(m, h.faceId)), instances: new Set() });
      preview(state, 0, null);
      ctx.hint();
    },

    move(e) {
      if (state) {
        const r = pointerDistance(state, e);
        preview(state, r.distance * state.toLocal, r.at);
        return;
      }
      const h = ctx.viewport.pickFace();
      const hovered = h ? { kind: 'face' as const, id: h.faceId } : null;
      if (!sameEntity(hovered, ctx.selection.hovered)) {
        ctx.selection.hovered = hovered;
        ctx.applyHighlights();
      }
    },

    dragEnd() {
      if (state) commit();
    },

    up(_e, dragged, clicks) {
      // Double-click: the second click ended the empty push started by the first; repeat the last distance.
      if (dragged || clicks !== 2 || state) return;
      const distance = lastDistance();
      const h = ctx.viewport.pickFace();
      if (distance !== null && h) push(h.faceId, distance);
    },

    submit(text) {
      if (!state) return ctx.flash(t('error.nothingToSize'), true);
      const r = parseLengthList(text, ctx.units().unit);
      if (!r.ok || r.mm.length !== 1) return ctx.flash(t('error.typeOneDistance'), true);
      preview(state, (Math.sign(state.distance) || 1) * r.mm[0]!, null);
      commit();
    },

    reset() {
      const had = state !== null;
      state = null;
      ctx.viewport.setExcluded(null);
      return had;
    },
  };
}
