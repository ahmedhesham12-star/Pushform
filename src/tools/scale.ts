import { Vector3 } from 'three';
import { selectionBox, type ScaleBox } from '../commands';
import { t } from '../i18n';
import type { Vec3 } from '../kernel';
import { applyPoint, scaling } from '../scene';
import { formatNumber, parseTypedValues } from '../units';
import { inferPoint } from './inference';
import { isMac } from './shortcuts';
import type { Tool, ToolContext } from './tool';
import { hasSelection, hoverTakeable, selectResult, takeSelection, type Taken } from './transformSelection';

/** A grip on the box: -1, 0 or 1 along each axis (not all 0). */
export interface Grip {
  signs: [number, number, number];
  /** Where it is, and the grip across the box from it. */
  at: Vec3;
  opposite: Vec3;
  /** The axes it scales along. */
  along: number[];
  /** A corner grip scales the same in every direction unless Shift is held; the others the other way round. */
  corner: boolean;
}

/** Sizes below this (mm) are flat: no grips along them. */
const FLAT = 1e-3;
/** How close (pixels) the pointer must be to a grip. */
const GRIP_PX = 10;
const POINTS: ReadonlySet<string> = new Set(['end', 'mid', 'guidePoint', 'intersection']);

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** The point of the box at -1, 0 or 1 along each axis. */
const boxPoint = (b: ScaleBox, s: readonly number[]): Vec3 => b.axes.reduce((p, u, k) => add(p, u, s[k]! * b.half[k]!), b.center);

/** The grips of a box: corners, edge middles and side middles, none along a flat direction. */
export function boxGrips(b: ScaleBox): Grip[] {
  const out: Grip[] = [];
  const full = b.half.filter((h) => h > FLAT).length;
  for (const x of [-1, 0, 1]) {
    for (const y of [-1, 0, 1]) {
      for (const z of [-1, 0, 1]) {
        const signs: [number, number, number] = [x, y, z];
        if (signs.every((s) => s === 0) || signs.some((s, k) => s !== 0 && b.half[k]! <= FLAT)) continue;
        const along = [0, 1, 2].filter((k) => signs[k] !== 0);
        out.push({ signs, at: boxPoint(b, signs), opposite: boxPoint(b, signs.map((s) => -s)), along, corner: along.length === full });
      }
    }
  }
  return out;
}

/** The twelve edges of a box, as point pairs. */
function boxEdges(b: ScaleBox): [Vec3, Vec3][] {
  const out: [Vec3, Vec3][] = [];
  for (const k of [0, 1, 2]) {
    const [i, j] = [0, 1, 2].filter((x) => x !== k) as [number, number];
    for (const si of [-1, 1]) {
      for (const sj of [-1, 1]) {
        const s = [0, 0, 0];
        s[i] = si;
        s[j] = sj;
        s[k] = -1;
        const a = boxPoint(b, s);
        s[k] = 1;
        out.push([a, boxPoint(b, s)]);
      }
    }
  }
  return out;
}

/**
 * The factors a pointer at `p` (context coordinates) gives a grip: one when it
 * scales the same in every direction, else one per axis it scales along.
 */
export function gripFactors(b: ScaleBox, g: Grip, p: Vec3, uniform: boolean, centered: boolean): number[] {
  const fixed = centered ? b.center : g.opposite;
  const d = sub(g.at, fixed);
  const v = sub(p, fixed);
  if (uniform) return [dot(v, d) / dot(d, d)];
  return g.along.map((k) => dot(v, b.axes[k]!) / dot(d, b.axes[k]!));
}

interface Drag extends Taken {
  box: ScaleBox;
  grip: Grip;
  uniform: boolean;
  centered: boolean;
  factors: number[];
}

/**
 * Scale (S), as in SketchUp: grips on the selection's bounding box (a lone
 * group's or component's own box). Drag a corner to scale the same in every
 * direction, an edge middle along two directions, a side middle along one;
 * Shift switches between the two, and Ctrl (Option on a Mac) scales about the
 * center instead of the opposite grip. Type a factor (2, 0.5, -1 mirrors) or
 * a length with units; typing again afterwards amends the scale.
 */
