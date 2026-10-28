import { Vector3 } from 'three';
import { definitionModel } from '../commands';
import { t, type MessageKey } from '../i18n';
import { listEdges, MAX_SEGMENTS, previewArc, threePointArc, twoPointArc, type Vec3 } from '../kernel';
import { determinant } from '../scene';
import { formatAngle, formatLength, formatNumber, parseTypedValues } from '../units';
import { planeHolding, startsLoose } from './drawingPlane';
import { inferOnPlane, type Inferred } from './inference';
import { aim, snappedAngle } from './protractorGeometry';
import type { Tool, ToolContext, ToolId } from './tool';

/** Segments a new arc gets until a count like 24s is typed; remembered between arcs and arc tools. */
const DEFAULT_SEGMENTS = 12;
const counts = new WeakMap<ToolContext, { segments: number }>();
const shared = (ctx: ToolContext) => {
  let c = counts.get(ctx);
  if (!c) counts.set(ctx, (c = { segments: DEFAULT_SEGMENTS }));
  return c;
};

/** How close (pixels) the bulge must come to a tangent or a half circle to snap to it. */
const SNAP_PX = 12;
/** Tangents turning further than this from the chord give no useful arc. */
const MAX_TANGENT = (175 * Math.PI) / 180;

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a);
  return l ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** The drawing plane (world): fixed by the first click inside a face or on the ground, else found as the pointer moves. */
interface Plane {
  faceId: string | null;
  onFace: boolean;
  origin: Vector3;
  normal: Vector3;
  loose: boolean;
}

/** Shared by the arc tools: the plane, pointer inference on it, local conversion and the segment count. */
function arcBase(ctx: ToolContext) {
  const vp = () => ctx.viewport;
  const count = shared(ctx);
  return {
    count,
    countText: () => t('measure.count', { count: formatNumber(count.segments) }),
    /** The plane under the pointer, with the inferred point on it; null off the model and ground. */
    pick(): { plane: Plane; at: Inferred } | null {
      const pl = vp().planeUnderCursor();
      if (!pl) return null;
      const at = inferOnPlane(ctx, pl.point, pl.normal, pl.point, pl.onFace ? 'face' : 'ground');
      return { plane: { faceId: pl.faceId, onFace: pl.onFace, origin: at.point.clone(), normal: pl.normal.clone(), loose: startsLoose(at) }, at };
    },
    /** A plane still to find becomes the one under the pointer when that holds the points so far (local). */
    follow(p: Plane, points: readonly Vec3[]): Plane {
      if (!p.loose) return p;
      const pl = planeHolding(ctx, points.map((q) => vp().frame.toWorld(q)), { point: p.origin, normal: p.normal });
      return pl ? { faceId: pl.faceId, onFace: pl.onFace, origin: pl.point.clone(), normal: pl.normal.clone(), loose: true } : p;
    },
    /** The pointer on the plane, by inference. */
    on(p: Plane): Inferred | null {
      const raw = vp().picker.rayPlane(p.origin, p.normal);
      return raw && inferOnPlane(ctx, p.origin, p.normal, raw, p.onFace ? 'face' : 'ground');
    },
    local: (p: Vector3) => vp().frame.toLocal(p),
    world: (p: Vec3) => vp().frame.toWorld(p),
    /** Command fields for the plane: its face, or its normal in the context's coordinates. */
    planeInput(p: Plane) {
      const frame = vp().frame;
      return { definitionId: frame.definitionId, faceId: p.faceId, ...(p.faceId ? {} : { normal: frame.normalToLocal(p.normal) as [number, number, number] }) };
    },
    normalLocal: (p: Plane) => unit(vp().frame.normalToLocal(p.normal)),
    /** A count typed with s: set it, or flash why not. Returns false when it was refused. */
    setCount(c: number): boolean {
      if (c < 2 || c > MAX_SEGMENTS) {
        ctx.flash(t('error.badArcCount', { max: formatNumber(MAX_SEGMENTS) }), true);
        return false;
      }
      count.segments = c;
      return true;
    },
    /** Show an arc (local points) as a preview line, cyan when tangent, with optional straight lines. */
    show(points: readonly Vec3[], tangent: boolean, lines: readonly Vec3[][] = []) {
      const frame = vp().frame;
      vp().showGuides([
        { points: points.map((p) => frame.toWorld(p)), tone: tangent ? 'tangent' : null },
        ...lines.map((l) => ({ points: l.map((p) => frame.toWorld(p)) })),
      ]);
    },
  };
}

