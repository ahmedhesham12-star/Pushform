import { Vector3 } from 'three';
import { definitionModel } from '../commands';
import { t } from '../i18n';
import {
  connectedGeometry,
  edgeFaces,
  edgeGroup,
  edgeLength,
  faceArea,
  faceEdges,
  listEdges,
  listFaces,
  type Model,
  type Point3,
} from '../kernel';
import { applyPoint, compose, definitionBounds, pathDefinition, transformAnnotation, worldEdges, type InstanceId } from '../scene';
import { formatArea, formatLength } from '../units';
import { dimensionLine, type Picked } from '../viewport';
import { isMac, selectionMode, type SelectionMode } from './shortcuts';
import { entityOf, sameEntity, type Selection, type Tool, type ToolContext } from './tool';
import { dragRect, windowHits, type ScreenPoint, type WindowItem } from './windowSelect';

/** Pointer travel (px) that turns a press into a selection window. */
const DRAG_PX = 6;

export interface SelectionItems {
  faces?: Iterable<string>;
  edges?: Iterable<string>;
  instances?: Iterable<InstanceId>;
  guides?: Iterable<string>;
  annotations?: Iterable<string>;
}

/**
 * Change the selection with SketchUp's modifiers: replace, add, remove, or
 * toggle. A toggle flips each item, unless `toggleTo` gives one state for all
 * (a click on one edge of a curve turns the whole curve on or off).
 */
export function applySelection(selection: Selection, mode: SelectionMode, items: SelectionItems, toggleTo?: boolean): void {
  if (mode === 'replace') {
    selection.faces.clear();
    selection.edges.clear();
    selection.instances.clear();
    selection.guides.clear();
    selection.annotations.clear();
  }
  const change = (set: Set<string>, ids: Iterable<string> | undefined) => {
    for (const id of ids ?? []) {
      const on = mode === 'remove' ? false : mode === 'toggle' ? (toggleTo ?? !set.has(id)) : true;
      if (on) set.add(id);
      else set.delete(id);
    }
  };
  change(selection.faces, items.faces);
  change(selection.edges, items.edges);
  change(selection.instances, items.instances);
  change(selection.guides, items.guides);
  change(selection.annotations, items.annotations);
}

/** Edges with the rest of their curves, so the selection always holds whole curves. */
const withCurves = (m: Model, edges: Iterable<string>) => new Set([...edges].flatMap((e) => edgeGroup(m, e)));

/**
 * The Select tool, with SketchUp's methods:
 * - click selects a face, an edge (a whole curve), a guide, a dimension, or
 *   a group or component;
 * - double-click a face for the face and its edges, an edge for the edge and
 *   its faces, a group or component to edit it;
 * - triple-click for everything connected to the face or edge;
 * - drag a window: left to right selects what is fully inside, right to left
 *   (crossing) also what it touches; hidden items are included.
 * Modifiers: Shift toggles, Ctrl adds, Ctrl+Shift removes (Option instead of
 * Ctrl on a Mac). Only the open editing context can be selected; a click
 * outside it closes it.
 */
