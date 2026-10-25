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
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { planeAxes, type Bounds, type Model, type SnapPoint } from '../kernel';
import { gridStep, isImperial, MM_PER, type UnitSettings } from '../units';
import { OrbitCamera } from './camera';
import { toPoint, toVector } from './convert';
import { SnapMarker, type MarkerKind } from './marker';
import { ModelView } from './modelView';
import { Picker, type FaceHit } from './picking';

// Match the r128 prototype: colors are used as given, with no sRGB conversion.
ColorManagement.enabled = false;

/** Lengths in mm. */
const AXIS_LENGTH = 60_000;
const MAX_GROUND_DISTANCE = 300_000;
/** Snap radius around inference points, in pixels. */
const SNAP_RADIUS_PX = 14;
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

export interface PlaneHit {
  /** Face under the cursor, or null for the ground. */
  faceId: string | null;
  normal: Vector3;
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
      axis(0xc4443b, new Vector3(1, 0, 0)),
      axis(0x3e9a4c, new Vector3(0, 0, -1)),
      axis(0x3a62c2, new Vector3(0, 1, 0)),
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

  showRectanglePreview(corners: Vector3[], normal: Vector3): void {
    this.clearPreview();
    const lift = normal.clone().multiplyScalar(2);
    const c = corners.map((p) => p.clone().add(lift));
    this.preview.add(new Mesh(new BufferGeometry().setFromPoints([c[0]!, c[1]!, c[2]!, c[0]!, c[2]!, c[3]!]), previewFill));
    this.preview.add(new LineLoop(new BufferGeometry().setFromPoints(c), previewLine));
    this.requestRender();
  }

  clearPreview(): void {
    for (const c of [...this.preview.children]) {
      this.preview.remove(c);
      if (c instanceof Mesh || c instanceof LineLoop) c.geometry.dispose();
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