/** Unit directions along the context's edges through a point, in the plane: the ways an arc there can run tangent. */
function edgeDirections(ctx: ToolContext, at: Vec3, n: Vec3, continuing: boolean): Vec3[] {
  const m = definitionModel(ctx.session.doc, ctx.viewport.frame.definitionId);
  if (!m) return [];
  const same = (a: Vec3, b: Vec3) => len(sub(a, b)) < 1e-6;
  const out: Vec3[] = [];
  for (const e of listEdges(m)) {
    const d = sub(e.b, e.a);
    if (Math.abs(dot(unit(d), n)) > 1e-6) continue;
    // At an end, the arc continues the edge; inside it, either way along it.
    if (same(e.a, at)) out.push(unit(continuing ? sub(e.a, e.b) : d));
    else if (same(e.b, at)) out.push(unit(continuing ? d : sub(e.a, e.b)));
    else {
      const f = dot(sub(at, e.a), d) / dot(d, d);
      if (f > 0 && f < 1 && len(sub(add(e.a, d, f), at)) < 1e-6) out.push(unit(d), unit(sub([0, 0, 0], d)));
    }
  }
  return out;
}

interface TwoPointState {
  plane: Plane;
  start: Vec3;
  /** The end, once clicked (local); before that the pointer is the end. */
  end: Vec3 | null;
  pointer: Vec3 | null;
  bulge: number;
  snap: 'tangent' | 'half' | null;
}

/**
 * 2-Point Arc (A), as in SketchUp: click the start and the end, then the
 * bulge. Near a bulge that makes the arc tangent to an edge at either end it
 * snaps there and turns cyan; near a half circle it snaps too. Type the chord
 * length, then a bulge, a radius ending in r, or segments (12s).
 */
