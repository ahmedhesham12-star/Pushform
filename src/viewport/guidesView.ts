import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineDashedMaterial, LineSegments, type PerspectiveCamera, Vector3 } from 'three';
import type { Guide, InstanceId } from '../scene';
import { toVector } from './convert';
import type { EdgeHighlight } from './modelView';

/** A guide to draw, in world coordinates. */
export interface ShownGuide {
  readonly id: string;
  readonly path: readonly InstanceId[];
  /** Guides outside the editing context are faded, like geometry. */
  readonly faded: boolean;
  readonly guide: Guide;
}

const GUIDE_COLOR = 0x5b6670;
const COLORS: Record<EdgeHighlight, number> = { selected: 0x1d5c86, hover: 0x4f8fc0, erase: 0xc0392b };
/** Guide lines reach this many camera distances each way; dashes and crosses scale with the view. */
const REACH = 40;
/** Drawn guide lines stay this many camera distances in front of the camera (lines through it vanish). */
const NEAR = 0.01;
const DASH = 0.012;
const GAP = 0.009;
const CROSS = 0.008;

type Style = 'normal' | 'faded' | EdgeHighlight;
const dashed = (color: number, opacity = 1) => new LineDashedMaterial({ color, dashSize: 1, gapSize: 1, transparent: opacity < 1, opacity });
const solid = (color: number, opacity = 1) => new LineBasicMaterial({ color, transparent: opacity < 1, opacity });
const LINES: Record<Style, LineDashedMaterial> = {
  normal: dashed(GUIDE_COLOR),
  faded: dashed(GUIDE_COLOR, 0.3),
  selected: dashed(COLORS.selected),
  hover: dashed(COLORS.hover),
  erase: dashed(COLORS.erase),
};
const POINTS: Record<Style, LineBasicMaterial> = {
  normal: solid(GUIDE_COLOR),
  faded: solid(GUIDE_COLOR, 0.3),
  selected: solid(COLORS.selected),
  hover: solid(COLORS.hover),
  erase: solid(COLORS.erase),
};

/**
 * Guide lines as dashed lines reaching far past the view, and guide points
 * as small crosses. Infinite lines cannot be drawn, so they are rebuilt
 * around the camera's target whenever the view changes, with dashes and
 * crosses sized to the camera distance.
 */
export class GuidesView {
  readonly group = new Group();
  private guides: readonly ShownGuide[] = [];
  private highlights: ReadonlyMap<string, EdgeHighlight> = new Map();
  private lastView = '';

  show(guides: readonly ShownGuide[]): void {
    this.guides = guides;
    this.lastView = '';
  }

  highlight(highlights: ReadonlyMap<string, EdgeHighlight>): void {
    this.highlights = highlights;
    this.lastView = '';
  }

  /** Rebuild for the current view; cheap when nothing changed. */
  update(camera: PerspectiveCamera, target: Vector3): void {
    const distance = camera.position.distanceTo(target);
    const view = `${camera.position.toArray().join()}|${target.toArray().join()}`;
    if (view === this.lastView) return;
    this.lastView = view;
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as LineSegments).geometry.dispose();
    }
    for (const m of Object.values(LINES)) {
      m.dashSize = distance * DASH;
      m.gapSize = distance * GAP;
    }
    const lines = new Map<Style, number[]>();
    const points = new Map<Style, number[]>();
    const push = (m: Map<Style, number[]>, s: Style, ...v: Vector3[]) => {
      if (!m.has(s)) m.set(s, []);
      for (const p of v) m.get(s)!.push(p.x, p.y, p.z);
    };
    for (const g of this.guides) {
      const style: Style = this.highlights.get(g.id) ?? (g.faded ? 'faded' : 'normal');
      const p = toVector(g.guide.point);
      if (g.guide.kind === 'line') {
        const seg = guideSegment(p, toVector(g.guide.direction), camera, target);
        if (seg) push(lines, style, ...seg);
      } else {
        const r = camera.position.distanceTo(p) * CROSS;
        const [u, v, w] = [new Vector3(r, 0, 0), new Vector3(0, r, 0), new Vector3(0, 0, r)];
        push(points, style, p.clone().sub(u), p.clone().add(u), p.clone().sub(v), p.clone().add(v), p.clone().sub(w), p.clone().add(w));
      }
    }
    for (const [style, xyz] of lines) {
      const seg = new LineSegments(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(xyz, 3)), LINES[style]);
      seg.computeLineDistances();
      this.group.add(seg);
    }
    for (const [style, xyz] of points) {
      this.group.add(new LineSegments(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(xyz, 3)), POINTS[style]));
    }
  }
}

/**
 * The part of an infinite guide line worth drawing: within REACH camera
 * distances of the point nearest the target, in front of the camera and
 * before its far plane. Null when none of it is in view.
 */
export function guideSegment(point: Vector3, direction: Vector3, camera: PerspectiveCamera, target: Vector3): [Vector3, Vector3] | null {
  const distance = camera.position.distanceTo(target);
  const mid = point.clone().addScaledVector(direction, target.clone().sub(point).dot(direction));
  let [lo, hi] = [-distance * REACH, distance * REACH];
  // Depth along the view direction is linear along the line: keep it between near and far.
  const forward = target.clone().sub(camera.position).normalize();
  const depth0 = mid.clone().sub(camera.position).dot(forward);
  const slope = direction.dot(forward);
  const [near, far] = [distance * NEAR, camera.far * 0.9];
  if (Math.abs(slope) < 1e-12) {
    if (depth0 < near || depth0 > far) return null;
  } else {
    const a = (near - depth0) / slope;
    const b = (far - depth0) / slope;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
    if (lo >= hi) return null;
  }
  return [mid.clone().addScaledVector(direction, lo), mid.clone().addScaledVector(direction, hi)];
}
