import type { Vector3 } from 'three';
import { t, type MessageKey } from '../i18n';
import { MAX_SEGMENTS, previewRegularPolygon } from '../kernel';
import { formatLength, formatNumber, parseTypedValues } from '../units';
import { toPoint, toVector } from '../viewport';
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

interface DrawState {
  faceId: string | null;
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
  const radiusOf = (s: DrawState) => (s.edge ? s.edge.distanceTo(s.center) : 0);
  const show = () => {
    if (!state) return ctx.setMeasurement(t(kind.label), countText());
    ctx.setMeasurement(t(kind.label), `${formatLength(radiusOf(state), ctx.units())}${t('measure.listSeparator')}${countText()}`);
  };

  const preview = (s: DrawState) => {
    show();
    const r = radiusOf(s);
    if (r < 0.1 || !s.edge) return ctx.viewport.clearPreview();
    const dir = toPoint(s.edge.clone().sub(s.center));
    const pts = previewRegularPolygon(toPoint(s.normal), toPoint(s.center), r, count, dir).map(toVector);
    ctx.viewport.showShapePreview(pts, s.normal);
  };

  const commit = (radius: number) => {
    if (!state) return;
    const s = state;
    const direction = s.edge && s.edge.distanceTo(s.center) > 1e-6 ? toPoint(s.edge.clone().sub(s.center)) : null;
    ctx.cancel(true);
    const base = { faceId: s.faceId, center: toPoint(s.center), radius, direction };
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
      const center = ctx.viewport.snapOnPlane(pl.point, pl.normal, pl.point, pl.faceId ? 'face' : 'ground');
      state = { faceId: pl.faceId, normal: pl.normal, center, edge: null };
      show();
      ctx.hint();
    },

    move() {
      if (!state) {
        const pl = ctx.viewport.planeUnderCursor();
        if (pl) ctx.viewport.snapOnPlane(pl.point, pl.normal, pl.point, pl.faceId ? 'face' : 'ground');
        else ctx.viewport.hideMarker();
        return;
      }
      const raw = ctx.viewport.picker.rayPlane(state.center, state.normal);
      if (!raw) return;
      state.edge = ctx.viewport.snapOnPlane(state.center, state.normal, raw, state.faceId ? 'face' : 'ground');
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
