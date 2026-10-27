import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, type PerspectiveCamera, Vector3 } from 'three';
import type { Annotation, Dimension, InstanceId } from '../scene';
import { toVector } from './convert';
import type { EdgeHighlight } from './modelView';

/** An annotation to draw, in world coordinates, with its text already formatted. */
export interface ShownAnnotation {
  readonly id: string;
  readonly path: readonly InstanceId[];
  /** Annotations outside the editing context are faded, like geometry. */
  readonly faded: boolean;
  readonly annotation: Annotation;
  readonly text: string;
}

/** Where a label was drawn: its center and size in canvas pixels, for picking and editing. */
export interface LabelBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const LINE_COLOR = 0x262c31;
const COLORS: Record<EdgeHighlight, number> = { selected: 0x1d5c86, hover: 0x4f8fc0, erase: 0xc0392b };
/** Tick marks and the extension past the dimension line, in camera distances to the point. */
const TICK = 0.008;

type Style = 'normal' | 'faded' | EdgeHighlight;
const line = (color: number, opacity = 1) => new LineBasicMaterial({ color, transparent: opacity < 1, opacity });
const LINES: Record<Style, LineBasicMaterial> = {
  normal: line(LINE_COLOR),
  faded: line(LINE_COLOR, 0.3),
  selected: line(COLORS.selected),
  hover: line(COLORS.hover),
  erase: line(COLORS.erase),
};

/** A dimension's lines in world coordinates: where its line runs, and the side it is offset to. */
export function dimensionLine(a: Dimension): { from: Vector3; to: Vector3; side: Vector3 } {
  const s = toVector(a.start.point);
  const e = toVector(a.end.point);
  const along = e.clone().sub(s).normalize();
  const offset = toVector(a.offset);
  // Only the part of the offset across the measured line counts.
  const side = offset.addScaledVector(along, -offset.dot(along));
  return { from: s.clone().add(side), to: e.clone().add(side), side };
}

/** Where an annotation's label sits in the model (world), or null for screen text. */
export function labelPoint(a: Annotation): Vector3 | null {
  if (a.kind === 'dimension') {
    const { from, to } = dimensionLine(a);
    return from.lerp(to, 0.5);
  }
  if (a.kind === 'text') return toVector(a.anchor.point).add(toVector(a.leader));
  return null;
}

/** The line a pointer or a selection window finds an annotation by: the dimension line or the leader. */
export function annotationSegment(a: Annotation): [Vector3, Vector3] | null {
  if (a.kind === 'dimension') {
    const { from, to } = dimensionLine(a);
    return [from, to];
  }
  if (a.kind === 'text') return [toVector(a.anchor.point), labelPoint(a)!];
  return null;
}

/**
 * Dimensions and text. A dimension has extension lines from the measured
 * points, the dimension line with tick marks at its ends, and its value at
 * the middle; leader text has a line from the point it labels to the text;
 * screen text sits at a fixed place in the view. Ticks scale with the view,
 * so the lines are rebuilt when it changes. Labels are DOM elements over the
 * canvas; those hidden behind faces are not shown.
 */
export class AnnotationsView {
  readonly group = new Group();
  /** Holds the labels over the canvas. */
  readonly labels = document.createElement('div');
  private shown: readonly ShownAnnotation[] = [];
  private highlights: ReadonlyMap<string, EdgeHighlight> = new Map();
  private readonly elements = new Map<string, HTMLElement>();
  private readonly boxes = new Map<string, LabelBox>();
  private lastView = '';

  constructor() {
    this.labels.className = 'annotation-labels';
  }

  show(annotations: readonly ShownAnnotation[]): void {
    this.shown = annotations;
    this.lastView = '';
    const ids = new Set(annotations.map((a) => a.id));
    for (const [id, el] of this.elements) {
      if (ids.has(id)) continue;
      el.remove();
      this.elements.delete(id);
    }
  }

