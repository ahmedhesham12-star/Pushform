import { Vector3 } from 'three';
import { t } from '../i18n';
import { formatLength } from '../units';
import type { Axis } from '../viewport';
import { AXIS_KEYS, inferPoint } from './inference';
import type { Tool, ToolContext } from './tool';

/** Ends closer than this (mm) make no dimension. */
const MIN_LENGTH = 0.01;

interface Measuring {
  start: Vector3;
  /** Set once both ends are picked: then the pointer places the dimension line. */
  end: Vector3 | null;
  /** From the measured points to the dimension line (world). */
  offset: Vector3;
}

/**
 * Dimension, as in SketchUp: click two points, or click an edge to measure
 * it, then move the pointer to the side and click to place the dimension
 * line. It lies in the plane of the face under the pointer when that face
 * holds the measured line, otherwise in the axis plane through the line that
 * faces the view. Ends on a vertex or an edge follow that geometry afterwards. Arrow keys lock the second point to
 * an axis.
 */
export function createDimensionTool(ctx: ToolContext): Tool {
  let state: Measuring | null = null;
  let lock: Axis | null = null;
  const vp = () => ctx.viewport;
  const fmt = (mm: number) => formatLength(mm, ctx.units());

  /**
   * The plane the dimension line is offset in. It holds the measured line:
   * the plane of a face under the pointer that holds it too, else the one of
   * the context's axis planes through it that faces the view best.
   */
  const offsetPlaneNormal = (s: Measuring, along: Vector3): Vector3 | null => {
    const face = vp().planeUnderCursor();
    if (face?.onFace && Math.abs(face.normal.dot(along)) < 1e-6 && Math.abs(face.point.clone().sub(s.start).dot(face.normal)) < 0.01) return face.normal;
    const view = vp().camera.target.clone().sub(vp().camera.camera.position).normalize();
    let best: Vector3 | null = null;
    for (const axis of ['x', 'y', 'z'] as const) {
      const n = vp().axisDirection(axis);
      if (Math.abs(n.dot(along)) > 1e-6) continue;
      if (!best || Math.abs(n.dot(view)) > Math.abs(best.dot(view))) best = n;
    }
    if (best) return best;
    const n = view.addScaledVector(along, -view.dot(along));
    return n.lengthSq() > 1e-12 ? n.normalize() : null;
  };

  /** The offset under the pointer: across the measured line, in the offset plane. */
  const offsetAt = (s: Measuring): Vector3 => {
    const along = s.end!.clone().sub(s.start).normalize();
    const n = offsetPlaneNormal(s, along);
    const hit = n && vp().picker.rayPlane(s.start, n);
    if (!hit) return s.offset;
    const v = hit.sub(s.start);
    return v.addScaledVector(along, -v.dot(along));
  };

  const preview = (s: Measuring) => {
    const end = s.end!;
    const [a, b] = [s.start.clone().add(s.offset), end.clone().add(s.offset)];
    vp().showGuides([{ points: [s.start, a] }, { points: [end, b] }, { points: [a, b] }]);
    ctx.setMeasurement(t('measure.length'), fmt(vp().frame.localDistance(s.start, end)));
  };

  const setEnd = (s: Measuring, end: Vector3) => {
    if (end.distanceTo(s.start) < MIN_LENGTH) return;
    s.end = end.clone();
    s.offset = offsetAt(s);
    vp().hideMarker();
    preview(s);
    ctx.hint();
  };

  const commit = () => {
    const s = state;
    if (!s?.end) return;
    const frame = vp().frame;
    const start = frame.toLocal(s.start);
    const tip = frame.toLocal(s.start.clone().add(s.offset));
    const length = frame.localDistance(s.start, s.end);
    const input = {
      definitionId: frame.definitionId,
      start,
      end: frame.toLocal(s.end),
      offset: [tip[0] - start[0], tip[1] - start[1], tip[2] - start[2]] as [number, number, number],
    };
    ctx.cancel(true);
    const r = ctx.session.execute('core.addDimension', input);
    if (!r.ok) return ctx.flashError(r.error);
    ctx.flash(t('message.dimensionAdded', { length: fmt(length) }));
    ctx.hint();
  };

  return {
    id: 'dimension',
    cursor: 'crosshair',
    hint: () => t(!state ? 'status.dimension.start' : !state.end ? 'status.dimension.end' : 'status.dimension.place'),
    measurementLabel: () => t('measure.length'),
    busy: () => state !== null,

    down() {
      if (state?.end) return commit();
      if (state) {
        const hit = inferPoint(ctx, state.start, lock);
        if (hit) setEnd(state, hit.point);
        return;
      }
      const first = inferPoint(ctx, null, null);
      if (!first) return;
      state = { start: first.point.clone(), end: null, offset: new Vector3() };
      // Clicking along an edge measures the edge.
      if (first.kind === 'edge' && first.edge) {
        state.start = first.edge.a.clone();
        setEnd(state, first.edge.b);
        return;
      }
      ctx.setMeasurement(t('measure.length'), fmt(0));
      ctx.hint();
    },

    move() {
      if (!state) {
        const hit = inferPoint(ctx, null, null);
        if (hit) vp().showMarker(hit.point, hit.kind);
        else vp().hideMarker();
        return;
      }
      if (state.end) {
        state.offset = offsetAt(state);
        return preview(state);
      }
      const hit = inferPoint(ctx, state.start, lock);
      if (!hit) return;
      vp().showMarker(hit.point, hit.kind);
      vp().showLinePreview(state.start, hit.point, hit.axis);
      ctx.setMeasurement(t('measure.length'), fmt(vp().frame.localDistance(state.start, hit.point)));
    },

    dragEnd() {
      if (state?.end) return commit();
      if (!state) return;
      const hit = inferPoint(ctx, state.start, lock);
      if (hit) setEnd(state, hit.point);
    },

    submit() {
      ctx.flash(t('error.dimensionNoTyping'), true);
    },

    key(e) {
      const axis = AXIS_KEYS[e.key];
      if (!axis || !state || state.end) return false;
      lock = lock === axis ? null : axis;
      return true;
    },

    reset() {
      const had = state !== null;
      state = null;
      lock = null;
      vp().hideMarker();
      vp().clearPreview();
      return had;
    },
  };
}
