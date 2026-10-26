import { Vector3 } from 'three';
import { t } from '../i18n';
import { formatAngle, parseAngle } from '../units';
import type { Axis } from '../viewport';
import { AXIS_KEYS, inferPoint } from './inference';
import { aim, protractorNormal, protractorRadius, protractorRing, snappedAngle } from './protractorGeometry';
import type { Tool, ToolContext } from './tool';

interface Measuring {
  center: Vector3;
  /** The protractor's axis (world). */
  normal: Vector3;
  /** Unit direction the angle is measured from, once picked. */
  base: Vector3 | null;
  /** Current angle in degrees, counter-clockwise looking against the normal. */
  angle: number;
}

/**
 * Protractor, as in SketchUp: the protractor lies on the face under the
 * pointer or the ground (arrow keys lock it to an axis). Click the center,
 * then a point on the base line, then the angle, or type it: an angled guide
 * line through the center. Angles snap to 15 degree steps; points, edges and
 * guides give exact ones. Typing an angle afterwards amends it.
 */
export function createProtractorTool(ctx: ToolContext): Tool {
  let state: Measuring | null = null;
  let lock: Axis | null = null;
  const vp = () => ctx.viewport;

  /** The direction at the current angle from the base. */
  const turned = (s: Measuring, angle: number) => s.base!.clone().applyAxisAngle(s.normal, (angle * Math.PI) / 180);

  const show = (s: Measuring, current: Vector3 | null) => {
    const r = protractorRadius(ctx) * 1.4;
    const lines: { points: Vector3[]; closed?: boolean; axis?: Axis | null }[] = [protractorRing(ctx, s.center, s.normal, lock)];
    if (s.base) lines.push({ points: [s.center, s.center.clone().addScaledVector(s.base, r)] });
    if (current) lines.push({ points: [s.center, s.center.clone().addScaledVector(current, r)] });
    if (s.base) {
      const seg = vp().guideSegment(s.center, turned(s, s.angle));
      if (seg) lines.push({ points: seg });
    }
    vp().showGuides(lines);
    ctx.setMeasurement(t('measure.angle'), formatAngle(s.angle));
  };

  const commit = (angle?: number) => {
    const s = state;
    if (!s?.base) return;
    const a = angle ?? s.angle;
    const frame = vp().frame;
    ctx.cancel(true);
    const r = ctx.session.execute('core.addGuideAngle', {
      definitionId: frame.definitionId,
      center: frame.toLocal(s.center),
      base: frame.dirToLocal(s.base),
      axis: frame.dirToLocal(s.normal),
      angle: a,
    });
    if (!r.ok) return ctx.flashError(r.error);
    ctx.flash(t('message.angleGuideAdded', { angle: formatAngle(a) }));
    ctx.hint();
  };

  return {
    id: 'protractor',
    cursor: 'crosshair',
    hint: () => t(!state ? 'status.protractor.center' : !state.base ? 'status.protractor.base' : 'status.protractor.angle'),
    measurementLabel: () => t('measure.angle'),
    busy: () => state?.base != null,
    active: () => state !== null,

    down() {
      if (state?.base) return commit();
      if (state) {
        const a = aim(ctx, state.center, state.normal);
        if (!a) return;
        state.base = a.dir;
        show(state, a.dir);
        ctx.hint();
        return;
      }
      const normal = protractorNormal(ctx, lock);
      const center = inferPoint(ctx, null, null);
      if (!center) return;
      state = { center: center.point, normal, base: null, angle: 0 };
      show(state, null);
      ctx.hint();
    },

    move() {
      if (!state) {
        const hit = inferPoint(ctx, null, null);
        if (!hit) return vp().hideMarker();
        vp().showMarker(hit.point, hit.kind);
        vp().showGuides([protractorRing(ctx, hit.point, protractorNormal(ctx, lock), lock)]);
        return;
      }
      const a = aim(ctx, state.center, state.normal);
      if (!a) return;
      if (state.base) state.angle = snappedAngle(state.base, a.dir, state.normal, a.inferred);
      show(state, a.dir);
    },

    dragEnd() {
      if (state?.base) commit();
    },

    submit(text) {
      if (!state?.base) return ctx.flash(t('error.nothingToSize'), true);
      const a = parseAngle(text);
      if (a === null || a === 0) return ctx.flash(t('error.typeAngle'), true);
      // A typed angle turns the way the pointer does.
      commit((Math.sign(state.angle) || 1) * a);
    },

    key(e) {
      const axis = AXIS_KEYS[e.key];
      // The axis locks the protractor before the center is placed, as in Rotate.
      if (!axis || state) return false;
      lock = lock === axis ? null : axis;
      return true;
    },

    reset() {
      const had = state !== null;
      state = null;
      lock = null;
      vp().clearPreview();
      return had;
    },
  };
}
