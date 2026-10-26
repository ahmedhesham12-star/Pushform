import { t } from '../i18n';
import { previewRectangle } from '../kernel';
import { formatLength, parseLengthList } from '../units';
import { inferOnPlane } from './inference';
import { alignment, rectangleInput, type RectangleDrag } from './rectangleGeometry';
import type { Tool, ToolContext } from './tool';

/** Below this size (mm) the preview is not drawn. */
const MIN_PREVIEW = 0.1;

/** Points and the normal are in world coordinates; sizes are measured along the rectangle's sides. */
interface DrawState extends RectangleDrag {
  faceId: string | null;
  onFace: boolean;
}

/**
 * Two clicks (or click-drag-release) on the ground or on a face. Typed sizes
 * finish it. The sides follow the editing context's axes; started on an edge,
 * or on a face whose edges run along neither axis, the rectangle aligns to
 * that edge instead (an improvement over SketchUp).
 */
export function createRectangleTool(ctx: ToolContext): Tool {
  let state: DrawState | null = null;

  const fmt = (mm: number) => formatLength(Math.abs(mm), ctx.units());
  const sizes = (a: number, b: number) => `${fmt(a)}${t('measure.listSeparator')}${fmt(b)}`;

  const preview = (s: DrawState) => {
    ctx.viewport.clearPreview();
    const r = rectangleInput(ctx.viewport.frame, s);
    ctx.setMeasurement(t('measure.dimensions'), sizes(r.width, r.depth));
    if (Math.abs(r.width) < MIN_PREVIEW && Math.abs(r.depth) < MIN_PREVIEW) return;
    const frame = ctx.viewport.frame;
    const corners = previewRectangle(r.normal, r.corner, r.width, r.depth, r.axis).map((p) => frame.toWorld(p));
    ctx.viewport.showShapePreview(corners, s.normal);
  };

  const commit = (size?: [number, number]) => {
    if (!state) return;
    const s = state;
    const r = rectangleInput(ctx.viewport.frame, s);
    const [width, depth] = size ?? [r.width, r.depth];
    ctx.cancel(true);
    const out = ctx.session.execute('core.drawRectangle', {
      definitionId: ctx.viewport.frame.definitionId,
      faceId: s.faceId,
      normal: s.faceId ? undefined : r.normal,
      corner: r.corner,
      width,
      depth,
      axis: r.axis ?? undefined,
    });
    if (out.ok) ctx.flash(t('message.rectangleAdded', { width: fmt(width), depth: fmt(depth) }));
    else ctx.flashError(out.error);
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
      const at = inferOnPlane(ctx, pl.point, pl.normal, pl.point, pl.onFace ? 'face' : 'ground');
      const frame = ctx.viewport.frame;
      const dir = alignment(
        frame.normalToLocal(pl.normal),
        frame.toLocal(at.point),
        at.edge ? [frame.toLocal(at.edge.a), frame.toLocal(at.edge.b)] : null,
        pl.outline ? pl.outline.map((p) => frame.toLocal(p)) : null,
      );
      const axis = dir ? frame.dirToWorld(dir) : null;
      state = { faceId: pl.faceId, onFace: pl.onFace, normal: pl.normal, start: at.point, current: at.point.clone(), axis };
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
      const { width, depth } = rectangleInput(ctx.viewport.frame, state);
      commit([(Math.sign(width) || 1) * r.mm[0]!, (Math.sign(depth) || 1) * r.mm[1]!]);
    },

    reset() {
      const had = state !== null;
      state = null;
      return had;
    },
  };
}

