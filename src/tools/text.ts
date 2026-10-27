import { Vector3 } from 'three';
import { definitionModel } from '../commands';
import { t } from '../i18n';
import { faceArea } from '../kernel';
import { pathDefinition } from '../scene';
import { formatArea, formatLength } from '../units';
import { inferPoint, type Inferred } from './inference';
import type { Tool, ToolContext } from './tool';

const POINTS: ReadonlySet<string> = new Set(['end', 'mid', 'guidePoint', 'intersection']);

interface Placing {
  /** The point the leader points at (world). */
  anchor: Vector3;
  /** What the text says unless the user writes something else. */
  text: string;
  /** Where the text goes (world), following the pointer. */
  at: Vector3;
}

/**
 * Text, as in SketchUp. Click a point, an edge, a face, or a group or
 * component, move the pointer to where the text goes and click: a leader
 * text, saying the point's coordinates, the edge's length, the face's area or
 * the group's name until you write over it. A first click on empty space
 * places screen text, which stays put in the view. Enter finishes the text,
 * Escape drops it.
 */
export function createTextTool(ctx: ToolContext): Tool {
  let state: Placing | null = null;
  let editing = false;
  const vp = () => ctx.viewport;
  const fmt = (mm: number) => formatLength(mm, ctx.units());

  /** The text a leader starts with: what is under the pointer, measured. */
  const defaultText = (hit: Inferred): string => {
    const frame = vp().frame;
    if (POINTS.has(hit.kind)) {
      // Red, green and blue as SketchUp shows them: green runs along -z here, blue is up.
      const [x, y, z] = frame.toLocal(hit.point);
      return t('text.point', { x: fmt(x), y: fmt(-z + 0), z: fmt(y) });
    }
    if (hit.kind === 'edge' && hit.edge) return fmt(hit.edge.a.distanceTo(hit.edge.b));
    const picked = vp().pick();
    if (picked?.kind === 'face') return formatArea(faceArea(definitionModel(ctx.session.doc, frame.definitionId)!, picked.id), ctx.units());
    if (picked?.kind === 'instance') {
      const scene = ctx.session.doc.scene;
      const i = pathDefinition(scene, ctx.contextPath())?.instances.get(picked.id);
      const name = i?.name || scene.definitions.get(i?.definitionId ?? '')?.name;
      if (name) return name;
    }
    return '';
  };

  /** Where the text goes: the pointer on the plane through the anchor facing the view. */
  const textPoint = (anchor: Vector3): Vector3 | null => {
    const view = vp().camera.target.clone().sub(vp().camera.camera.position).normalize();
    return vp().picker.rayPlane(anchor, view);
  };

  const finish = () => {
    editing = false;
    vp().clearPreview();
    ctx.hint();
  };

  /** Write the text in place, then add it with `add`. */
  const write = (place: { x: number; y: number; corner?: boolean }, initial: string, add: (text: string) => void) => {
    editing = true;
    ctx.hint();
    ctx.editText(place, initial, (text) => {
      finish();
      if (text !== null) add(text);
    });
  };

  const placeLeader = (s: Placing) => {
    const frame = vp().frame;
    const point = frame.toLocal(s.anchor);
    const tip = frame.toLocal(s.at);
    const leader: [number, number, number] = [tip[0] - point[0], tip[1] - point[1], tip[2] - point[2]];
    const screen = vp().picker.toScreen(s.at);
    state = null;
    write({ x: screen.x, y: screen.y }, s.text, (text) => {
      const r = ctx.session.execute('core.addText', { definitionId: frame.definitionId, point, leader, text });
      if (!r.ok) ctx.flashError(r.error);
    });
  };

  const placeScreenText = () => {
    const { x, y } = vp().picker.mouse;
    const size = vp().canvasSize();
    const definitionId = vp().frame.definitionId;
    const position: [number, number] = [Math.min(1, Math.max(0, x / size.width)), Math.min(1, Math.max(0, y / size.height))];
    write({ x, y, corner: true }, '', (text) => {
      const r = ctx.session.execute('core.addScreenText', { definitionId, position, text });
      if (!r.ok) ctx.flashError(r.error);
    });
  };

  return {
    id: 'text',
    cursor: 'crosshair',
    hint: () => t(editing ? 'status.text.write' : state ? 'status.text.place' : 'status.text.start'),
    measurementLabel: () => t('measure.length'),
    busy: () => state !== null || editing,

    down() {
      // A click while writing only finishes the text (the field loses focus).
      if (editing) return;
      if (state) return placeLeader(state);
      if (!vp().pick()) {
        const near = inferPoint(ctx, null, null);
        if (!near || !POINTS.has(near.kind)) return placeScreenText();
      }
      const hit = inferPoint(ctx, null, null);
      if (!hit) return;
      state = { anchor: hit.point.clone(), text: defaultText(hit), at: hit.point.clone() };
      vp().hideMarker();
      ctx.hint();
    },

    move() {
      if (editing) return;
      if (!state) {
        const hit = inferPoint(ctx, null, null);
        if (hit) vp().showMarker(hit.point, hit.kind);
        else vp().hideMarker();
        return;
      }
      const at = textPoint(state.anchor);
      if (!at) return;
      state.at = at;
      vp().showGuides([{ points: [state.anchor, at] }]);
    },

    submit() {
      ctx.flash(t('error.textNoTyping'), true);
    },

    reset() {
      const had = state !== null;
      state = null;
      vp().hideMarker();
      vp().clearPreview();
      return had;
    },
  };
}
