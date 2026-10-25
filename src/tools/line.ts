import { Vector3 } from 'three';
import { t } from '../i18n';
import { dragStep, formatLength, parseLengthList } from '../units';
import { AXIS_DIRECTION, toPoint, toVector, type Axis, type MarkerKind } from '../viewport';
import type { Tool, ToolContext } from './tool';

/** Pointer travel (px) after a click that starts the next segment's rubber band. */
const MOVE_PX = 3;
const AXIS_KEYS: Record<string, Axis> = { ArrowRight: 'x', ArrowLeft: 'z', ArrowUp: 'y', ArrowDown: 'y' };
const AXIS_MARKER: Record<Axis, MarkerKind> = { x: 'axisX', y: 'axisY', z: 'axisZ' };

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

  /** Where the next point goes, by inference: snap points, edges, axes, then the face or ground. */
  const infer = (start: Vector3 | null): { point: Vector3; kind: MarkerKind; axis: Axis | null } | null => {
    const vp = ctx.viewport;
    /** A point along an axis from start, at a distance rounded to the drag step. */
    const onAxis = (s: Vector3, axis: Axis, p: Vector3) => {
      const step = dragStep(ctx.units());
      const dist = Math.round(p.clone().sub(s).dot(AXIS_DIRECTION[axis]) / step) * step;
      return { point: s.clone().addScaledVector(AXIS_DIRECTION[axis], dist), kind: AXIS_MARKER[axis], axis };
    };
    if (start && lock) {
      const p = vp.closestOnLine(start, AXIS_DIRECTION[lock]);
      return p ? onAxis(start, lock, p) : null;
    }
    const snap = vp.nearestSnap(() => true);
    if (snap) return { point: snap.point.clone(), kind: snap.kind, axis: null };
    const edge = vp.pickEdge();
    if (edge) return { point: edge.point.clone(), kind: 'edge', axis: null };
    if (start) {
      const a = vp.axisInference(start);
      if (a) return onAxis(start, a.axis, a.point);
    }
    const pl = vp.planeUnderCursor();
    if (!pl) return null;
    const p = vp.snapOnPlane(pl.point, pl.normal, pl.point, pl.faceId ? 'face' : 'ground');
    return { point: p, kind: pl.faceId ? 'face' : 'ground', axis: null };
  };

  const fmt = (mm: number) => formatLength(mm, ctx.units());

  /** After an amend, the chain continues from the amended segment's end. */
  const followAmend = (c: Chain) => {
    const last = ctx.session.history().at(-1);
    if (!c.drawn || c.moved || last?.commandId !== 'core.drawLine') return;
    const input = last.input as { start: [number, number, number]; direction: [number, number, number]; length: number };
    const dir = toVector(input.direction).normalize();
    c.start = toVector(input.start).addScaledVector(dir, input.length);
  };

  const preview = (c: Chain) => {
    if (!c.end) return;
    ctx.viewport.showLinePreview(c.start, c.end, c.axis);
    ctx.setMeasurement(t('measure.length'), fmt(c.end.distanceTo(c.start)));
  };

  /** Draw the segment from the chain start to `end`. */
  const commit = (c: Chain, end: Vector3) => {
    const dir = end.clone().sub(c.start);
    const len = dir.length();
    if (len < 0.01) return;
    const r = ctx.session.execute('core.drawLine', { start: toPoint(c.start), direction: toPoint(dir), length: len });
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
