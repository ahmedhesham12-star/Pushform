import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { Bounds } from '../kernel';

/** Camera limits in mm. */
const NEAR = 50;
const FAR = 600_000;
const DEFAULT_DISTANCE = 16_000;
const MIN_DISTANCE = 400;
const MAX_DISTANCE = 300_000;
const MIN_FIT_DISTANCE = 3_000;
/** Zoom anchors farther than this from the camera fall back to the orbit target. */
const MAX_ANCHOR_DISTANCE = 250_000;

/** Spherical orbit camera around a target point, as in the prototype. */
export class OrbitCamera {
  readonly camera = new PerspectiveCamera(40, 1, NEAR, FAR);
  readonly target = new Vector3();
  distance = DEFAULT_DISTANCE;
  private theta = 0.72;
  private phi = 1.02;

  constructor(private readonly onChange: () => void) {
    this.update();
  }

  update(): void {
    this.phi = Math.min(Math.PI - 0.02, Math.max(0.02, this.phi));
    const sp = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.distance * sp * Math.sin(this.theta),
      this.target.y + this.distance * Math.cos(this.phi),
      this.target.z + this.distance * sp * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.onChange();
  }

  setAspect(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.onChange();
  }

  orbit(dx: number, dy: number): void {
    this.theta -= dx * 0.008;
    this.phi -= dy * 0.008;
    this.update();
  }

  /** Pan by a screen-space drag of (dx, dy) pixels in a view `height` pixels tall. */
  pan(dx: number, dy: number, height: number): void {
    const s = (2 * this.distance * Math.tan(MathUtils.degToRad(this.camera.fov / 2))) / (height || 1);
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    this.update();
  }

  /** Zoom by a wheel delta, keeping `anchor` (the point under the cursor) fixed on screen. */
  zoomAt(deltaY: number, anchor: Vector3 | null): void {
    const newDistance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, this.distance * Math.exp(deltaY * 0.0015)));
    const k = newDistance / this.distance;
    const a = anchor && anchor.distanceTo(this.camera.position) <= MAX_ANCHOR_DISTANCE ? anchor : this.target;
    this.target.lerp(a, 1 - k);
    this.distance = newDistance;
    this.update();
  }

  fit(bounds: Bounds | null): void {
    if (!bounds) {
      this.target.set(0, 0, 0);
      this.distance = DEFAULT_DISTANCE;
    } else {
      const min = new Vector3(...bounds.min);
      const max = new Vector3(...bounds.max);
      this.target.copy(min).add(max).multiplyScalar(0.5);
      this.distance = Math.max(MIN_FIT_DISTANCE, max.distanceTo(min) * 1.9);
    }
    this.update();
  }
}
