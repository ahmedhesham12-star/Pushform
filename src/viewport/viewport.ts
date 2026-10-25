import {
  BufferGeometry,
  Color,
  ColorManagement,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineLoop,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { planeAxes, type Bounds, type Model, type SnapPoint } from '../kernel';
import { gridStep, isImperial, MM_PER, type UnitSettings } from '../units';
import { OrbitCamera } from './camera';
import { toPoint, toVector } from './convert';
import { SnapMarker, type MarkerKind } from './marker';
import { ModelView, type EdgeHighlight } from './modelView';
import { Picker, type FaceHit } from './picking';

// Match the r128 prototype: colors are used as given, with no sRGB conversion.
ColorManagement.enabled = false;

/** Lengths in mm. */
const AXIS_LENGTH = 60_000;
const MAX_GROUND_DISTANCE = 300_000;
/** Snap radius around inference points, in pixels. */
const SNAP_RADIUS_PX = 14;
/** How close (pixels) the pointer must be to an edge to pick it. */
const EDGE_PICK_PX = 6;
/** Points within this distance (mm) of a plane count as on it. */
const ON_PLANE = 0.1;

const PREVIEW_COLOR = 0x1d5c86;
const previewFill = new MeshBasicMaterial({
  color: PREVIEW_COLOR,
  transparent: true,
  opacity: 0.22,
  side: DoubleSide,
  depthWrite: false,
});
const previewLine = new LineBasicMaterial({ color: PREVIEW_COLOR });

export type Axis = 'x' | 'y' | 'z';
/** Red is X, green is Z and blue is Y (up), as drawn by the axis lines. */
export const AXIS_DIRECTION: Record<Axis, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
};
const AXIS_COLOR: Record<Axis, number> = { x: 0xc4443b, y: 0x3a62c2, z: 0x3e9a4c };
const AXIS_LINE: Record<Axis, LineBasicMaterial> = {
  x: new LineBasicMaterial({ color: AXIS_COLOR.x }),
  y: new LineBasicMaterial({ color: AXIS_COLOR.y }),
  z: new LineBasicMaterial({ color: AXIS_COLOR.z }),
};
/** How close (pixels) the pointer must be to an axis line through the start point to lock onto it. */
const AXIS_PICK_PX = 10;

export interface PlaneHit {
  /** Face under the cursor, or null for the ground. */
  faceId: string | null;
  normal: Vector3;
  point: Vector3;
}

export interface EdgeHit {
  edgeId: string;
  point: Vector3;
}

export interface Picked {
  kind: 'face' | 'edge';
  id: string;
  point: Vector3;
}

export interface SnapCandidate {
  point: Vector3;
  kind: 'end' | 'mid';
}

/** The 3D view: rendering, camera, picking and inference snapping. */
export class Viewport {
  readonly canvas: HTMLCanvasElement;
  readonly camera: OrbitCamera;
  readonly picker: Picker;
  readonly marker = new SnapMarker();
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly modelView = new ModelView();
  private readonly preview = new Group();
  private grid: GridHelper | null = null;
  private imperialGrid = false;
  private snapStep = 50;
  private snaps: SnapCandidate[] = [];
  /** Separate from the pointer ray, for line-of-sight tests. */
  private readonly occlusion = new Raycaster();
  private pending = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.canvas = this.renderer.domElement;
    container.prepend(this.canvas);
    container.append(this.marker.element);

    this.camera = new OrbitCamera(() => this.requestRender());
    this.picker = new Picker(this.canvas, this.camera.camera);

    // Physically based light units: multiply by PI to match the prototype's legacy lighting.
    this.scene.add(new HemisphereLight(0xffffff, 0x7c8590, 0.85 * Math.PI));
    const sun = new DirectionalLight(0xffffff, 0.55 * Math.PI);
    sun.position.set(4, 10, 7);
    this.scene.add(sun);
    this.scene.add(
      axis(AXIS_COLOR.x, new Vector3(1, 0, 0)),
      axis(AXIS_COLOR.z, new Vector3(0, 0, -1)),
      axis(AXIS_COLOR.y, new Vector3(0, 1, 0)),
    );
    this.scene.add(this.modelView.group, this.preview);