export function createTwoPointArcTool(ctx: ToolContext): Tool {
  const base = arcBase(ctx);
  let state: TwoPointState | null = null;
  const vp = () => ctx.viewport;

  const chord = (s: TwoPointState) => (s.end && len(sub(s.end, s.start))) || 0;

  /** The bulge the pointer gives, snapped to a tangent or a half circle nearby. */
  const bulgeAt = (s: TwoPointState, p: Vec3): { bulge: number; snap: TwoPointState['snap'] } => {
    const n = base.normalLocal(s.plane);
    const e = s.end!;
    const c = len(sub(e, s.start));
    const u = unit(sub(e, s.start));
    const w = cross(n, u);
    const mid = add(s.start, sub(e, s.start), 0.5);
    const raw = dot(sub(p, mid), w);
    const candidates: { bulge: number; snap: 'tangent' | 'half' }[] = [];
    const angleTo = (d: Vec3, sign: number) => Math.atan2(sign * dot(n, cross(u, d)), dot(u, d));
    for (const d of edgeDirections(ctx, s.start, n, true)) candidates.push({ bulge: (c / 2) * Math.tan(angleTo(d, 1) / 2), snap: 'tangent' });
    for (const d of edgeDirections(ctx, e, n, false)) candidates.push({ bulge: (c / 2) * Math.tan(angleTo(d, -1) / 2), snap: 'tangent' });
    candidates.splice(0, candidates.length, ...candidates.filter((x) => Math.abs(2 * Math.atan((2 * x.bulge) / c)) < MAX_TANGENT && Math.abs(x.bulge) > 1e-6));
    candidates.push({ bulge: c / 2, snap: 'half' }, { bulge: -c / 2, snap: 'half' });
    const screen = (b: number) => vp().picker.toScreen(base.world(add(mid, w, b)));
    const here = screen(raw);
    let best: { bulge: number; snap: TwoPointState['snap'] } = { bulge: raw, snap: null };
    let bestPx = SNAP_PX;
    for (const x of candidates) {
      const q = screen(x.bulge);
      const px = Math.hypot(q.x - here.x, q.y - here.y);
      // A tangent wins over a half circle at the same spot.
      if (px < bestPx || (px === bestPx && x.snap === 'tangent')) {
        best = x;
        bestPx = px;
      }
    }
    return best;
  };

  const preview = (s: TwoPointState) => {
    const n = base.normalLocal(s.plane);
    if (!s.end) {
      ctx.setMeasurement(t('measure.length'), s.pointer ? formatLength(len(sub(s.pointer, s.start)), ctx.units()) : '');
      if (s.pointer) base.show([s.start, s.pointer], false);
      return;
    }
    ctx.setMeasurement(t('measure.bulge'), `${formatLength(Math.abs(s.bulge), ctx.units())}${t('measure.listSeparator')}${base.countText()}`);
    const arc = twoPointArc(n, s.start, s.end, s.bulge);
    if (!arc) return base.show([s.start, s.end], false);
    base.show(previewArc(n, arc.center, s.start, arc.sweep, base.count.segments), s.snap === 'tangent');
  };

  const commit = (fields: { bulge: number; radius?: number }) => {
    if (!state?.end) return;
    const s = state;
    ctx.cancel(true);
    const r = ctx.session.execute('core.drawArc', { ...base.planeInput(s.plane), start: s.start as [number, number, number], end: s.end! as [number, number, number], ...fields, segments: base.count.segments });
    if (r.ok) ctx.flash(t('message.arcAdded', { count: formatNumber(base.count.segments) }));
    else ctx.flashError(r.error);
  };

  const setEnd = (s: TwoPointState, end: Vec3) => {
    if (len(sub(end, s.start)) < 1e-3) return;
    s.end = end;
    s.bulge = 0;
    ctx.hint();
  };

  return {
    id: 'arc',
    cursor: 'crosshair',
    hint: () => {
      if (!state) return t('status.arc.start');
      if (!state.end) return t('status.arc.end');
      if (state.snap === 'tangent') return t('status.arc.tangent');
      if (state.snap === 'half') return t('status.arc.half');
      return t('status.arc.bulge');
    },
    measurementLabel: () => t(state?.end ? 'measure.bulge' : 'measure.length'),
    busy: () => state !== null,
    acceptsInput: () => true,
    idleMeasurement: base.countText,

    down() {
      if (state?.end) return Math.abs(state.bulge) > 1e-6 ? commit({ bulge: state.bulge }) : undefined;
      if (state) return state.pointer ? setEnd(state, state.pointer) : undefined;
      const picked = base.pick();
      if (!picked) return;
      state = { plane: picked.plane, start: base.local(picked.at.point), end: null, pointer: null, bulge: 0, snap: null };
      ctx.setMeasurement(t('measure.length'), '');
      ctx.hint();
    },

    move() {
      if (!state) {
        if (!base.pick()) vp().hideMarker();
        return;
      }
      state.plane = base.follow(state.plane, state.end ? [state.start, state.end] : [state.start]);
      const at = base.on(state.plane);
      if (!at) return;
      const p = base.local(at.point);
      if (!state.end) state.pointer = p;
      else {
        const before = state.snap;
        Object.assign(state, bulgeAt(state, p));
        if (state.snap !== before) ctx.hint();
      }
      preview(state);
    },

    dragEnd() {
      if (state && !state.end && state.pointer) setEnd(state, state.pointer);
    },

    submit(text) {
      const typed = parseTypedValues(text, ctx.units().unit);
      if (!typed.ok || typed.lengths.length + typed.radii.length > 1 || typed.counts.length > 1) return ctx.flash(t('error.typeArc'), true);
      const c = typed.counts[0];
      if (c !== undefined && !base.setCount(c)) return;
      const length = typed.lengths[0];
      const radius = typed.radii[0];
      if (length === undefined && radius === undefined) return state ? preview(state) : ctx.setMeasurement(t('measure.length'), base.countText());
      if (!state) return ctx.flash(t('error.nothingToSize'), true);
      if (!state.end) {
        // The chord's length, along the pointer.
        if (length === undefined || length <= 0 || !state.pointer) return ctx.flash(t('error.typeArc'), true);
        setEnd(state, add(state.start, unit(sub(state.pointer, state.start)), length));
        return preview(state);
      }
      const side = Math.sign(state.bulge) || 1;
      if (radius !== undefined) {
        if (radius < chord(state) / 2) return ctx.flash(t('error.arcRadiusTooSmall'), true);
        return commit({ bulge: state.bulge || side, radius });
      }
      if (!length) return ctx.flash(t('error.typeArc'), true);
      commit({ bulge: side * Math.abs(length) });
    },

    reset() {
      const had = state !== null;
      state = null;
      vp().clearPreview();
      return had;
    },
  };
}

interface CenterState {
  plane: Plane;
  center: Vec3;
  /** The start, once clicked (local); before that the pointer sets it. */
  start: Vec3 | null;
  pointer: Vec3 | null;
  /** Degrees counter-clockwise about the plane's normal (world), followed past half a turn. */
  angle: number;
  /** The last angle read from the pointer, to follow it round. */
  raw: number;
}

