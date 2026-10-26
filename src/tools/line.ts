import { Vector3 } from 'three';
import { t } from '../i18n';
import { formatLength, parseLengthList } from '../units';
import { toPoint, toVector, type Axis } from '../viewport';
import { AXIS_KEYS, inferPoint } from './inference';
import type { Tool, ToolContext } from './tool';

/** Pointer travel (px) after a click that starts the next segment's rubber band. */
const MOVE_PX = 3;

interface Chain {
  /** First point of the chain. */
  first: Vector3;
  /** Start of the segment being drawn. */
  start: Vector3;
  /** Current end under the pointer, with how it was inferred. */
  end: Vector3 | null;
  axis: Axis | null;
  /** Pointer position at the last click, and whether it has moved since. */
  clickX: number;
  clickY: number;
  moved: boolean;
  /** Segments this chain has drawn; amends only ever apply to the chain's own last segment. */
  drawn: number;
}

/**
 * Click-to-click connected segments. Each segment is one core.drawLine
 * command. Typing while the rubber band is out sets the next segment's length;
 * typing right after a click (before moving) amends the segment just drawn.
 * Arrow keys lock an axis: right is red, left is green, up or down is blue.
 */
export function createLineTool(ctx: ToolContext): Tool {
  let chain: Chain | null = null;
  let lock: Axis | null = null;

  const infer = (start: Vector3 | null) => inferPoint(ctx, start, start ? lock : null);

  const fmt = (mm: number) => formatLength(mm, ctx.units());

  /** After an amend, the chain continues from the amended segment's end. */
  const followAmend = (c: Chain) => {
    const last = ctx.session.history().at(-1);
    if (!c.drawn || c.moved || last?.commandId !== 'core.drawLine') return;
    const input = last.input as { start: [number, number, number]; direction: [number, number, number]; length: number };
    const frame = ctx.viewport.frame;
    const dir = frame.dirToWorld(input.direction).normalize();
    c.start = frame.toWorld(input.start).addScaledVector(dir, input.length);
  };

  const preview = (c: Chain) => {
    if (!c.end) return;
    ctx.viewport.showLinePreview(c.start, c.end, c.axis);
    ctx.setMeasurement(t('measure.length'), fmt(c.end.distanceTo(c.start)));
  };

  /** Draw the segment from the chain start to `end`. */
  const commit = (c: Chain, end: Vector3) => {
    const frame = ctx.viewport.frame;
    const start = frame.toLocal(c.start);
    const dir = toVector(frame.toLocal(end)).sub(toVector(start));
    const len = dir.length();
    if (len < 0.01) return;
    const r = ctx.session.execute('core.drawLine', { definitionId: frame.definitionId, start, direction: toPoint(dir), length: len });
    if (!r.ok) return ctx.flashError(r.error);
    ctx.viewport.clearPreview();
    // Closing a loop (or returning to the first point) ends the chain, as in SketchUp.
    // The measurements box keeps the segment's length, so it can still be amended.
    if (r.output.faceIds.length || end.distanceTo(c.first) < 1e-3) {
      chain = null;
      lock = null;
      ctx.viewport.hideMarker();
      ctx.flash(t('message.lineClosed'));
      ctx.hint();
      return;
    }
    c.start = end.clone();
    c.end = null;
    c.moved = false;
    c.drawn++;
    ctx.hint();
  };

  return {
    id: 'line',
    cursor: 'crosshair',
    hint: () => (chain ? t('status.line.next') : t('status.line.first')),
    measurementLabel: () => t('measure.length'),
    busy: () => chain !== null && chain.moved,
    active: () => chain !== null,

    down(e) {
      if (chain) {
        followAmend(chain);
        const target = chain.moved && chain.end ? chain.end : infer(chain.start)?.point;
        if (target) commit(chain, target);
        if (chain) {
          chain.clickX = e.clientX;
          chain.clickY = e.clientY;
        }
        return;
      }
      const first = infer(null);
      if (!first) return;
      chain = {
        first: first.point,
        start: first.point.clone(),
        end: null,
        axis: null,
        clickX: e.clientX,
        clickY: e.clientY,
        moved: false,
        drawn: 0,
      };
      ctx.setMeasurement(t('measure.length'), fmt(0));
      ctx.hint();
    },

    move(e) {
      if (!chain) {
        const hit = infer(null);
        if (hit) ctx.viewport.showMarker(hit.point, hit.kind);
        else ctx.viewport.hideMarker();
        return;
      }
      if (!chain.moved) {
        if (Math.hypot(e.clientX - chain.clickX, e.clientY - chain.clickY) < MOVE_PX) return;
        followAmend(chain);
        chain.moved = true;
        ctx.hint();
      }
      const hit = infer(chain.start);
      if (!hit) return;
      chain.end = hit.point;
      chain.axis = hit.axis;
      ctx.viewport.showMarker(hit.point, hit.kind);
      preview(chain);
    },

    dragEnd() {
      if (chain?.moved && chain.end) commit(chain, chain.end);
    },

    submit(text) {
      if (!chain?.moved || !chain.end) return ctx.flash(t('error.nothingToSize'), true);
      const r = parseLengthList(text, ctx.units().unit);
      if (!r.ok || r.mm.length !== 1 || r.mm[0]! <= 0) return ctx.flash(t('error.typeOneLength'), true);
      const dir = chain.end.clone().sub(chain.start);
      if (dir.lengthSq() === 0) return ctx.flash(t('error.typeOneLength'), true);
      commit(chain, chain.start.clone().addScaledVector(dir.normalize(), r.mm[0]!));
    },

    key(e) {
      const axis = AXIS_KEYS[e.key];
      if (!axis || !chain) return false;
      lock = lock === axis ? null : axis;
      return true;
    },

    reset() {
      const had = chain !== null;
      chain = null;
      lock = null;
      return had;
    },
  };
}
