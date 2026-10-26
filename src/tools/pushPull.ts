import type { Vector3 } from 'three';
import { rootModel } from '../commands';
import { t } from '../i18n';
import { dragStep, formatLength, parseLengthList } from '../units';
import { sameEntity, type Tool, type ToolContext } from './tool';

/** Distances below this (mm) are treated as no push at all. */
const MIN_DISTANCE = 0.1;

interface PushState {
  faceId: string;
  /** Point where the face was clicked. */
  origin: Vector3;
  normal: Vector3;
  startY: number;
  /** Distance of the current preview after clamping, in mm. */
  distance: number;
}

/** Click a face, move to set the distance, click again (or type a distance). */
export function createPushPullTool(ctx: ToolContext): Tool {
  let state: PushState | null = null;

  /** Distance along the face normal closest to the pointer ray, snapped to inference points or the drag step. */
  const pointerDistance = (s: PushState, e: PointerEvent): { distance: number; snapped: boolean } => {
    const { origin: o, direction: dir } = ctx.viewport.picker.ray;
    const w0 = s.origin.clone().sub(o);
    const b = s.normal.dot(dir);
    const d1 = s.normal.dot(w0);
    const e1 = dir.dot(w0);
    const den = 1 - b * b;
    const range = ctx.viewport.camera.distance;
    // Looking straight along the normal there is no closest point: use vertical mouse travel.
    const raw = den < 1e-3 ? (s.startY - e.clientY) * range * 0.002 : (b * e1 - d1) / den;

    const tolerance = range * 0.012;
    let snap: number | null = null;
    let best = Infinity;
    for (const c of ctx.viewport.snapCandidates) {
      const along = c.point.clone().sub(s.origin).dot(s.normal);
      if (Math.abs(along) > 0.01 && Math.abs(along - raw) < Math.min(tolerance, best)) {
        best = Math.abs(along - raw);
        snap = along;
      }
    }
    if (snap !== null) return { distance: snap, snapped: true };
    const step = dragStep(ctx.units());
    return { distance: Math.round(raw / step) * step, snapped: false };
  };

  const preview = (s: PushState, distance: number, snapped: boolean) => {
    const r = ctx.session.preview('core.pushPull', { faceId: s.faceId, distance });
    if (!r.ok) return;
    s.distance = r.output.distance;
    ctx.viewport.showModel(rootModel(r.doc));
    ctx.viewport.paint(s.faceId, 'selected');
    ctx.setMeasurement(t('measure.distance'), formatLength(s.distance, ctx.units()));
    ctx.viewport.showMarker(s.origin.clone().addScaledVector(s.normal, s.distance), snapped ? 'plane' : 'face');
  };

  const commit = () => {
    if (!state || Math.abs(state.distance) < MIN_DISTANCE) return ctx.cancel();
    const { faceId, distance } = state;
    ctx.cancel(true);
    const r = ctx.session.execute('core.pushPull', { faceId, distance });
    if (r.ok) ctx.flash(t('message.pushed', { distance: formatLength(Math.abs(r.output.distance), ctx.units()) }));
    else ctx.flashError(r.error);
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
      state = { faceId: h.faceId, origin: h.point, normal, startY: e.clientY, distance: 0 };
      preview(state, 0, false);
      ctx.hint();
    },

    move(e) {
      if (state) {
        const r = pointerDistance(state, e);
        preview(state, r.distance, r.snapped);
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

    submit(text) {
      if (!state) return ctx.flash(t('error.nothingToSize'), true);
      const r = parseLengthList(text, ctx.units().unit);
      if (!r.ok || r.mm.length !== 1) return ctx.flash(t('error.typeOneDistance'), true);
      preview(state, (Math.sign(state.distance) || 1) * r.mm[0]!, false);
      commit();
    },

    reset() {
      const had = state !== null;
      state = null;
      return had;
    },
  };
}
