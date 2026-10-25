import { Vector3 } from 'three';
import type { Point3 } from '../kernel';

export const toVector = (p: Point3): Vector3 => new Vector3(p[0], p[1], p[2]);
export const toPoint = (v: Vector3): [number, number, number] => [v.x, v.y, v.z];
