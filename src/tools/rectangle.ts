import type { Vector3 } from 'three';
import { t } from '../i18n';
import { planeAxes, previewRectangle } from '../kernel';
import { formatLength, parseLengthList } from '../units';
import { toPoint, toVector } from '../viewport';
import type { Tool, ToolContext } from './tool';

/** Below this size (mm) the preview is not drawn. */
const MIN_PREVIEW = 0.1;

interface DrawState {
  faceId: string | null;
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
    const [u, v] = planeAxes(toPoint(s.normal));
    const d = s.current.clone().sub(s.start);
    return [d.dot(toVector(u)), d.dot(toVector(v))];
  };

  const preview = (s: DrawState) => {
    ctx.viewport.clearPreview();
    const [du, dv] = dims(s);
    ctx.setMeasurement(t('measure.dimensions'), sizes(du, dv));
    if (Math.abs(du) < MIN_PREVIEW && Math.abs(dv) < MIN_PREVIEW) return;
    const corners = previewRectangle(toPoint(s.normal), toPoint(s.start), du, dv).map(toVector);
    ctx.viewport.showShapePreview(corners, s.normal);
  };

  const commit = (size?: [number, number]) => {
    if (!state) return;
    const s = state;
    const [du, dv] = size ?? dims(s);
    ctx.cancel(true);
    const r = ctx.session.execute('core.drawRectangle', {
      faceId: s.faceId,
      corner: toPoint(s.start),
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
      const start = ctx.viewport.snapOnPlane(pl.point, pl.normal, pl.point, pl.faceId ? 'face' : 'ground');
      state = { faceId: pl.faceId, normal: pl.normal, start, current: start.clone() };
      ctx.setMeasurement(t('measure.dimensions'), sizes(0, 0));
      ctx.hint();
    },

    move() {
      if (!state) {
        const pl = ctx.viewport.planeUnderCursor();
        if (pl) ctx.viewport.snapOnPlane(pl.point, pl.normal, pl.point, pl.faceId ? 'face' : 'ground');
        else ctx.viewport.hideMarker();
        return;
      }
      const raw = ctx.viewport.picker.rayPlane(state.start, state.normal);
      if (!raw) return;
      state.current = ctx.viewport.snapOnPlane(state.start, state.normal, raw, state.faceId ? 'face' : 'ground');
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