/**
 * Arc and Pie, as in SketchUp: click the center, the start (or type the
 * radius), then the end (or type the angle). The angle snaps to 15 degree
 * steps and follows the pointer round past half a turn. A pie adds its radii.
 */
export function createCenterArcTool(ctx: ToolContext, pie: boolean): Tool {
  const base = arcBase(ctx);
  let state: CenterState | null = null;
  const vp = () => ctx.viewport;
  const keys: Record<'center' | 'start' | 'angle', MessageKey> = { center: 'status.centerArc.center', start: 'status.centerArc.start', angle: 'status.centerArc.angle' };

  /** The angle about the local normal: a mirrored context turns the other way. */
  const localAngle = (angle: number) => (determinant(vp().frame.world) < 0 ? -angle : angle);

  const preview = (s: CenterState) => {
    if (!s.start) {
      ctx.setMeasurement(t('measure.radius'), s.pointer ? formatLength(len(sub(s.pointer, s.center)), ctx.units()) : '');
      if (s.pointer) base.show([s.center, s.pointer], false);
      return;
    }
    ctx.setMeasurement(t('measure.angle'), `${formatAngle(s.angle)}${t('measure.listSeparator')}${base.countText()}`);
    if (Math.abs(s.angle) < 1e-9) return base.show([s.center, s.start], false);
    const pts = previewArc(base.normalLocal(s.plane), s.center, s.start, (localAngle(s.angle) * Math.PI) / 180, base.count.segments);
    base.show(pts, false, pie ? [[pts.at(-1)!, s.center, pts[0]!]] : [[s.center, s.start]]);
  };

  const commit = (angle: number) => {
    if (!state?.start) return;
    const s = state;
    ctx.cancel(true);
    const input = { ...base.planeInput(s.plane), center: s.center as [number, number, number], start: s.start! as [number, number, number], angle: localAngle(angle), segments: base.count.segments };
    const r = ctx.session.execute(pie ? 'core.drawPie' : 'core.drawArcCenter', input);
    if (r.ok) ctx.flash(t(pie ? 'message.pieAdded' : 'message.centerArcAdded', { count: formatNumber(base.count.segments) }));
    else ctx.flashError(r.error);
  };

  return {
    id: pie ? 'pie' : 'centerArc',
    cursor: 'crosshair',
    hint: () => t(keys[!state ? 'center' : !state.start ? 'start' : 'angle']),
    measurementLabel: () => t(state?.start ? 'measure.angle' : 'measure.radius'),
    busy: () => state !== null,
    acceptsInput: () => true,
    idleMeasurement: base.countText,

    down() {
      if (state?.start) return Math.abs(state.angle) > 1e-9 ? commit(state.angle) : undefined;
      if (state) {
        if (state.pointer && len(sub(state.pointer, state.center)) > 1e-3) state.start = state.pointer;
        ctx.hint();
        return;
      }
      const picked = base.pick();
      if (!picked) return;
      state = { plane: picked.plane, center: base.local(picked.at.point), start: null, pointer: null, angle: 0, raw: 0 };
      ctx.hint();
    },

    move() {
      if (!state) {
        if (!base.pick()) vp().hideMarker();
        return;
      }
      state.plane = base.follow(state.plane, state.start ? [state.center, state.start] : [state.center]);
      if (!state.start) {
        const at = base.on(state.plane);
        if (at) state.pointer = base.local(at.point);
        return preview(state);
      }
      const center = base.world(state.center);
      const a = aim(ctx, center, state.plane.normal);
      if (!a) return;
      const raw = snappedAngle(base.world(state.start).sub(center).normalize(), a.dir, state.plane.normal, a.inferred);
      // Follow the pointer round: the change since the last reading, taken the short way.
      const step = ((((raw - state.raw) % 360) + 540) % 360) - 180;
      state.raw = raw;
      state.angle = Math.max(-359.999, Math.min(359.999, state.angle + step));
      preview(state);
    },

    submit(text) {
      const typed = parseTypedValues(text, ctx.units().unit);
      if (!typed.ok || typed.counts.length > 1) return ctx.flash(t('error.typeArcAngle'), true);
      const c = typed.counts[0];
      if (c !== undefined && !base.setCount(c)) return;
      const value = state?.start ? typed.angles[0] : typed.lengths[0];
      if (value === undefined) return state ? preview(state) : ctx.setMeasurement(t('measure.radius'), base.countText());
      if (!state) return ctx.flash(t('error.nothingToSize'), true);
      if (!state.start) {
        // The radius, toward the pointer.
        if (value <= 0 || !state.pointer) return ctx.flash(t('error.typeArcAngle'), true);
        state.start = add(state.center, unit(sub(state.pointer, state.center)), value);
        ctx.hint();
        return preview(state);
      }
      if (!value || Math.abs(value) >= 360) return ctx.flash(t('error.typeArcAngle'), true);
      // A typed angle turns the way the pointer does.
      commit((Math.sign(state.angle) || 1) * Math.abs(value));
    },

    reset() {
      const had = state !== null;
      state = null;
      vp().clearPreview();
      return had;
    },
  };
}