  highlight(highlights: ReadonlyMap<string, EdgeHighlight>): void {
    this.highlights = highlights;
    this.lastView = '';
  }

  /** Hide one label (while its text is being edited in its place); null shows them all. */
  hideLabel(id: string | null): void {
    for (const [key, el] of this.elements) el.style.visibility = key === id ? 'hidden' : '';
  }

  /** Where each shown label was drawn, by annotation id. */
  labelBoxes(): ReadonlyMap<string, LabelBox> {
    return this.boxes;
  }

  /**
   * Rebuild for the current view; cheap when nothing changed. `screen` gives
   * canvas pixels (z > 1 behind the camera), `size` the canvas size, and
   * `visible` whether no face hides a point.
   */
  update(
    camera: PerspectiveCamera,
    target: Vector3,
    screen: (p: Vector3) => { x: number; y: number; z: number },
    size: { width: number; height: number },
    visible: (p: Vector3) => boolean,
  ): void {
    const view = `${camera.position.toArray().join()}|${target.toArray().join()}|${camera.aspect}|${size.width}x${size.height}`;
    if (view === this.lastView) return;
    this.lastView = view;
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as LineSegments).geometry.dispose();
    }
    this.boxes.clear();
    const lines = new Map<Style, number[]>();
    const push = (s: Style, ...v: Vector3[]) => {
      if (!lines.has(s)) lines.set(s, []);
      for (const p of v) lines.get(s)!.push(p.x, p.y, p.z);
    };
    for (const shown of this.shown) {
      const style: Style = this.highlights.get(shown.id) ?? (shown.faded ? 'faded' : 'normal');
      const a = shown.annotation;
      if (a.kind === 'dimension') {
        const { from, to, side } = dimensionLine(a);
        const along = to.clone().sub(from).normalize();
        const out = side.lengthSq() > 1e-12 ? side.clone().normalize() : along.clone().cross(camera.position.clone().sub(from)).normalize();
        const r = camera.position.distanceTo(from.clone().lerp(to, 0.5)) * TICK;
        push(style, from, to);
        for (const [p, q] of [
          [toVector(a.start.point), from],
          [toVector(a.end.point), to],
        ] as const) {
          if (side.lengthSq() > 1e-12) push(style, p, q.clone().addScaledVector(out, r));
          const tick = along.clone().add(out).normalize().multiplyScalar(r);
          push(style, q.clone().sub(tick), q.clone().add(tick));
        }
      } else if (a.kind === 'text') {
        push(style, ...annotationSegment(a)!);
      }
      const at = labelPoint(a);
      const s = at ? screen(at) : { x: a.kind === 'screenText' ? a.position[0] * size.width : 0, y: a.kind === 'screenText' ? a.position[1] * size.height : 0, z: 0 };
      this.label(shown, style, s, at === null || (s.z <= 1 && visible(at)));
    }
    for (const [style, xyz] of lines) {
      this.group.add(new LineSegments(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(xyz, 3)), LINES[style]));
    }
  }

  private label(shown: ShownAnnotation, style: Style, s: { x: number; y: number }, on: boolean): void {
    let el = this.elements.get(shown.id);
    if (!el) {
      el = document.createElement('span');
      this.labels.append(el);
      this.elements.set(shown.id, el);
    }
    el.className = `annotation-label ${shown.annotation.kind} ${style}`;
    el.textContent = shown.text;
    el.style.display = on ? '' : 'none';
    if (!on) return;
    // Canvas pixels are physical, like the snap marker's. Screen text hangs from its corner; other labels center on their point.
    const screenText = shown.annotation.kind === 'screenText';
    el.style.transform = `translate(${s.x}px, ${s.y}px)${screenText ? '' : ' translate(-50%, -50%)'}`;
    const [width, height] = [el.offsetWidth, el.offsetHeight];
    this.boxes.set(shown.id, { x: screenText ? s.x + width / 2 : s.x, y: screenText ? s.y + height / 2 : s.y, width, height });
  }
}
