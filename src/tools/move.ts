import type { Vector3 } from 'three';
import { definitionModel } from '../commands';
import { t } from '../i18n';
import { edgeGroup, faceEdges } from '../kernel';
import { formatLength, parseLengthList } from '../units';
import type { Axis } from '../viewport';
import { AXIS_KEYS, inferPoint } from './inference';
import { isMac } from './shortcuts';
import { entityOf, sameEntity, type Tool, type ToolContext } from './tool';

/** Moves shorter than this (mm) are no move at all. */
const MIN_DISTANCE = 0.01;

interface MoveState {
  faceIds: string[];
  edgeIds: string[];
  instanceIds: string[];
  /** Start point and current destination, in world coordinates. */
  start: Vector3;
  end: Vector3 | null;
  axis: Axis | null;
}

/**
 * Move (M): click a start point, then the destination, or type a distance.
 * It moves the selection; with nothing selected, the face, edge, group or
 * component under the pointer. Groups and components move whole; loose
 * geometry stretches what it is connected to. Ctrl (Option on a Mac) toggles
 * copying; after a copy, typing x5 or /4 makes an array. Arrow keys lock an
 * axis, as in the Line tool.
 */
export function createMoveTool(ctx: ToolContext): Tool {
  const { selection } = ctx;
  let state: MoveState | null = null;
  let lock: Axis | null = null;
  let copy = false;

  const fmt = (mm: number) => formatLength(Math.abs(mm), ctx.units());
  const hasSelection = () => selection.faces.size + selection.edges.size + selection.instances.size > 0;
  const copyKey = () => t(isMac() ? 'key.option' : 'key.ctrl');

  /** The move in the editing context's coordinates: a unit direction and a distance. */
  const local = (s: MoveState): { direction: [number, number, number]; distance: number } | null => {
    if (!s.end) return null;
    const v = ctx.viewport.frame.dirToLocal(s.end.clone().sub(s.start));
    const distance = Math.hypot(...v);
    if (distance < MIN_DISTANCE) return null;
    return { direction: [v[0] / distance, v[1] / distance, v[2] / distance], distance };
  };

  const input = (s: MoveState, m: { direction: [number, number, number]; distance: number }) => ({
    definitionId: ctx.viewport.frame.definitionId,
    faceIds: s.faceIds,
    edgeIds: s.edgeIds,
    instanceIds: s.instanceIds,
    ...m,
  });

  const preview = (s: MoveState) => {
    const m = local(s);
    if (s.end) ctx.viewport.showLinePreview(s.start, s.end, s.axis);
    ctx.setMeasurement(t('measure.distance'), fmt(m?.distance ?? 0));
    if (!m) return ctx.viewport.hidePreview();
    const r = copy
      ? ctx.session.preview('core.moveCopies', { ...input(s, m), copies: 1, divide: false })
      : ctx.session.preview('core.move', input(s, m));
    // A refused move (one that would bend or cross a face) shows the original instead.
    if (r.ok) ctx.showPreview(r.doc);
    else ctx.viewport.hidePreview();
  };

  const commit = (distance?: number) => {
    if (!state) return;
    const s = state;
    const m = local(s);
    if (!m) return ctx.cancel();
    if (distance !== undefined) m.distance = distance;
    const wasCopy = copy;
    ctx.cancel(true);
    const r = wasCopy
      ? ctx.session.execute('core.moveCopies', { ...input(s, m), copies: 1, divide: false })
      : ctx.session.execute('core.move', input(s, m));
    if (!r.ok) return ctx.flashError(r.error);
    // What moved (or the copy) stays selected, as in SketchUp.
    selection.faces.clear();
    selection.edges.clear();
    selection.instances.clear();
    for (const f of r.output.faceIds) selection.faces.add(f);
    for (const e of r.output.edgeIds) selection.edges.add(e);
    for (const i of r.output.instanceIds) selection.instances.add(i);
    ctx.applyHighlights();
    ctx.flash(t(wasCopy ? 'message.copied' : 'message.moved', { distance: fmt(m.distance) }));
    ctx.hint();
  };

  /** With nothing selected, the entity under the pointer becomes the selection. */
  const pickUnderPointer = (): boolean => {
    const hit = entityOf(ctx.viewport.pick());
    if (!hit) return false;
    const m = definitionModel(ctx.session.doc, ctx.viewport.frame.definitionId)!;
    if (hit.kind === 'face') selection.faces.add(hit.id);
    else if (hit.kind === 'edge') for (const e of edgeGroup(m, hit.id)) selection.edges.add(e);
    else selection.instances.add(hit.id);
    selection.hovered = null;
    ctx.applyHighlights();
    return true;
  };

  return {
    id: 'move',
    cursor: 'move',
    keepsSelection: true,
    hint: () => {
      const key = copyKey();
      if (state) return t(copy ? 'status.move.copy' : 'status.move.target', { key });
      return t(hasSelection() ? 'status.move.start' : 'status.move.pick', { key });
    },
    measurementLabel: () => t('measure.distance'),
    busy: () => state !== null,

    down(e) {
      if (state) return commit();
      if (!hasSelection() && !pickUnderPointer()) return;
      const first = inferPoint(ctx, null, null);
      if (!first) return;
      if (isMac() ? e.altKey : e.ctrlKey) copy = true;
      const m = definitionModel(ctx.session.doc, ctx.viewport.frame.definitionId)!;
      state = {
        faceIds: [...selection.faces],
        edgeIds: [...selection.edges],
        instanceIds: [...selection.instances],
        start: first.point,
        end: null,
        axis: null,
      };
      // Inference ignores what is being moved, so it cannot snap to itself.
      const edges = new Set([...selection.edges, ...[...selection.faces].flatMap((f) => faceEdges(m, f))]);
      ctx.viewport.setExcluded({ faces: new Set(selection.faces), edges, instances: new Set(selection.instances) });
      ctx.setMeasurement(t('measure.distance'), fmt(0));
      ctx.hint();
    },

    move() {
      if (!state) {
        if (!hasSelection()) {
          const hovered = entityOf(ctx.viewport.pick());
          if (!sameEntity(hovered, selection.hovered)) {
            selection.hovered = hovered;
            ctx.applyHighlights();
          }
        }
        const hit = inferPoint(ctx, null, null);
        if (hit) ctx.viewport.showMarker(hit.point, hit.kind);
        else ctx.viewport.hideMarker();
        return;
      }
      const hit = inferPoint(ctx, state.start, lock);
      if (!hit) return;
      state.end = hit.point;
      state.axis = hit.axis;
      ctx.viewport.showMarker(hit.point, hit.kind);
      preview(state);
    },

    dragEnd() {
      if (state?.end) commit();
    },

    submit(text) {
      if (!state) return ctx.flash(t('error.nothingToSize'), true);
      const r = parseLengthList(text, ctx.units().unit);
      if (!r.ok || r.mm.length !== 1 || r.mm[0] === 0) return ctx.flash(t('error.typeOneDistance'), true);
      if (!local(state)) return ctx.flash(t('error.moveDirectionFirst'), true);
      commit(r.mm[0]);
    },

    key(e) {
      if (e.key === (isMac() ? 'Alt' : 'Control')) {
        copy = !copy;
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
      copy = false;
      ctx.viewport.setExcluded(null);
      ctx.viewport.hidePreview();
      return had;
    },
  };
}
