import { BufferGeometry, DoubleSide, Float32BufferAttribute, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3, type Intersection } from 'three';
import { describe, expect, test } from 'vitest';
import { MeshBvh } from '../src/viewport/meshBvh';

/** A small seeded generator, so a failing case can be run again. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe('picking a reference mesh through its tree', () => {
  test.each([1, 2, 3])('finds the same hits as testing every triangle (seed %i)', (seed) => {
    const r = random(seed);
    const positions = new Float32Array(3000 * 9);
    for (let t = 0; t < 3000; t++) {
      const c = [r() * 1000, r() * 1000, r() * 1000];
      for (let k = 0; k < 9; k++) positions[9 * t + k] = c[k % 3]! + (r() - 0.5) * 60;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
    // Placed turned and scaled, as instances are.
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(new Matrix4().makeRotationY(0.7).multiply(new Matrix4().makeScale(1.5, 1, -1)).setPosition(200, -50, 30));
    mesh.updateMatrixWorld(true);
    const bvh = new MeshBvh(positions);
    const raycaster = new Raycaster();
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      const origin = new Vector3(r() * 3000 - 1000, r() * 3000 - 1000, r() * 3000 - 1000);
      const target = new Vector3(r() * 1500, r() * 1000 - 50, r() * 1000 - 500);
      raycaster.set(origin, target.sub(origin).normalize());
      const brute: Intersection[] = [];
      Mesh.prototype.raycast.call(mesh, raycaster, brute);
      const fast: Intersection[] = [];
      bvh.raycast(mesh, raycaster, fast);
      const key = (list: Intersection[]) => list.map((h) => `${h.faceIndex}:${h.distance.toFixed(3)}`).sort();
      expect(key(fast)).toEqual(key(brute));
      hits += brute.length;
    }
    expect(hits).toBeGreaterThan(20);
  });
});