export function createSelectTool(ctx: ToolContext): Tool {
  const { selection } = ctx;
  const model = () => definitionModel(ctx.session.doc, ctx.viewport.frame.definitionId)!;
  let press: { start: { x: number; y: number }; mode: SelectionMode; window: boolean } | null = null;

  /** Total area of the selected faces, or total length of the selected edges. */
  const showSize = () => {
    const m = model();
    const only = (n: number) =>
      n > 0 && n === selection.faces.size + selection.edges.size + selection.instances.size + selection.guides.size + selection.annotations.size;
    if (only(selection.faces.size)) {
      const area = [...selection.faces].reduce((s, f) => s + faceArea(m, f), 0);
      ctx.setMeasurement(t('measure.area'), formatArea(area, ctx.units()));
    } else if (only(selection.edges.size)) {
      const len = [...selection.edges].reduce((s, e) => s + edgeLength(m, e), 0);
      ctx.setMeasurement(t('measure.length'), formatLength(len, ctx.units()));
    } else {
      ctx.setMeasurement(t('measure.area'), '');
    }
  };

  const done = () => {
    ctx.applyHighlights();
    showSize();
    ctx.hint();
  };

  /** Single click: the entity under the pointer. A click outside the open context closes it first. */
  const click = (hit: Picked | null, mode: SelectionMode) => {
    const context = ctx.contextPath();
    if (context.length && (!hit || hit.kind === 'outside')) {
      const path = hit?.kind === 'outside' ? hit.path : [];
      let common = 0;
      while (common < context.length && path[common] === context[common]) common++;
      ctx.closeContext(context.slice(0, common));
      hit = ctx.viewport.pick();
    }
    if (!hit || hit.kind === 'outside') return applySelection(selection, mode, {});
    const m = model();
    if (hit.kind === 'instance') {
      applySelection(selection, mode, { instances: [hit.id] }, !selection.instances.has(hit.id));
    } else if (hit.kind === 'guide') {
      applySelection(selection, mode, { guides: [hit.id] }, !selection.guides.has(hit.id));
    } else if (hit.kind === 'annotation') {
      applySelection(selection, mode, { annotations: [hit.id] }, !selection.annotations.has(hit.id));
    } else if (hit.kind === 'face') {
      applySelection(selection, mode, { faces: [hit.id] }, !selection.faces.has(hit.id));
    } else {
      applySelection(selection, mode, { edges: edgeGroup(m, hit.id) }, !selection.edges.has(hit.id));
    }
  };

  /** Double click: a face with its edges, an edge with its faces; a group or component opens. */
  const doubleClick = (hit: Picked | null, mode: SelectionMode) => {
    if (!hit || hit.kind === 'outside' || hit.kind === 'guide' || hit.kind === 'annotation') return click(hit, mode);
    if (hit.kind === 'instance') return ctx.openContext(hit.id);
    const m = model();
    // The first click already toggled the entity, so a toggle adds here.
    const multi = mode === 'toggle' ? 'add' : mode;
    if (hit.kind === 'face') {
      applySelection(selection, multi, { faces: [hit.id], edges: withCurves(m, faceEdges(m, hit.id)) });
    } else {
      const edges = edgeGroup(m, hit.id);
      applySelection(selection, multi, { edges, faces: new Set(edges.flatMap((e) => edgeFaces(m, e))) });
    }
  };

  /** Triple click: everything connected to the face or edge. */
  const tripleClick = (hit: Picked | null, mode: SelectionMode) => {
    if (!hit || hit.kind === 'outside' || hit.kind === 'guide' || hit.kind === 'annotation') return click(hit, mode);
    if (hit.kind === 'instance') return click(hit, mode);
    const m = model();
    const all = connectedGeometry(m, hit.kind === 'face' ? [hit.id] : [], hit.kind === 'edge' ? [hit.id] : []);
    applySelection(selection, mode === 'toggle' ? 'add' : mode, { faces: all.faceIds, edges: withCurves(m, all.edgeIds) });
  };

  /** Faces, edges, instances, guides and dimensions of the open context, as seen on screen. */
  const windowItems = (): { faces: WindowItem[]; edges: WindowItem[]; instances: WindowItem[]; guides: WindowItem[]; annotations: WindowItem[] } => {
    const vp = ctx.viewport;
    const frame = vp.frame;
    const screen = (p: Vector3): ScreenPoint => {
      const s = vp.picker.toScreen(p);
      return { x: s.x, y: s.y, visible: s.z <= 1 };
    };
    const local = (p: Point3) => screen(frame.toWorld(p));
    const ring = (pts: ScreenPoint[]) => pts.map((p, i) => [p, pts[(i + 1) % pts.length]!] as const);
    const m = model();
    const faces = listFaces(m).map((f) => {
      const outer = f.outer.map(local);
      return { id: f.id, points: outer, segments: [outer, ...f.holes.map((h) => h.map(local))].flatMap(ring), areas: [outer] };
    });
    const edges = listEdges(m).map((e) => {
      const a = local(e.a);
      const b = local(e.b);
      return { id: e.id, points: [a, b], segments: [[a, b] as const] };
    });
    const scene = ctx.session.doc.scene;
    const context = ctx.contextPath();
    const all = worldEdges(scene);
    const instances: WindowItem[] = [];
    for (const i of pathDefinition(scene, context)?.instances.values() ?? []) {
      const b = definitionBounds(scene, i.definitionId);
      if (!b) continue;
      const world = compose(frame.world, i.transform);
      const points: ScreenPoint[] = [];
      for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) points.push(screen(new Vector3(...applyPoint(world, [x, y, z]))));
      const prefix = [...context, i.id];
      const segments = all
        .filter((e) => prefix.every((id, k) => e.path[k] === id))
        .map((e) => [screen(new Vector3(...e.a)), screen(new Vector3(...e.b))] as const);
      instances.push({ id: i.id, points, segments });
    }
    // Guide lines reach past any window, so only a crossing takes them; guide points are points.
    const guides: WindowItem[] = [];
    if (vp.guidesVisible) {
      for (const [id, g] of pathDefinition(scene, context)?.guides ?? []) {
        const p = frame.toWorld(g.point);
        if (g.kind === 'point') {
          guides.push({ id, points: [screen(p)], segments: [] });
          continue;
        }
        const seg = vp.guideSegment(p, frame.dirToWorld(g.direction));
        if (!seg) continue;
        const [a, b] = seg.map(screen) as [ScreenPoint, ScreenPoint];
        guides.push({ id, points: [a, b], segments: [[a, b] as const] });
      }
    }
    // A dimension is its dimension line.
    const annotations: WindowItem[] = [];
    for (const [id, a] of pathDefinition(scene, context)?.annotations ?? []) {
      const { from, to } = dimensionLine(transformAnnotation(frame.world, a));
      const [p, q] = [screen(from), screen(to)];
      annotations.push({ id, points: [p, q], segments: [[p, q] as const] });
    }
    return { faces, edges, instances, guides, annotations };
  };

  const windowSelect = (end: { x: number; y: number }) => {
    if (!press) return;
    const { rect, crossing } = dragRect(press.start, end);
    const items = windowItems();
    const m = model();
    const edgeHits = new Set(windowHits(items.edges, rect, crossing));
    // A window takes a curve only when all of it is inside; a crossing takes the whole curve it touches.
    const edges = crossing ? withCurves(m, edgeHits) : [...edgeHits].filter((e) => edgeGroup(m, e).every((x) => edgeHits.has(x)));
    applySelection(selection, press.mode, {
      faces: windowHits(items.faces, rect, crossing),
      edges,
      instances: windowHits(items.instances, rect, crossing),
      guides: windowHits(items.guides, rect, crossing),
      annotations: windowHits(items.annotations, rect, crossing),
    });
  };

  return {
    id: 'select',
    cursor: 'default',
    keepsSelection: true,
    hint: () => {
      const add = t(isMac() ? 'key.option' : 'key.ctrl');
      const any = selection.faces.size || selection.edges.size || selection.instances.size || selection.guides.size || selection.annotations.size;
      return t(any ? 'status.select.selected' : 'status.select.idle', { add });
    },
    measurementLabel: () => t('measure.area'),
    busy: () => press?.window === true,
    down(e) {
      press = { start: { ...ctx.viewport.picker.mouse }, mode: selectionMode(e, isMac()), window: false };
    },
    move() {
      const { x, y } = ctx.viewport.picker.mouse;
      if (press) {
        if (!press.window && Math.hypot(x - press.start.x, y - press.start.y) <= DRAG_PX) return;
        press.window = true;
        if (selection.hovered) {
          selection.hovered = null;
          ctx.applyHighlights();
        }
        ctx.viewport.showSelectionBox(press.start, { x, y }, dragRect(press.start, { x, y }).crossing);
        return;
      }
      const hovered = entityOf(ctx.viewport.pick());
      if (!sameEntity(hovered, selection.hovered)) {
        selection.hovered = hovered;
        ctx.applyHighlights();
      }
    },
    up(_e, dragged, clicks) {
      if (!press) return;
      ctx.viewport.hideSelectionBox();
      if (dragged || press.window) {
        if (press.window) windowSelect({ ...ctx.viewport.picker.mouse });
      } else {
        const hit = ctx.viewport.pick();
        if (clicks === 2) doubleClick(hit, press.mode);
        else if (clicks >= 3) tripleClick(hit, press.mode);
        else click(hit, press.mode);
      }
      press = null;
      done();
    },
    reset() {
      const had = press?.window === true;
      press = null;
      ctx.viewport.hideSelectionBox();
      return had;
    },
  };
}
