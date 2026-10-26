import { Matrix4, Vector3 } from 'three';
import { cleanNormal, snapPoint, type Vec3 } from '../kernel';
import { applyPoint, applyVector, IDENTITY, inverse, toMatrix, type DefinitionId, type Transform } from '../scene';

/** A point or direction as command inputs take it. */
export type Tuple3 = [number, number, number];
const tuple = (v: Vec3): Tuple3 => [v[0], v[1], v[2]];

/**
 * The coordinate frame of the open editing context. The view, picking and
 * inference work in world coordinates; commands take the context's local
 * coordinates. Tools convert with toLocal and toWorld.
 */
export class Frame {
  static readonly ROOT = new Frame(undefined, IDENTITY);
  private readonly inv: Transform;
  readonly matrix: Matrix4;

  constructor(
    /** The context's definition, or undefined for the root (as commands take it). */
    readonly definitionId: DefinitionId | undefined,
    /** Local space of the context to world space. */
    readonly world: Transform,
  ) {
    this.inv = inverse(world);
    this.matrix = new Matrix4().fromArray(toMatrix(world));
  }

  /** A world point in local coordinates, rounded to the model's precision. */
  toLocal(p: Vector3): Tuple3 {
    return tuple(snapPoint(applyPoint(this.inv, [p.x, p.y, p.z])));
  }

  /** A world direction in local coordinates. */
  dirToLocal(v: Vector3): Tuple3 {
    return tuple(applyVector(this.inv, [v.x, v.y, v.z]));
  }

  /** A world unit normal in local coordinates, exact on the axes. */
  normalToLocal(n: Vector3): Tuple3 {
    return tuple(cleanNormal(applyVector(this.inv, [n.x, n.y, n.z])));
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
