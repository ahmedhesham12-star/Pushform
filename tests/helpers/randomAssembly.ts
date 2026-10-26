import { extract, merge, transformTopology } from '../../src/kernel/assembly';
import { pushPull } from '../../src/kernel/pushPull';
import { drawRectangle } from '../../src/kernel/shapes';
import { emptyTopology, type Point3, type Topology } from '../../src/kernel/types';
import { validate } from '../../src/kernel/validate';
import { rng } from './randomRun';

/** A quarter turn about +Y: x -> -z, z -> x. */
const quarterY = (p: Point3): Point3 => [p[2], p[1], -p[0]];

function check(t: Topology, where: string) {
  const problems = validate(t);
  if (problems.length) throw new Error(`${where}: ${problems.join('; ')}`);
}

/**
 * Boxes on a 50 mm grid; then, repeatedly, a random set of faces is extracted,
 * moved or turned a quarter, and merged back. The invariant checker runs on
 * every intermediate model; a failure names the seed and step.
 */
export function randomAssemblyRun(seed: number, steps: number): Topology {
  const r = rng(seed);
  const grid = (n: number) => Math.floor(r() * n) * 50;
  let t = emptyTopology();
  for (let i = 0; i < 4; i++) {
    const rect = drawRectangle(t, { faceId: null, corner: [grid(20), 0, grid(20)], width: 100 + grid(6), depth: 100 + grid(6) });
    if (!rect.ok) throw new Error(rect.error);
    t = pushPull(rect.topology, rect.faceIds[0]!, 100 + grid(6)).topology;
  }
  check(t, `seed ${seed}, build`);
  for (let step = 0; step < steps; step++) {
    const x = extract(t, [...t.faces.keys()].filter(() => r() < 0.5), []);
    check(x.remaining, `seed ${seed}, step ${step}, remaining`);
    check(x.extracted, `seed ${seed}, step ${step}, extracted`);
    const turned = r() < 0.4 ? transformTopology(x.extracted, quarterY, quarterY) : x.extracted;
    const [dx, dz] = [grid(6) - 150, grid(6) - 150];
    t = merge(x.remaining, transformTopology(turned, (p) => [p[0] + dx, p[1], p[2] + dz], (v) => v)).topology;
    check(t, `seed ${seed}, step ${step}, merged`);
  }
  return t;
}
