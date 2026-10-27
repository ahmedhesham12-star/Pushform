import type { Vector3 } from 'three';
import { t } from '../i18n';
import { formatLength, parseLengthList } from '../units';
import type { Axis } from '../viewport';
import { copyCursor } from './cursors';
import { AXIS_KEYS, inferPoint, type Inferred } from './inference';
import { isMac } from './shortcuts';
import type { Tool, ToolContext } from './tool';

/** Inferred kinds that are points: from one to another makes a guide line through both. */
const POINTS: ReadonlySet<string> = new Set(['end', 'mid', 'guidePoint', 'intersection']);
/** Distances shorter than this (mm) make no guide. */
const MIN_DISTANCE = 0.01;

interface Measuring {
  start: Vector3;
  /** Started on an edge or guide line: guides run parallel to it (unit direction, world). */
  along: Vector3 | null;
  end: Inferred | null;
}

/**
 * Tape Measure (T), as in SketchUp: click two points to measure the distance.
 * It makes guides unless Ctrl (Option on a Mac) switches it to measuring
 * only: from an edge or guide line, a guide parallel to it at the pointer's
 * distance; from a point to another point, a guide line through both; from a
 * point to anywhere else, a guide point there. Typing a distance places the
 * guide at it, and typing again afterwards amends it. Arrow keys lock an
 * axis while measuring.
 */
export function createTapeTool(ctx: ToolContext): Tool {
  let state: Measuring | null = null;
  let lock: Axis | null = null;
  let guides = true;

  const fmt = (mm: number) => formatLength(mm, ctx.units());
  const toggleKey = () => t(isMac() ? 'key.option' : 'key.ctrl');

  /** The part of `p - start` across the edge measured from. */
  const across = (s: Measuring, p: Vector3) => {
    const v = p.clone().sub(s.start);
    return v.addScaledVector(s.along!, -v.dot(s.along!));
  };
  /** The distance shown and made into a guide, in the context's own mm. */
  const measured = (s: Measuring) => {
    if (!s.end) return 0;
    const frame = ctx.viewport.frame;
    return s.along ? Math.hypot(...frame.dirToLocal(across(s, s.end.point))) : frame.localDistance(s.start, s.end.point);
  };

  const preview = (s: Measuring) => {
    if (!s.end) return;
    const vp = ctx.viewport;
    if (s.along) {
      const at = s.start.clone().add(across(s, s.end.point));
      const lines: { points: Vector3[] }[] = [{ points: [s.start, at] }];
      const seg = guides ? vp.guideSegment(at, s.along) : null;
      if (seg) lines.push({ points: seg });
      vp.showGuides(lines);
    } else {
      vp.showLinePreview(s.start, s.end.point, s.end.axis);
    }
    ctx.setMeasurement(t('measure.length'), fmt(measured(s)));
  };

  /** Finish: show the distance, and make the guide unless measuring only. `typed` is a distance typed in. */
  const commit = (typed?: number) => {
    const s = state;
    if (!s?.end) return;
    const frame = ctx.viewport.frame;
    const distance = typed ?? measured(s);
    const end = s.end;
    ctx.cancel(true);
    ctx.setMeasurement(t('measure.length'), fmt(distance));
    if (!guides || distance < MIN_DISTANCE) {
      ctx.flash(t('message.measured', { distance: fmt(distance) }));
      return ctx.hint();
    }
    const definitionId = frame.definitionId;
    const r = s.along
      ? ctx.session.execute('core.addGuideOffset', {
          definitionId,
          point: frame.toLocal(s.start),
          direction: frame.dirToLocal(s.along),
          side: frame.dirToLocal(across(s, end.point)),
          distance,
        })
      : typed === undefined && POINTS.has(end.kind)
        ? ctx.session.execute('core.addGuideLine', { definitionId, point: frame.toLocal(s.start), direction: frame.dirToLocal(end.point.clone().sub(s.start)) })
        : ctx.session.execute('core.addGuidePoint', {
            definitionId,
            from: frame.toLocal(s.start),
            direction: frame.dirToLocal(end.point.clone().sub(s.start)),
            distance,
          });
    if (!r.ok) return ctx.flashError(r.error);
    ctx.flash(t('message.guideAdded', { distance: fmt(distance) }));
    ctx.hint();
  };

  return {
    id: 'tape',
    get cursor() {
      return guides ? copyCursor('crosshair') : 'crosshair';
    },
    hint: () => {
      const key = toggleKey();
      if (!guides) return t(state ? 'status.tape.measureEnd' : 'status.tape.measureStart', { key });
      if (!state) return t('status.tape.start', { key });
      return t(state.along ? 'status.tape.parallel' : 'status.tape.point', { key });
    },
    measurementLabel: () => t('measure.length'),
    busy: () => state !== null,

    down() {
      if (state) return commit();
      const first = inferPoint(ctx, null, null);
      if (!first) return;
      const onLine = (first.kind === 'edge' || first.kind === 'guide') && first.edge;
      const along = onLine ? first.edge!.b.clone().sub(first.edge!.a).normalize() : null;
      state = { start: first.point.clone(), along, end: null };
      ctx.setMeasurement(t('measure.length'), fmt(0));
      ctx.hint();
    },

    move() {
      if (!state) {
        const hit = inferPoint(ctx, null, null);
        if (hit) ctx.viewport.showMarker(hit.point, hit.kind);
        else ctx.viewport.hideMarker();
        return;
      }
      const hit = inferPoint(ctx, state.start, lock);
      if (!hit) return;
      state.end = hit;
      ctx.viewport.showMarker(hit.point, hit.kind);
      preview(state);
    },

    dragEnd() {
      if (state?.end) commit();
    },

    submit(text) {
      if (!state) return ctx.flash(t('error.nothingToSize'), true);
      const r = parseLengthList(text, ctx.units().unit);
      if (!r.ok || r.mm.length !== 1 || r.mm[0]! <= 0) return ctx.flash(t('error.typeOneDistance'), true);
      const s = state;
      const way = s.end ? (s.along ? across(s, s.end.point) : s.end.point.clone().sub(s.start)) : null;
      if (!way || way.length() < MIN_DISTANCE) return ctx.flash(t(s.along ? 'error.tapeSideFirst' : 'error.tapeDirectionFirst'), true);
      commit(r.mm[0]!);
    },

    key(e) {
      if (e.key === (isMac() ? 'Alt' : 'Control')) {
        guides = !guides;
        if (state) preview(state);
        ctx.hint();
        return true;
      }
      const axis = AXIS_KEYS[e.key];
      if (!axis || !state) return false;
      lock = lock === axis ? null : axis;
      return true;
    },

    reset() {
      const had = state !== null;
      state = null;
      lock = null;
      ctx.viewport.hideMarker();
      return had;
    },
  };
}
