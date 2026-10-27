import type { Vector3 } from 'three';
import { t } from '../i18n';
import { formatAngle, parseAngle } from '../units';
import type { Axis } from '../viewport';
import { copyCursor } from './cursors';
import { AXIS_KEYS, inferPoint } from './inference';
import { aim, protractorNormal, protractorRadius, protractorRing, snappedAngle } from './protractorGeometry';
import { isMac } from './shortcuts';
import type { Tool, ToolContext } from './tool';
import { arrayBeforeCopy, hasSelection, hoverTakeable, selectResult, takeSelection, type Taken } from './transformSelection';

interface RotateState extends Taken {
  center: Vector3;
  /** Axis of rotation (world), the protractor's normal. */
  normal: Vector3;
  /** Unit direction from the center to the start of the angle, once picked. */
  start: Vector3 | null;
  /** Current angle in degrees, counter-clockwise looking against the normal. */
  angle: number;
}

/**
 * Rotate (Q), as in SketchUp: the protractor lies on the face under the
 * pointer (or the ground; arrow keys lock it to the red, green or blue axis).
 * Click the center, then the start of the angle, then the end, or type an
 * angle. Angles snap to 15 degree steps; points, edges and faces under the
 * pointer give exact angles. Ctrl (Option on a Mac) toggles copying; after a
 * copy, x5 or /4 makes an array.
 */
export function createRotateTool(ctx: ToolContext): Tool {
  let state: RotateState | null = null;
  let lock: Axis | null = null;
  let copy = false;
  const label = () => t(copy ? 'measure.copyAngle' : 'measure.angle');

  const vp = () => ctx.viewport;
  const copyKey = () => t(isMac() ? 'key.option' : 'key.ctrl');

  const input = (s: RotateState, angle: number) => {
    const frame = vp().frame;
    return {
      definitionId: frame.definitionId,
      faceIds: s.faceIds,
      edgeIds: s.edgeIds,
      instanceIds: s.instanceIds,
      ...(s.annotationIds?.length ? { annotationIds: s.annotationIds } : {}),
      center: frame.toLocal(s.center),
      axis: frame.dirToLocal(s.normal),
      angle,
    };
  };

  const guides = (s: RotateState, current: Vector3 | null) => {
    const lines: { points: Vector3[]; closed?: boolean; axis?: Axis | null }[] = [protractorRing(ctx, s.center, s.normal, lock)];
    const r = protractorRadius(ctx) * 1.4;
    if (s.start) lines.push({ points: [s.center, s.center.clone().addScaledVector(s.start, r)] });
    if (current) lines.push({ points: [s.center, s.center.clone().addScaledVector(current, r)] });
    vp().showGuides(lines);
  };

  const preview = (s: RotateState) => {
    ctx.setMeasurement(label(), formatAngle(s.angle));
    if (Math.abs(s.angle) < 1e-9) return vp().hidePreview();
    const r = copy
      ? ctx.session.preview('core.rotateCopies', { ...input(s, s.angle), copies: 1, divide: false })
      : ctx.session.preview('core.rotate', input(s, s.angle));
    if (r.ok) ctx.showPreview(r.doc);
    else vp().hidePreview();
  };

  const commit = (angle?: number) => {
    if (!state?.start) return;
    const s = state;
    const a = angle ?? s.angle;
    if (Math.abs(a) < 1e-9) return ctx.cancel();
    const wasCopy = copy;
    ctx.cancel(true);
    const r = wasCopy
      ? ctx.session.execute('core.rotateCopies', { ...input(s, a), copies: 1, divide: false })
      : ctx.session.execute('core.rotate', input(s, a));
    if (!r.ok) return ctx.flashError(r.error);
    selectResult(ctx, r.output);
    ctx.flash(t(wasCopy ? 'message.rotateCopied' : 'message.rotated', { angle: formatAngle(a) }));
    ctx.hint();
  };

  return {
    id: 'rotate',
    get cursor() {
      return copy ? copyCursor('crosshair') : 'crosshair';
    },
    keepsSelection: true,
    hint: () => {
      const key = copyKey();
      if (!state) return t(hasSelection(ctx) ? 'status.rotate.center' : 'status.rotate.pick', { key });
      if (!state.start) return t('status.rotate.start', { key });
      return t(copy ? 'status.rotate.copy' : 'status.rotate.angle', { key });
    },
    measurementLabel: label,
    busy: () => state?.start != null,
    active: () => state !== null,

    down(e) {
      if (state?.start) return commit();
      if (state) {
        const a = aim(ctx, state.center, state.normal);
        if (!a) return;
        state.start = a.dir;
        guides(state, a.dir);
        ctx.hint();
        return;
      }
      const normal = protractorNormal(ctx, lock);
      const center = inferPoint(ctx, null, null);
      const taken = center && takeSelection(ctx);
      if (!center || !taken) return;
      if (isMac() ? e.altKey : e.ctrlKey) copy = true;
      state = { ...taken, center: center.point, normal, start: null, angle: 0 };
      guides(state, null);
      ctx.setMeasurement(label(), formatAngle(0));
      ctx.hint();
    },

    move() {
      if (!state) {
        hoverTakeable(ctx);
        const hit = inferPoint(ctx, null, null);
        if (!hit) return vp().hideMarker();
        vp().showMarker(hit.point, hit.kind);
        vp().showGuides([protractorRing(ctx, hit.point, protractorNormal(ctx, lock), lock)]);
        return;
      }
      const a = aim(ctx, state.center, state.normal);
      if (!a) return;
      if (!state.start) return guides(state, a.dir);
      state.angle = snappedAngle(state.start, a.dir, state.normal, a.inferred);
      guides(state, a.dir);
      preview(state);
    },

    dragEnd() {
      if (state?.start && Math.abs(state.angle) > 1e-9) commit();
    },

    submit(text) {
      if (!state?.start) return ctx.flash(t('error.nothingToSize'), true);
      const early = arrayBeforeCopy(text, ctx.units().unit);
      if (early) return ctx.flash(early, true);
      const a = parseAngle(text);
      if (a === null || a === 0) return ctx.flash(t('error.typeAngle'), true);
      // A typed angle turns the way the pointer does, as typed lengths keep their direction.
      commit((Math.sign(state.angle) || 1) * a);
    },

    key(e) {
      if (e.key === (isMac() ? 'Alt' : 'Control')) {
        copy = !copy;
        if (state?.start) preview(state);
        else ctx.setMeasurementLabel(label());
        ctx.hint();
        return true;
      }
      const axis = AXIS_KEYS[e.key];
      // The axis locks the protractor before the center is placed, as in SketchUp.
      if (!axis || state) return false;
      lock = lock === axis ? null : axis;
      return true;
    },

    reset() {
      const had = state !== null;
      state = null;
      lock = null;
      copy = false;
      vp().setExcluded(null);
      vp().hidePreview();
      vp().clearPreview();
      return had;
    },
  };
}
