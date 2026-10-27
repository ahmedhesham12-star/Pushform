import type { Vector3 } from 'three';
import { t, type MessageKey } from '../i18n';
import { MAX_SEGMENTS, previewRegularPolygon } from '../kernel';
import { formatLength, formatNumber, parseTypedValues } from '../units';
import { inferOnPlane } from './inference';
import type { Tool, ToolContext, ToolId } from './tool';

interface RadialKind {
  id: Extract<ToolId, 'circle' | 'polygon'>;
  command: 'core.drawCircle' | 'core.drawPolygon';
  defaultCount: number;
  label: MessageKey;
  hintCenter: MessageKey;
  hintRadius: MessageKey;
  added: MessageKey;
  typeHint: MessageKey;
}

export const CIRCLE: RadialKind = {
  id: 'circle',
  command: 'core.drawCircle',
  defaultCount: 24,
  label: 'measure.radiusSegments',
  hintCenter: 'status.circle.center',
  hintRadius: 'status.circle.radius',
  added: 'message.circleAdded',
  typeHint: 'error.typeRadiusOrSegments',
};

export const POLYGON: RadialKind = {
  id: 'polygon',
  command: 'core.drawPolygon',
  defaultCount: 6,
  label: 'measure.radiusSides',
  hintCenter: 'status.polygon.center',
  hintRadius: 'status.polygon.radius',
  added: 'message.polygonAdded',
  typeHint: 'error.typeRadiusOrSides',
};

/** Points and the normal are in world coordinates. */
interface DrawState {
  faceId: string | null;
  onFace: boolean;
  normal: Vector3;
  center: Vector3;
  edge: Vector3 | null;
}

/**
 * Circle and polygon tools: click the center, then a point on the radius (or
 * type a radius). A count with an s suffix (48s) sets the segments or sides,
 * before or while drawing; the count is remembered for the next shape.
 */
export function createRadialTool(ctx: ToolContext, kind: RadialKind): Tool {
  let count = kind.defaultCount;
  let state: DrawState | null = null;

  const countText = () => t('measure.count', { count: formatNumber(count) });
  const radiusOf = (s: DrawState) => (s.edge ? ctx.viewport.frame.localDistance(s.center, s.edge) : 0);
  const show = () => {
    if (!state) return ctx.setMeasurement(t(kind.label), countText());
    ctx.setMeasurement(t(kind.label), `${formatLength(radiusOf(state), ctx.units())}${t('measure.listSeparator')}${countText()}`);
  };

  const preview = (s: DrawState) => {
    show();
    const r = radiusOf(s);
    if (r < 0.1 || !s.edge) return ctx.viewport.clearPreview();
    const frame = ctx.viewport.frame;
    const dir = frame.dirToLocal(s.edge.clone().sub(s.center));
    const pts = previewRegularPolygon(frame.normalToLocal(s.normal), frame.toLocal(s.center), r, count, dir).map((p) => frame.toWorld(p));
    ctx.viewport.showShapePreview(pts, s.normal);
  };

  const commit = (radius: number) => {
    if (!state) return;
    const s = state;
    const frame = ctx.viewport.frame;
    const direction = s.edge && s.edge.distanceTo(s.center) > 1e-6 ? frame.dirToLocal(s.edge.clone().sub(s.center)) : null;
    ctx.cancel(true);
    const base = {
      definitionId: frame.definitionId,
      faceId: s.faceId,
      normal: s.faceId ? undefined : frame.normalToLocal(s.normal),
      center: frame.toLocal(s.center),
      radius,
      direction,
    };
    const r =
      kind.command === 'core.drawCircle'
        ? ctx.session.execute('core.drawCircle', { ...base, segments: count })
        : ctx.session.execute('core.drawPolygon', { ...base, sides: count });
    if (r.ok) ctx.flash(t(kind.added, { radius: formatLength(radius, ctx.units()), count: formatNumber(count) }));
    else ctx.flashError(r.error);
  };

  return {
    id: kind.id,
    cursor: 'crosshair',
    hint: () => t(state ? kind.hintRadius : kind.hintCenter),
    measurementLabel: () => t(kind.label),
    busy: () => state !== null,
    acceptsInput: () => true,
    idleMeasurement: countText,

    down() {
      if (state) return commit(radiusOf(state));
      const pl = ctx.viewport.planeUnderCursor();
      if (!pl) return;
      const center = inferOnPlane(ctx, pl.point, pl.normal, pl.point, pl.onFace ? 'face' : 'ground').point;
      state = { faceId: pl.faceId, onFace: pl.onFace, normal: pl.normal, center, edge: null };
      show();
      ctx.hint();
    },

    move() {
      if (!state) {
        const pl = ctx.viewport.planeUnderCursor();
        if (pl) inferOnPlane(ctx, pl.point, pl.normal, pl.point, pl.onFace ? 'face' : 'ground');
        else ctx.viewport.hideMarker();
        return;
      }
      const raw = ctx.viewport.picker.rayPlane(state.center, state.normal);
      if (!raw) return;
      state.edge = inferOnPlane(ctx, state.center, state.normal, raw, state.onFace ? 'face' : 'ground').point;
      preview(state);
    },

    dragEnd() {
      if (state?.edge) commit(radiusOf(state));
    },

    submit(text) {
      const typed = parseTypedValues(text, ctx.units().unit);
      if (!typed.ok || typed.lengths.length > 1 || typed.counts.length > 1) return ctx.flash(t(kind.typeHint), true);
      const c = typed.counts[0];
      if (c !== undefined) {
        if (c < 3 || c > MAX_SEGMENTS) return ctx.flash(t('error.badCount', { max: formatNumber(MAX_SEGMENTS) }), true);
        count = c;
      }
      const radius = typed.lengths[0];
      if (radius !== undefined) {
        if (!state) return ctx.flash(t('error.nothingToSize'), true);
        if (radius <= 0) return ctx.flash(t(kind.typeHint), true);
        return commit(radius);
      }
      if (state) preview(state);
      else show();
    },

    reset() {
      const had = state !== null;
      state = null;
      return had;
    },
  };
}
