import { Matrix4, Vector3 } from 'three';
import { cleanNormal, snapPoint, type Vec3 } from '../kernel';
import { AFFINE_IDENTITY, applyNormal, applyPoint, applyVector, invert, toMatrix, type Affine, type DefinitionId } from '../scene';

/** A point or direction as command inputs take it. */
export type Tuple3 = [number, number, number];
const tuple = (v: Vec3): Tuple3 => [v[0], v[1], v[2]];

/**
 * The coordinate frame of the open editing context. The view, picking and
 * inference work in world coordinates; commands take the context's local
 * coordinates. Tools convert with toLocal and toWorld.
 */
export class Frame {
  static readonly ROOT = new Frame(undefined, AFFINE_IDENTITY);
  private readonly inv: Affine;
  readonly matrix: Matrix4;

  constructor(
    /** The context's definition, or undefined for the root (as commands take it). */
    readonly definitionId: DefinitionId | undefined,
    /** Local space of the context to world space; it scales inside a scaled group or component. */
    readonly world: Affine,
  ) {
    this.inv = invert(world);
    this.matrix = new Matrix4().fromArray(toMatrix(world));
  }

  /** A world point in local coordinates, rounded to the model's precision. */
  toLocal(p: Vector3): Tuple3 {
    return tuple(snapPoint(applyPoint(this.inv, [p.x, p.y, p.z])));
  }

  /** A world direction in local coordinates (lengths in the context's own mm). */
  dirToLocal(v: Vector3): Tuple3 {
    return tuple(applyVector(this.inv, [v.x, v.y, v.z]));
  }

  /** A world unit normal in local coordinates, exact on the axes. */
  normalToLocal(n: Vector3): Tuple3 {
    return tuple(cleanNormal(applyNormal(this.inv, [n.x, n.y, n.z])));
  }

  /** A local face normal in world coordinates, unit length. */
  normalToWorld(n: Vec3): Vector3 {
    const w = applyNormal(this.world, n);
    return new Vector3(w[0], w[1], w[2]);
  }

  /** How far apart two world points are in the context's own mm (different inside a scaled group). */
  localDistance(a: Vector3, b: Vector3): number {
    return Math.hypot(...this.dirToLocal(b.clone().sub(a)));
  }

  toWorld(p: Vec3): Vector3 {
    const w = applyPoint(this.world, p);
    return new Vector3(w[0], w[1], w[2]);
  }

  dirToWorld(v: Vec3): Vector3 {
    const w = applyVector(this.world, v);
    return new Vector3(w[0], w[1], w[2]);
  }
}
