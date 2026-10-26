import { Plane, Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';

export interface FaceHit {
  faceId: string;
  point: Vector3;
}

/** Turns pointer positions into rays and world points into screen positions. */
export class Picker {
  readonly raycaster = new Raycaster();
  /** Last pointer position in canvas pixels. */
  readonly mouse = { x: 0, y: 0 };
  private readonly ndc = new Vector2();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: PerspectiveCamera,
  ) {}

  setPointer(clientX: number, clientY: number): void {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = clientX - r.left;
    this.mouse.y = clientY - r.top;
    this.ndc.set((this.mouse.x / r.width) * 2 - 1, -(this.mouse.y / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }

  get ray() {
    return this.raycaster.ray;
  }

  rayPlane(point: Vector3, normal: Vector3): Vector3 | null {
    const out = new Vector3();
    return this.raycaster.ray.intersectPlane(new Plane().setFromNormalAndCoplanarPoint(normal, point), out);
  }

  /** Canvas pixel position of a world point; z > 1 means behind the camera. */
  toScreen(p: Vector3): { x: number; y: number; z: number } {
    const r = this.canvas.getBoundingClientRect();
    const q = p.clone().project(this.camera);
    return { x: ((q.x + 1) / 2) * r.width, y: ((1 - q.y) / 2) * r.height, z: q.z };
  }
}