    new ResizeObserver(() => this.resize()).observe(container);
    this.readTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.readTheme());
    new MutationObserver(() => this.readTheme()).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  requestRender(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.renderer.render(this.scene, this.camera.camera);
    });
  }

  /* ---------- model ---------- */

  /** Show a model (the committed one, or a preview of a command). */
  showModel(model: Model): void {
    this.modelView.build(model);
    this.requestRender();
  }

  /** Inference points come from the committed model only, as in the prototype. */
  setSnapPoints(points: readonly SnapPoint[]): void {
    this.snaps = points.map((s) => ({ point: toVector(s.point), kind: s.kind }));
  }

  get snapCandidates(): readonly SnapCandidate[] {
    return this.snaps;
  }

  setUnits(units: UnitSettings): void {
    this.snapStep = gridStep(units);
    const imperial = isImperial(units.unit);
    if (imperial !== this.imperialGrid) {
      this.imperialGrid = imperial;
      this.readTheme();
    }
  }

  paint(faceId: string, kind: Parameters<ModelView['paint']>[1]): void {
    this.modelView.paint(faceId, kind);
    this.requestRender();
  }

  paintAll(kind: Parameters<ModelView['paintAll']>[0]): void {
    this.modelView.paintAll(kind);
    this.requestRender();
  }

  zoomToFit(bounds: Bounds | null): void {
    this.camera.fit(bounds);
  }

  /* ---------- picking ---------- */

  setPointer(e: { clientX: number; clientY: number }): void {
    this.picker.setPointer(e.clientX, e.clientY);
  }

  pickFace(): FaceHit | null {
    return this.picker.pickFace(this.modelView.pickables);
  }

  /**
   * The visible edge nearest the pointer on screen, within EDGE_PICK_PX, that
   * is not hidden behind a face. `point` is the closest point on the edge.
   */
  pickEdge(): EdgeHit | null {
    const { x, y } = this.picker.mouse;
    const cam = this.camera.camera.position;
    const candidates: { px: number; edgeId: string; point: Vector3 }[] = [];
    for (const e of this.modelView.edges) {
      const a = this.picker.toScreen(e.a);
      const b = this.picker.toScreen(e.b);
      if (a.z > 1 || b.z > 1) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
      const px = Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
      if (px < EDGE_PICK_PX) candidates.push({ px, edgeId: e.id, point: this.closestOnSegment(e.a, e.b) ?? e.a.clone().lerp(e.b, t) });
    }
    candidates.sort((p, q) => p.px - q.px);
    for (const c of candidates) {
      // Hidden when a face is clearly in front of the edge along the line of sight.
      // Faces the edge lies on are hit right at the edge point, so they do not hide it.
      const d = c.point.distanceTo(cam);
      this.occlusion.set(cam, c.point.clone().sub(cam).normalize());
      const hit = this.occlusion.intersectObjects(this.modelView.pickables, false)[0];
      if (hit && hit.distance < d - Math.max(1, d * 1e-4)) continue;
      return { edgeId: c.edgeId, point: c.point };
    }
    return null;
  }

  /** The entity under the pointer: an edge when one is close, otherwise a face. */
  pick(): Picked | null {
    const e = this.pickEdge();
    if (e) return { kind: 'edge', id: e.edgeId, point: e.point };
    const f = this.pickFace();
    return f ? { kind: 'face', id: f.faceId, point: f.point } : null;
  }

  highlightEdges(edges: ReadonlyMap<string, EdgeHighlight>): void {
    this.modelView.highlightEdges(edges);
    this.requestRender();
  }

  normalOf(faceId: string): Vector3 | undefined {
    return this.modelView.normalOf(faceId);
  }

  /** Where the pointer ray meets the ground plane, if it does. */
  groundPoint(): Vector3 | null {
    return this.picker.rayPlane(new Vector3(), new Vector3(0, 1, 0));
  }

  /** The face under the cursor, or the ground when no face is hit. */
  planeUnderCursor(): PlaneHit | null {
    const h = this.pickFace();
    if (h) {
      const normal = this.normalOf(h.faceId);
      if (normal) return { faceId: h.faceId, normal, point: h.point };
    }
    const g = this.groundPoint();
    return g && g.distanceTo(this.camera.camera.position) < MAX_GROUND_DISTANCE
      ? { faceId: null, normal: new Vector3(0, 1, 0), point: g }
      : null;
  }

  /** Nearest inference point on screen within the snap radius. */
  nearestSnap(filter: (p: Vector3) => boolean): SnapCandidate | null {
    let best: SnapCandidate | null = null;
    let bestDistance = SNAP_RADIUS_PX;
    const { x, y } = this.picker.mouse;
    for (const s of this.snaps) {
      if (!filter(s.point)) continue;
      const p = this.picker.toScreen(s.point);
      if (p.z > 1) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDistance) {
        bestDistance = d;
        best = s;
      }
    }
    return best;
  }

  /**
   * Snap a raw point on a plane to an endpoint or midpoint on that plane, or
   * else to the grid. Shows the inference marker and returns the snapped point.
   */
  snapOnPlane(planePoint: Vector3, n: Vector3, raw: Vector3, fallback: MarkerKind): Vector3 {
    const best = this.nearestSnap((p) => Math.abs(p.clone().sub(planePoint).dot(n)) < ON_PLANE);
    if (best) {
      this.showMarker(best.point, best.kind);
      return best.point.clone();
    }
    const [u, v] = planeAxes(toPoint(n)).map(toVector) as [Vector3, Vector3];
    const step = this.snapStep;
    const pu = Math.round(raw.dot(u) / step) * step;
    const pv = Math.round(raw.dot(v) / step) * step;
    const p = u.multiplyScalar(pu).add(v.multiplyScalar(pv)).add(n.clone().multiplyScalar(planePoint.dot(n)));
    this.showMarker(p, fallback);
    return p;
  }

  showMarker(p: Vector3, kind: MarkerKind): void {
    const s = this.picker.toScreen(p);
    this.marker.show(s.x, s.y, kind);
  }

  hideMarker(): void {
    this.marker.hide();
  }

  /* ---------- previews ---------- */

  /** Preview of a convex shape (rectangle, circle, polygon): a light fill and its outline. */
  showShapePreview(corners: Vector3[], normal: Vector3): void {
    this.clearPreview();
    const lift = normal.clone().multiplyScalar(2);
    const c = corners.map((p) => p.clone().add(lift));
    const fan: Vector3[] = [];
    for (let i = 1; i + 1 < c.length; i++) fan.push(c[0]!, c[i]!, c[i + 1]!);
    this.preview.add(new Mesh(new BufferGeometry().setFromPoints(fan), previewFill));
    this.preview.add(new LineLoop(new BufferGeometry().setFromPoints(c), previewLine));
    this.requestRender();
  }

  /** A rubber-band line from a to b, in an axis color or the accent color. */
  showLinePreview(a: Vector3, b: Vector3, axis: Axis | null): void {
    this.clearPreview();
    const material = axis ? AXIS_LINE[axis] : previewLine;
    this.preview.add(new Line(new BufferGeometry().setFromPoints([a, b]), material));
    this.requestRender();
  }

  /** The point on the infinite line origin + s * dir closest to the pointer ray, or null when they are parallel. */
  closestOnLine(origin: Vector3, dir: Vector3): Vector3 | null {
    const { origin: o, direction: d } = this.picker.ray;
    const u = dir.clone().normalize();
    const w0 = origin.clone().sub(o);
    const b = u.dot(d);
    const den = 1 - b * b;
    if (den < 1e-6) return null;
    const s = (b * d.dot(w0) - u.dot(w0)) / den;
    return origin.clone().addScaledVector(u, s);
  }

  /** The point on segment ab closest to the pointer ray (exact in 3D, unlike screen interpolation). */
  closestOnSegment(a: Vector3, b: Vector3): Vector3 | null {
    const ab = b.clone().sub(a);
    const len = ab.length();
    const p = this.closestOnLine(a, ab);
    if (!p || !len) return null;
    const s = Math.max(0, Math.min(len, p.clone().sub(a).dot(ab) / len));
    return a.clone().addScaledVector(ab, s / len);
  }

  /**
   * Axis inference: the red, green or blue axis through `start` whose line on
   * screen passes closest to the pointer, within AXIS_PICK_PX, and the point on it.
   */
  axisInference(start: Vector3): { axis: Axis; point: Vector3 } | null {
    const { x, y } = this.picker.mouse;
    const s = this.picker.toScreen(start);
    if (s.z > 1) return null;
    let best: { axis: Axis; point: Vector3 } | null = null;
    let bestPx = AXIS_PICK_PX;
    for (const axis of ['x', 'y', 'z'] as const) {
      const e = this.picker.toScreen(start.clone().addScaledVector(AXIS_DIRECTION[axis], this.camera.distance * 0.1));
      const dx = e.x - s.x;
      const dy = e.y - s.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const px = Math.abs((x - s.x) * dy - (y - s.y) * dx) / len;
      if (px >= bestPx) continue;
      const point = this.closestOnLine(start, AXIS_DIRECTION[axis]);
      if (!point) continue;
      bestPx = px;
      best = { axis, point };
    }
    return best;
  }

  clearPreview(): void {
    for (const c of [...this.preview.children]) {
      this.preview.remove(c);
      if (c instanceof Mesh || c instanceof Line) c.geometry.dispose();
    }
    this.requestRender();
  }

  /* ---------- internals ---------- */

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.setAspect(w, h);
  }

  private readTheme(): void {
    const cs = getComputedStyle(document.documentElement);
    const color = (name: string) => new Color(cs.getPropertyValue(name).trim() || '#888');
    this.scene.background = color('--canvas');
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
    }
    // Metric: 60 m in 1 m cells. Imperial: 200 ft in 1 ft cells.
    this.grid = this.imperialGrid
      ? new GridHelper(200 * MM_PER.ft, 200, color('--grid-2'), color('--grid'))
      : new GridHelper(60_000, 60, color('--grid-2'), color('--grid'));
    this.grid.position.y = -4;
    this.scene.add(this.grid);
    this.requestRender();
  }
}

/** Axis line: solid on the positive side, dashed on the negative side. */
function axis(color: number, dir: Vector3): Group {
  const g = new Group();
  const solid = new BufferGeometry().setFromPoints([new Vector3(), dir.clone().multiplyScalar(AXIS_LENGTH)]);
  g.add(new Line(solid, new LineBasicMaterial({ color })));
  const dashed = new Line(
    new BufferGeometry().setFromPoints([new Vector3(), dir.clone().multiplyScalar(-AXIS_LENGTH)]),
    new LineDashedMaterial({ color, dashSize: 250, gapSize: 180 }),
  );
  dashed.computeLineDistances();
  g.add(dashed);
  return g;
}