interface ThreePointState {
  plane: Plane;
  points: Vec3[];
  pointer: Vec3 | null;
}

/** 3-Point Arc, as in SketchUp: click the start, a point the arc passes through, and the end. */
export function createThreePointArcTool(ctx: ToolContext): Tool {
  const base = arcBase(ctx);
  let state: ThreePointState | null = null;
  const vp = () => ctx.viewport;
  const keys: MessageKey[] = ['status.arc3.start', 'status.arc3.through', 'status.arc3.end'];

  /** The arc through the clicked points and the pointer, turning about the plane's normal. */
  const arcOf = (s: ThreePointState) => {
    const [a, b] = s.points;
    if (!a || !b || !s.pointer) return null;
    const arc = threePointArc(a, b, s.pointer);
    if (!arc) return null;
    const n = base.normalLocal(s.plane);
    return { ...arc, sweep: dot(arc.normal, n) < 0 ? -arc.sweep : arc.sweep, n };
  };

  const preview = (s: ThreePointState) => {
    const arc = arcOf(s);
    ctx.setMeasurement(t('measure.angle'), arc ? `${formatAngle((Math.abs(arc.sweep) * 180) / Math.PI)}${t('measure.listSeparator')}${base.countText()}` : base.countText());
    if (arc) return base.show(previewArc(arc.n, arc.center, s.points[0]!, arc.sweep, base.count.segments), false);
    if (s.pointer && s.points.length) base.show([...s.points, s.pointer], false);
  };

  const commit = () => {
    const s = state;
    const arc = s && arcOf(s);
    if (!s || !arc) return;
    ctx.cancel(true);
    const input = { ...base.planeInput(s.plane), center: arc.center as [number, number, number], start: s.points[0]! as [number, number, number], angle: (arc.sweep * 180) / Math.PI, segments: base.count.segments };
    const r = ctx.session.execute('core.drawArcCenter', input);
    if (r.ok) ctx.flash(t('message.centerArcAdded', { count: formatNumber(base.count.segments) }));
    else ctx.flashError(r.error);
  };

  return {
    id: 'threePointArc',
    cursor: 'crosshair',
    hint: () => t(keys[state?.points.length ?? 0]!),
    measurementLabel: () => t('measure.angle'),
    busy: () => state !== null,
    acceptsInput: () => true,
    idleMeasurement: base.countText,

    down() {
      if (state?.points.length === 2) return commit();
      if (state) {
        const p = state.pointer;
        if (p && state.points.every((q) => len(sub(p, q)) > 1e-3)) state.points.push(p);
        ctx.hint();
        return;
      }
      const picked = base.pick();
      if (!picked) return;
      state = { plane: picked.plane, points: [base.local(picked.at.point)], pointer: null };
      ctx.hint();
    },

    move() {
      if (!state) {
        if (!base.pick()) vp().hideMarker();
        return;
      }
      state.plane = base.follow(state.plane, state.points);
      const at = base.on(state.plane);
      if (!at) return;
      state.pointer = base.local(at.point);
      preview(state);
    },

    submit(text) {
      const typed = parseTypedValues(text, ctx.units().unit);
      const c = typed.ok ? typed.counts[0] : undefined;
      if (!typed.ok || c === undefined || typed.lengths.length) return ctx.flash(t('error.typeArcCount'), true);
      if (!base.setCount(c)) return;
      if (state) preview(state);
      else ctx.setMeasurement(t('measure.angle'), base.countText());
    },

    reset() {
      const had = state !== null;
      state = null;
      vp().clearPreview();
      return had;
    },
  };
}

export const ARC_TOOLS: readonly ToolId[] = ['arc', 'centerArc', 'threePointArc', 'pie'];
