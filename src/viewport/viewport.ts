import {
  BufferGeometry,
  Color,
  ColorManagement,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Group,
  type Intersection,
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
import { getFace, planeAxes, type Bounds, type Model } from '../kernel';
import {
  applyPoint,
  contextRelation,
  pathDefinition,
  pathTransform,
  worldEdges,
  worldSnapPoints,
  type InstanceId,
  type Scene as PushformScene,
  type WorldEdge,
} from '../scene';
import { gridStep, isImperial, MM_PER, type UnitSettings } from '../units';
import { OrbitCamera } from './camera';
import { toPoint, toVector } from './convert';
import { Frame } from './frame';
import { InstancesView } from './instancesView';
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

/** All in world coordinates. */
export interface PlaneHit {
  /** Face of the editing context under the cursor, or null for another group's face or the ground. */
  faceId: string | null;
  /** True on any face (the context's or another group's); false on the ground. */
  onFace: boolean;
  normal: Vector3;
  point: Vector3;
  /** The face's outer loop, when on a face (the context's or another group's). */
  outline?: Vector3[];
}

export interface EdgeHit {
  edgeId: string;
  point: Vector3;
  /** The edge's ends. */
  a: Vector3;
  b: Vector3;
  /** Instance path of the geometry the edge belongs to. */
  path: readonly InstanceId[];
  relation: 'context' | 'inside' | 'outside';
}

/**
 * The entity under the pointer, for selecting and erasing: a face or edge of
 * the editing context, an instance placed in it (selected as a whole), or
 * geometry outside the context (faded; `path` says where it belongs).
 */
export type Picked =
  | { kind: 'face' | 'edge'; id: string; point: Vector3 }
  | { kind: 'instance'; id: InstanceId; point: Vector3 }
  | { kind: 'outside'; path: readonly InstanceId[]; point: Vector3 };

export interface SnapCandidate {
  point: Vector3;
  kind: 'end' | 'mid';
  /** Instance path of the geometry the point belongs to. */
  path: readonly InstanceId[];
}

/** Entities of the editing context that picking and inference skip (the selection being moved). */
export interface PickExclusions {
  readonly faces: ReadonlySet<string>;
  readonly edges: ReadonlySet<string>;
  readonly instances: ReadonlySet<InstanceId>;
}

/** The 3D view: rendering, camera, picking and inference snapping. */
export class Viewport {
  readonly canvas: HTMLCanvasElement;
  readonly camera: OrbitCamera;
  readonly picker: Picker;
  readonly marker = new SnapMarker();
  private readonly selectionBox = document.createElement('div');
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly modelView = new ModelView();
  private readonly instancesView = new InstancesView();
  private readonly preview = new Group();
  private frameValue = Frame.ROOT;
  private context: readonly InstanceId[] = [];
  private shown: PushformScene | null = null;
  /** Geometry of the open editing context, as last committed. */
  private contextModel: Model | null = null;
  private worldEdgeList: WorldEdge[] = [];
  /** Previews draw here, so picking and inference keep using the committed scene. */
  private readonly previewModel = new ModelView();
  private readonly previewInstances = new InstancesView();
  private previewing = false;
  private excluded: PickExclusions | null = null;
  /** Endpoints and midpoints of excluded edges of the context (world), which inference skips too. */
  private excludedPoints: Vector3[] = [];
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
    this.selectionBox.className = 'selection-box';
    container.append(this.selectionBox);

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
    this.scene.add(this.modelView.group, this.instancesView.group, this.previewModel.group, this.previewInstances.group, this.preview);
    this.showPreviewMeshes(false);

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

  /**
   * Show a scene (the committed one, or a preview of a command) with the
   * editing context open at `context` (an instance path; [] is the root).
   * The context's geometry is editable; everything outside it is faded.
   */
  showScene(scene: PushformScene, context: readonly InstanceId[]): void {
    const def = pathDefinition(scene, context) ?? pathDefinition(scene, [])!;
    this.shown = scene;
    this.context = context;
    this.frameValue = new Frame(context.length ? def.id : undefined, pathTransform(scene, context));
    this.contextModel = def.model;
    this.modelView.build(def.model, this.frameValue.matrix);
    this.instancesView.build(scene, context);
    this.showPreviewMeshes(false);
    this.requestRender();
  }

  /**
   * Show a command's preview in place of the committed scene. Picking and
   * inference keep using the committed scene underneath, so geometry being
   * moved never catches the pointer. showScene or hidePreview ends it.
   */
  showPreviewScene(scene: PushformScene): void {
    const def = pathDefinition(scene, this.context) ?? pathDefinition(scene, [])!;
    this.previewModel.build(def.model, this.frameValue.matrix);
    this.previewInstances.build(scene, this.context);
    this.showPreviewMeshes(true);
    this.requestRender();
  }

  hidePreview(): void {
    if (!this.previewing) return;
    this.showPreviewMeshes(false);
    this.requestRender();
  }

  private showPreviewMeshes(on: boolean): void {
    this.previewing = on;
    this.previewModel.group.visible = this.previewInstances.group.visible = on;
    this.modelView.group.visible = this.instancesView.group.visible = !on;
  }

  /** Skip these entities in picking and inference (the selection being moved), or nothing. */
  setExcluded(excluded: PickExclusions | null): void {
    this.excluded = excluded;
    this.excludedPoints = [];
    if (!excluded?.edges.size) return;
    for (const e of this.worldEdgeList) {
      if (contextRelation(e.path, this.context) !== 'context' || !excluded.edges.has(e.edgeId)) continue;
      const a = toVector(e.a);
      const b = toVector(e.b);
      this.excludedPoints.push(a, b, a.clone().add(b).multiplyScalar(0.5));
    }
  }

  /** Whether geometry at `path`, or a face or edge of the context, is excluded. */
  private isExcluded(path: readonly InstanceId[], face?: string, edge?: string): boolean {
    const ex = this.excluded;
    if (!ex) return false;
    const relation = contextRelation(path, this.context);
    if (relation === 'inside') return ex.instances.has(path[this.context.length]!);
    if (relation !== 'context') return false;
    return (face !== undefined && ex.faces.has(face)) || (edge !== undefined && ex.edges.has(edge));
  }

  /** Raycast hits on the committed scene, nearest first, without excluded entities. */
  private hits() {
    return this.picker.raycaster.intersectObjects(this.allPickables, false).filter((h) => !this.hitExcluded(h));
  }

  private hitExcluded(h: Intersection): boolean {
    const faceId = h.object.userData.faceId as string | undefined;
    if (faceId) return this.isExcluded(this.context, faceId);
    const placed = this.instancesView.placementOf(h);
    return !!placed && this.isExcluded(placed.placement.path);
  }

  /**
   * The point on the surface the pointer actually sees, or null when that
   * surface is excluded (the face being pushed): hidden faces behind it do
   * not count.
   */
  pickVisiblePoint(): Vector3 | null {
    const h = this.picker.raycaster.intersectObjects(this.allPickables, false)[0];
    return h && !this.hitExcluded(h) ? this.exactPoint(h) : null;
  }

  /**
   * Where the pointer ray meets the exact plane of a hit face (meshes are
   * float32, so the raw hit point is off by a few millionths of a mm).
   */
  private exactPoint(h: Intersection): Vector3 {
    let plane: { point: Vector3; normal: Vector3 } | null = null;
    const faceId = h.object.userData.faceId as string | undefined;
    const f = faceId && this.contextModel ? getFace(this.contextModel, faceId) : undefined;
    if (f) plane = { point: this.frameValue.toWorld(f.outer[0]!), normal: this.frameValue.dirToWorld(f.normal) };
    const placed = faceId ? null : this.instancesView.placementOf(h);
    const g = placed?.faceId ? getFace(placed.placement.definition.model, placed.faceId) : undefined;
    if (placed && g) plane = { point: toVector(applyPoint(placed.placement.world, g.outer[0]!)), normal: toVector(placed.normal) };
    return (plane && this.picker.rayPlane(plane.point, plane.normal)) ?? h.point.clone();
  }

  /** The editing context's coordinate frame: tools convert world points to its local coordinates. */
  get frame(): Frame {
    return this.frameValue;
  }

  /**
   * Inference points and edges of every placement, in world coordinates,
   * including geometry outside the editing context. They come from the
   * committed scene only, as in the prototype.
   */
  setSnapTargets(scene: PushformScene): void {
    this.snaps = worldSnapPoints(scene).map((s) => ({ point: toVector(s.point), kind: s.kind, path: s.path }));
    this.worldEdgeList = worldEdges(scene);
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

  /** Paint a face of what is shown: the preview while there is one, otherwise the committed scene. */
  paint(faceId: string, kind: Parameters<ModelView['paint']>[1]): void {
    (this.previewing ? this.previewModel : this.modelView).paint(faceId, kind);
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

  private get allPickables() {
    return [...this.modelView.pickables, ...this.instancesView.pickables];
  }

  /** A face of the editing context under the pointer, unless something else is in front of it. */
  pickFace(): FaceHit | null {
    const hit = this.hits()[0];
    const faceId = hit?.object.userData.faceId as string | undefined;
    return hit && faceId ? { faceId, point: this.exactPoint(hit) } : null;
  }

  /** The nearest point under the pointer on any visible geometry (for zooming). */
  pickPoint(): Vector3 | null {
    return this.hits()[0]?.point.clone() ?? null;
  }

  /**
   * The visible edge nearest the pointer on screen, within EDGE_PICK_PX, that
   * is not hidden behind a face. `point` is the closest point on the edge.
   * Scope 'context' looks only at the editing context's edges (to select or
   * erase them); 'all' includes every group and component (for inference).
   */
  pickEdge(scope: 'context' | 'all' = 'context'): EdgeHit | null {
    const { x, y } = this.picker.mouse;
    const candidates: { px: number; edge: WorldEdge; point: Vector3 }[] = [];
    for (const edge of this.worldEdgeList) {
      if (scope === 'context' && contextRelation(edge.path, this.context) !== 'context') continue;
      if (this.isExcluded(edge.path, undefined, edge.edgeId)) continue;
      const e = { a: toVector(edge.a), b: toVector(edge.b) };
      const a = this.picker.toScreen(e.a);
      const b = this.picker.toScreen(e.b);
      if (a.z > 1 || b.z > 1) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
      const px = Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
      if (px < EDGE_PICK_PX) candidates.push({ px, edge, point: this.closestOnSegment(e.a, e.b) ?? e.a.clone().lerp(e.b, t) });
    }
    candidates.sort((p, q) => p.px - q.px);
    for (const c of candidates) {
      if (this.hidden(c.point)) continue;
      const path = c.edge.path;
      return { edgeId: c.edge.edgeId, point: c.point, a: toVector(c.edge.a), b: toVector(c.edge.b), path, relation: contextRelation(path, this.context) };
    }
    return null;
  }

  /**
   * The entity under the pointer: an edge of the context when one is close,
   * otherwise whatever face is in front: the context's, an instance in it, or
   * geometry outside it. Edges of instances count when no face is hit.
   */
  pick(): Picked | null {
    const e = this.pickEdge('all');
    if (e?.relation === 'context') return { kind: 'edge', id: e.edgeId, point: e.point };
    const hit = this.hits()[0];
    const faceId = hit?.object.userData.faceId as string | undefined;
    if (hit && faceId) return { kind: 'face', id: faceId, point: hit.point.clone() };
    const placed = hit ? this.instancesView.placementOf(hit) : null;
    const path = placed ? placed.placement.path : e?.path;
    const point = hit ? hit.point.clone() : e?.point;
    if (!path || !point) return null;
    if (contextRelation(path, this.context) === 'inside') return { kind: 'instance', id: path[this.context.length]!, point };
    return { kind: 'outside', path, point };
  }

  /** Bounding boxes around instances of the editing context, in highlight colors. */
  highlightInstances(instances: ReadonlyMap<InstanceId, EdgeHighlight>): void {
    if (this.shown) this.instancesView.highlight(this.shown, this.context, instances);
    this.requestRender();
  }

  highlightEdges(edges: ReadonlyMap<string, EdgeHighlight>): void {
    this.modelView.highlightEdges(edges);
    this.requestRender();
  }

  /** World normal of a face of the editing context. */
  normalOf(faceId: string): Vector3 | undefined {
    const n = this.modelView.normalOf(faceId);
    return n && this.frameValue.dirToWorld([n.x, n.y, n.z]);
  }

  /** Normal of the editing context's ground plane (its local Y), in world coordinates. */
  groundNormal(): Vector3 {
    return this.frameValue.dirToWorld([0, 1, 0]);
  }

  /** Where the pointer ray meets the editing context's ground plane, if it does. */
  groundPoint(): Vector3 | null {
    return this.picker.rayPlane(this.frameValue.toWorld([0, 0, 0]), this.groundNormal());
  }

  /** The face under the cursor (the context's, or any group's), or the context's ground when no face is hit. */
  planeUnderCursor(): PlaneHit | null {
    const hit = this.hits()[0];
    const faceId = hit?.object.userData.faceId as string | undefined;
    if (hit && faceId) {
      const normal = this.normalOf(faceId);
      const f = this.contextModel ? getFace(this.contextModel, faceId) : undefined;
      const outline = f?.outer.map((p) => this.frameValue.toWorld(p));
      if (normal) return { faceId, onFace: true, normal, point: this.exactPoint(hit), ...(outline ? { outline } : {}) };
    }
    const placed = hit ? this.instancesView.placementOf(hit) : null;
    if (hit && placed) {
      const g = placed.faceId ? getFace(placed.placement.definition.model, placed.faceId) : undefined;
      const outline = g?.outer.map((p) => toVector(applyPoint(placed.placement.world, p)));
      return { faceId: null, onFace: true, normal: toVector(placed.normal).normalize(), point: this.exactPoint(hit), ...(outline ? { outline } : {}) };
    }
    const g = this.groundPoint();
    return g && g.distanceTo(this.camera.camera.position) < MAX_GROUND_DISTANCE
      ? { faceId: null, onFace: false, normal: this.groundNormal(), point: g }
      : null;
  }

  /** Nearest inference point on screen within the snap radius that no face hides. */
  nearestSnap(filter: (p: Vector3) => boolean): SnapCandidate | null {
    const { x, y } = this.picker.mouse;
    const near: { d: number; s: SnapCandidate }[] = [];
    for (const s of this.snaps) {
      if (!filter(s.point) || this.isExcluded(s.path)) continue;
      if (this.excludedPoints.some((x) => x.distanceToSquared(s.point) < 1e-12)) continue;
      const p = this.picker.toScreen(s.point);
      if (p.z > 1) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < SNAP_RADIUS_PX) near.push({ d, s });
    }
    near.sort((a, b) => a.d - b.d);
    return near.find((n) => !this.hidden(n.s.point))?.s ?? null;
  }

  /**
   * Whether a face is clearly in front of a point along the line of sight.
   * Faces the point lies on are hit right at it, so they do not hide it; the
   * margin allows for float32 meshes seen at a grazing angle.
   */
  private hidden(point: Vector3): boolean {
    const cam = this.camera.camera.position;
    const d = point.distanceTo(cam);
    this.occlusion.set(cam, point.clone().sub(cam).normalize());
    const hit = this.occlusion.intersectObjects(this.allPickables, false)[0];
    return !!hit && hit.distance < d - Math.max(1, d * 1e-3);
  }

  /** A raw point on a plane (through planePoint, normal n), snapped to the grid step along the plane's axes. */
  gridPoint(planePoint: Vector3, n: Vector3, raw: Vector3): Vector3 {
    const [u, v] = planeAxes(toPoint(n)).map(toVector) as [Vector3, Vector3];
    const step = this.snapStep;
    const pu = Math.round(raw.dot(u) / step) * step;
    const pv = Math.round(raw.dot(v) / step) * step;
    return u.multiplyScalar(pu).add(v.multiplyScalar(pv)).add(n.clone().multiplyScalar(planePoint.dot(n)));
  }

  showMarker(p: Vector3, kind: MarkerKind): void {
    const s = this.picker.toScreen(p);
    this.marker.show(s.x, s.y, kind);
  }

  /**
   * The selection rectangle between two points in canvas pixels: a solid
   * outline for a window, dashed for a crossing, as in SketchUp.
   */
  showSelectionBox(a: { x: number; y: number }, b: { x: number; y: number }, crossing: boolean): void {
    const s = this.selectionBox.style;
    s.display = 'block';
    s.transform = `translate(${Math.min(a.x, b.x)}px, ${Math.min(a.y, b.y)}px)`;
    s.width = `${Math.abs(a.x - b.x)}px`;
    s.height = `${Math.abs(a.y - b.y)}px`;
    this.selectionBox.classList.toggle('crossing', crossing);
  }

  hideSelectionBox(): void {
    this.selectionBox.style.display = 'none';
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
    this.showGuides([{ points: [a, b], axis }]);
  }

  /** Guide lines (a protractor, rubber bands), each in an axis color or the accent color; open or closed. */
  showGuides(lines: readonly { points: Vector3[]; closed?: boolean; axis?: Axis | null }[]): void {
    this.clearPreview();
    for (const l of lines) {
      const material = l.axis ? AXIS_LINE[l.axis] : previewLine;
      const g = new BufferGeometry().setFromPoints(l.points);
      this.preview.add(l.closed ? new LineLoop(g, material) : new Line(g, material));
    }
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
  /**
   * The red, green or blue axis direction in world coordinates. Inside a group
   * or component these are its own axes, as in SketchUp, so locks and axis
   * inference follow a turned instance.
   */
  axisDirection(axis: Axis): Vector3 {
    const a = AXIS_DIRECTION[axis];
    return this.frameValue.dirToWorld([a.x, a.y, a.z]).normalize();
  }

  axisInference(start: Vector3): { axis: Axis; point: Vector3 } | null {
    const { x, y } = this.picker.mouse;
    const s = this.picker.toScreen(start);
    if (s.z > 1) return null;
    let best: { axis: Axis; point: Vector3 } | null = null;
    let bestPx = AXIS_PICK_PX;
    for (const axis of ['x', 'y', 'z'] as const) {
      const dir = this.axisDirection(axis);
      const e = this.picker.toScreen(start.clone().addScaledVector(dir, this.camera.distance * 0.1));
      const dx = e.x - s.x;
      const dy = e.y - s.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const px = Math.abs((x - s.x) * dy - (y - s.y) * dx) / len;
      if (px >= bestPx) continue;
      const point = this.closestOnLine(start, dir);
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
