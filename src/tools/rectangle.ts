import type { Vector3 } from 'three';
import { t } from '../i18n';
import { previewRectangle } from '../kernel';
import { formatLength, parseLengthList } from '../units';
import type { PlaneHit } from '../viewport';
import { planeHolding, startsLoose } from './drawingPlane';
import { inferOnPlane } from './inference';
import { alignment, rectangleInput, type RectangleDrag } from './rectangleGeometry';
import type { Tool, ToolContext } from './tool';

/** Below this size (mm) the preview is not drawn. */
const MIN_PREVIEW = 0.1;

/** Points and the normal are in world coordinates; sizes are measured along the rectangle's sides. */
interface DrawState extends RectangleDrag {
  faceId: string | null;
  onFace: boolean;
  /** Started on an edge or a corner: the plane is the face under the pointer that holds the start. */
  loose: boolean;
  /** The edge the first click was on, to align to. */
  edge: { a: Vector3; b: Vector3 } | null;
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

  /** The direction to align to on a plane (world), or null for the context's axes. */
  const axisFor = (pl: PlaneHit, start: Vector3, edge: DrawState['edge']) => {
    const frame = ctx.viewport.frame;
    const dir = alignment(
      frame.normalToLocal(pl.normal),
      frame.toLocal(start),
      edge ? [frame.toLocal(edge.a), frame.toLocal(edge.b)] : null,
      pl.outline ? pl.outline.map((p) => frame.toLocal(p)) : null,
    );
    return dir ? frame.dirToWorld(dir) : null;
  };

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
      const edge = at.edge ?? null;
      state = { faceId: pl.faceId, onFace: pl.onFace, normal: pl.normal, start: at.point, current: at.point.clone(), axis: axisFor(pl, at.point, edge), loose: startsLoose(at), edge };
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
      const pl = state.loose ? planeHolding(ctx, [state.start], { point: state.start, normal: state.normal }) : null;
      if (pl) Object.assign(state, { faceId: pl.faceId, onFace: pl.onFace, normal: pl.normal, axis: axisFor(pl, state.start, state.edge) });
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

