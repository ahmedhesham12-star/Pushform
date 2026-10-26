import type { Vector3 } from 'three';
import { t } from '../i18n';
import { planeAxes, previewRectangle } from '../kernel';
import { formatLength, parseLengthList } from '../units';
import { toVector } from '../viewport';
import { inferOnPlane } from './inference';
import type { Tool, ToolContext } from './tool';

/** Below this size (mm) the preview is not drawn. */
const MIN_PREVIEW = 0.1;

/** Points and the normal are in world coordinates; sizes are measured along the editing context's axes. */
interface DrawState {
  faceId: string | null;
  onFace: boolean;
  normal: Vector3;
  start: Vector3;
  current: Vector3;
}

/** Two clicks (or click-drag-release) on the ground or on a face. Typed sizes finish it. */
export function createRectangleTool(ctx: ToolContext): Tool {
  let state: DrawState | null = null;

  const fmt = (mm: number) => formatLength(Math.abs(mm), ctx.units());
  const sizes = (a: number, b: number) => `${fmt(a)}${t('measure.listSeparator')}${fmt(b)}`;

  const dims = (s: DrawState): [number, number] => {
    const frame = ctx.viewport.frame;
    const [u, v] = planeAxes(frame.normalToLocal(s.normal));
    const d = toVector(frame.toLocal(s.current)).sub(toVector(frame.toLocal(s.start)));
    return [d.dot(toVector(u)), d.dot(toVector(v))];
  };

  const preview = (s: DrawState) => {
    ctx.viewport.clearPreview();
    const [du, dv] = dims(s);
    ctx.setMeasurement(t('measure.dimensions'), sizes(du, dv));
    if (Math.abs(du) < MIN_PREVIEW && Math.abs(dv) < MIN_PREVIEW) return;
    const frame = ctx.viewport.frame;
    const corners = previewRectangle(frame.normalToLocal(s.normal), frame.toLocal(s.start), du, dv).map((p) => frame.toWorld(p));
    ctx.viewport.showShapePreview(corners, s.normal);
  };

  const commit = (size?: [number, number]) => {
    if (!state) return;
    const s = state;
    const [du, dv] = size ?? dims(s);
    ctx.cancel(true);
    const frame = ctx.viewport.frame;
    const r = ctx.session.execute('core.drawRectangle', {
      definitionId: frame.definitionId,
      faceId: s.faceId,
      normal: s.faceId ? undefined : frame.normalToLocal(s.normal),
      corner: frame.toLocal(s.start),
      width: du,
      depth: dv,
    });
    if (r.ok) ctx.flash(t('message.rectangleAdded', { width: fmt(du), depth: fmt(dv) }));
    else ctx.flashError(r.error);
  };

  return {
    id: 'rectangle',
    cursor: 'crosshair',
    hint: () => (state ? t('status.rectangle.second') : t('status.rectangle.first')),
    measurementLabel: () => t('measure.dimensions'),
    busy: () => state !== null,

    down() {
      if (state) return commit();
      const pl = ctx.viewport.planeUnderCursor();
      if (!pl) return;
      const start = inferOnPlane(ctx, pl.point, pl.normal, pl.point, pl.onFace ? 'face' : 'ground').point;
      state = { faceId: pl.faceId, onFace: pl.onFace, normal: pl.normal, start, current: start.clone() };
      ctx.setMeasurement(t('measure.dimensions'), sizes(0, 0));
      ctx.hint();
    },

    move() {
      if (!state) {
        const pl = ctx.viewport.planeUnderCursor();
        if (pl) inferOnPlane(ctx, pl.point, pl.normal, pl.point, pl.onFace ? 'face' : 'ground');
        else ctx.viewport.hideMarker();
        return;
      }
      const raw = ctx.viewport.picker.rayPlane(state.start, state.normal);
      if (!raw) return;
      state.current = inferOnPlane(ctx, state.start, state.normal, raw, state.onFace ? 'face' : 'ground').point;
      preview(state);
    },

    dragEnd() {
      if (state) commit();
    },

    submit(text) {
      if (!state) return ctx.flash(t('error.nothingToSize'), true);
      const r = parseLengthList(text, ctx.units().unit);
      if (!r.ok || r.mm.length < 2 || r.mm.slice(0, 2).some((v) => v <= 0)) {
        return ctx.flash(t('error.typeTwoSizes'), true);
      }
      const [du, dv] = dims(state);
      commit([(Math.sign(du) || 1) * r.mm[0]!, (Math.sign(dv) || 1) * r.mm[1]!]);
    },

    reset() {
      const had = state !== null;
      state = null;
      return had;
    },
  };
}
