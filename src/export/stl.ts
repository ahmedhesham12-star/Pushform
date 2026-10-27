import { faceMeshes, type Model, type Point3 } from '../kernel';
import { applyPoint, determinant, placements, type Scene } from '../scene';

/**
 * Pushform is Y-up; STL readers (slicers, CAD) take Z as up. A quarter turn
 * about red maps one to the other without mirroring: (x, y, z) -> (x, -z, y).
 */
const zUp = (p: Point3): Point3 => [p[0], -p[2] + 0, p[1]];

/** Every triangle of the scene in world coordinates (mm, Y-up), each wound counter-clockwise around its face's front. */
export function worldTriangles(scene: Scene): Point3[][] {
  const local = new Map<Model, ReturnType<typeof faceMeshes>>();
  const out: Point3[][] = [];
  for (const p of placements(scene)) {
    const m = p.definition.model;
    if (!local.has(m)) local.set(m, faceMeshes(m));
    // A mirrored placement turns each triangle's winding around: take its corners the other way.
    const order = determinant(p.world) < 0 ? [0, 6, 3] : [0, 3, 6];
    for (const mesh of local.get(m)!) {
      const q = mesh.positions;
      for (let i = 0; i < q.length; i += 9) {
        out.push(order.map((k) => applyPoint(p.world, [q[i + k]!, q[i + k + 1]!, q[i + k + 2]!])));
      }
    }
  }
  return out;
}

/**
 * The scene as a binary STL in millimeters, Z up, every group and component
 * placed where it is. One facet per triangle; the facet normal follows the
 * face's front side.
 */
export function exportStl(scene: Scene): Uint8Array<ArrayBuffer> {
  const tris = worldTriangles(scene);
  const bytes = new Uint8Array(84 + tris.length * 50);
  const view = new DataView(bytes.buffer);
  // A header that does not start with "solid", so readers do not take the file for ASCII STL.
  const header = 'Pushform binary STL, millimeters, Z up';
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
  view.setUint32(80, tris.length, true);
  let at = 84;
  for (const tri of tris) {
    const [a, b, c] = tri.map(zUp) as [Point3, Point3, Point3];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    for (const x of [n[0]! / len, n[1]! / len, n[2]! / len, ...a, ...b, ...c]) {
      view.setFloat32(at, x, true);
      at += 4;
    }
    view.setUint16(at, 0, true);
    at += 2;
  }
  return bytes;
}