export function createScaleTool(ctx: ToolContext): Tool {
  let drag: Drag | null = null;
  let hover: Grip | null = null;
  const vp = () => ctx.viewport;
  const centerKey = () => t(isMac() ? 'key.option' : 'key.ctrl');

  /** The box of the selection, in the context's coordinates; null with nothing to scale. */
  const box = (): ScaleBox | null => {
    const { faces, edges, instances, annotations } = ctx.selection;
    return selectionBox(ctx.session.doc, {
      definitionId: vp().frame.definitionId,
      faceIds: [...faces],
      edgeIds: [...edges],
      instanceIds: [...instances],
      annotationIds: [...annotations],
    });
  };

  const world = (p: Vec3) => vp().frame.toWorld(p);

  /** Draw a box with its grips; the active grip stands out. */
  const showBox = (b: ScaleBox, grips: readonly Grip[], active: Grip | null, shape: (p: Vec3) => Vec3 = (p) => p) => {
    const lines = boxEdges(b).map(([a, c]) => ({ points: [world(shape(a)), world(shape(c))] }));
    vp().showGrips(lines, grips.map((g) => world(shape(g.at))), active ? world(shape(active.at)) : null);
  };

  /** The grip under the pointer, if any. */
  const gripUnder = (grips: readonly Grip[]): Grip | null => {
    const { x, y } = vp().picker.mouse;
    let best: Grip | null = null;
    let bestPx = GRIP_PX;
    for (const g of grips) {
      const s = vp().picker.toScreen(world(g.at));
      const px = Math.hypot(s.x - x, s.y - y);
      if (s.z <= 1 && px < bestPx) {
        best = g;
        bestPx = px;
      }
    }
    return best;
  };

  const input = (d: Drag, factors: readonly number[]) => {
    const { box, grip } = d;
    const origin = d.centered ? box.center : grip.opposite;
    const axes = d.uniform ? [] : grip.along.map((k) => box.axes[k]!);
    const sizes = d.uniform ? [norm(sub(grip.at, grip.opposite))] : grip.along.map((k) => 2 * box.half[k]!);
    return {
      definitionId: vp().frame.definitionId,
      faceIds: d.faceIds,
      edgeIds: d.edgeIds,
      instanceIds: d.instanceIds,
      ...(d.annotationIds?.length ? { annotationIds: d.annotationIds } : {}),
      origin: [...origin] as [number, number, number],
      axes: axes.map((u) => [...u] as [number, number, number]),
      factor: factors[0]!,
      ...(factors.length > 1 ? { factor2: factors[1]! } : {}),
      ...(factors.length > 2 ? { factor3: factors[2]! } : {}),
      sizes,
    };
  };

  const shown = (factors: readonly number[]) => factors.map((f) => formatNumber(f, 2)).join(t('measure.listSeparator'));

  const preview = (d: Drag) => {
    ctx.setMeasurement(t('measure.scale'), shown(d.factors));
    const { box, grip } = d;
    const origin = d.centered ? box.center : grip.opposite;
    const map = scaling(origin, d.uniform ? [] : grip.along.map((k) => box.axes[k]!), d.factors);
    showBox(box, [grip], grip, (p) => applyPoint(map, p));
    if (d.factors.some((f) => Math.abs(f) < 1e-6)) return vp().hidePreview();
    const r = ctx.session.preview('core.scale', input(d, d.factors));
    if (r.ok) ctx.showPreview(r.doc);
    else vp().hidePreview();
  };

  /**
   * Where the pointer is, in the context's coordinates: a point it snaps to
   * (exact), or where it meets the line or plane the grip moves in.
   */
  const pointer = (d: Drag): { p: Vec3; exact: boolean } | null => {
    const hit = inferPoint(ctx, null, null);
    if (hit && POINTS.has(hit.kind)) return { p: vp().frame.toLocal(hit.point), exact: true };
    const { box, grip } = d;
    const fixed = d.centered ? box.center : grip.opposite;
    let p: Vector3 | null;
    if (d.uniform) p = vp().closestOnLine(world(fixed), world(grip.at).sub(world(fixed)));
    else if (grip.along.length === 1) p = vp().closestOnLine(world(grip.at), world(add(grip.at, box.axes[grip.along[0]!]!)).sub(world(grip.at)));
    else if (grip.along.length === 2) {
      const k = [0, 1, 2].find((x) => !grip.along.includes(x))!;
      p = vp().picker.rayPlane(world(grip.at), vp().frame.normalToWorld(box.axes[k]!));
    } else p = vp().picker.rayPlane(world(grip.at), vp().camera.target.clone().sub(vp().camera.camera.position).normalize());
    return p && { p: vp().frame.toLocal(p), exact: false };
  };

  const commit = (factors?: number[]) => {
    if (!drag) return;
    const d = drag;
    const f = factors ?? d.factors;
    if (f.every((x) => x === 1)) return ctx.cancel();
    ctx.cancel(true);
    const r = ctx.session.execute('core.scale', input(d, f));
    if (!r.ok) return ctx.flashError(r.error);
    selectResult(ctx, r.output);
    ctx.flash(t('message.scaled', { factors: shown(f) }));
    ctx.hint();
    idle();
  };

  /** With no drag: show the selection's box and grips, the one under the pointer highlighted. */
  const idle = () => {
    const b = hasSelection(ctx) ? box() : null;
    if (!b) {
      hover = null;
      return vp().clearPreview();
    }
    const grips = boxGrips(b);
    const under = gripUnder(grips);
    const changed = (under?.signs.join() ?? '') !== (hover?.signs.join() ?? '');
    hover = under;
    if (changed) ctx.hint();
    showBox(b, grips, hover);
  };

  return {
    id: 'scale',
    cursor: 'crosshair',
    keepsSelection: true,
    hint: () => {
      const key = centerKey();
      if (drag) return t('status.scale.drag', { key });
      if (!hasSelection(ctx)) return t('status.scale.pick');
      if (!hover) return t('status.scale.grip', { key });
      if (hover.corner) return t('status.scale.corner', { key });
      return t(hover.along.length === 1 ? 'status.scale.side' : 'status.scale.edge', { key });
    },
    measurementLabel: () => t('measure.scale'),
    busy: () => drag !== null,
    active: () => drag !== null,

    down(e) {
      if (drag) return commit();
      if (!hasSelection(ctx)) {
        takeSelection(ctx);
        vp().setExcluded(null);
        ctx.hint();
        return idle();
      }
      const b = box();
      const grip = b && gripUnder(boxGrips(b));
      if (!b || !grip) return;
      const taken = takeSelection(ctx);
      if (!taken) return;
      const uniform = grip.corner !== e.shiftKey;
      const centered = isMac() ? e.altKey : e.ctrlKey;
      drag = { ...taken, box: b, grip, uniform, centered, factors: uniform ? [1] : grip.along.map(() => 1) };
      vp().hideMarker();
      preview(drag);
      ctx.hint();
    },

    move(e) {
      if (!drag) {
        if (!hasSelection(ctx)) {
          hoverTakeable(ctx);
          vp().clearPreview();
        }
        return idle();
      }
      const uniform = drag.grip.corner !== e.shiftKey;
      const centered = isMac() ? e.altKey : e.ctrlKey;
      if (uniform !== drag.uniform || centered !== drag.centered) Object.assign(drag, { uniform, centered });
      const at = pointer(drag);
      if (!at) return;
      // Dragged freely, the factor is the one shown (two decimals); snapped to a point, it is exact.
      const factors = gripFactors(drag.box, drag.grip, at.p, drag.uniform, drag.centered).map((f) => (Number.isFinite(f) ? f : 1));
      drag.factors = at.exact ? factors : factors.map((f) => Math.round(f * 100) / 100 + 0);
      preview(drag);
    },

    dragEnd() {
      if (drag && drag.factors.some((f) => f !== 1)) commit();
    },

    submit(text) {
      if (!drag) return ctx.flash(t('error.nothingToSize'), true);
      const sizes = input(drag, drag.factors).sizes;
      const r = parseTypedValues(text, ctx.units().unit);
      if (!r.ok || r.lengths.length !== sizes.length) return ctx.flash(t('error.typeScale'), true);
      const factors = r.lengths.map((mm, i) => r.plain[i] ?? mm / sizes[i]!);
      if (factors.some((f) => f === 0 || !Number.isFinite(f))) return ctx.flash(t('error.typeScale'), true);
      commit(factors);
    },

    reset() {
      const had = drag !== null;
      drag = null;
      hover = null;
      vp().setExcluded(null);
      vp().hidePreview();
      vp().clearPreview();
      return had;
    },
  };
}
