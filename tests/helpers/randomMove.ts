import { moveGeometry } from '../../src/kernel/move';
import { pushPull } from '../../src/kernel/pushPull';
import { drawRectangle } from '../../src/kernel/shapes';
import { emptyTopology, type Topology } from '../../src/kernel/types';
import { validate } from '../../src/kernel/validate';
import { rng } from './randomRun';

/**
 * Boxes on a 50 mm grid; then random faces and edges moved by random grid
 * vectors. A move is either refused or leaves a valid model, checked after
 * every step; a failure names the seed and step. Returns how many moves were
 * accepted.
 */
export function randomMoveRun(seed: number, steps: number): number {
  const r = rng(seed);
  const grid = (n: number) => Math.floor(r() * n) * 50;
  let t: Topology = emptyTopology();
  for (let i = 0; i < 3; i++) {
    const q = drawRectangle(t, { faceId: null, corner: [grid(20), 0, grid(20)], width: 100 + grid(6), depth: 100 + grid(6) });
    if (!q.ok) throw new Error(q.error);
    t = pushPull(q.topology, q.faceIds[0]!, 100 + grid(6)).topology;
  }
  let accepted = 0;
  for (let step = 0; step < steps; step++) {
    const faces = [...t.faces.keys()].filter(() => r() < 0.3);
    const edges = [...t.edges.keys()].filter(() => r() < 0.05);
    const vector = [grid(6) - 150, r() < 0.5 ? 0 : grid(6) - 150, grid(6) - 150] as const;
    const m = moveGeometry(t, faces, edges, vector);
    if (!m.ok) continue;
    const problems = validate(m.topology);
    if (problems.length) throw new Error(`seed ${seed}, step ${step}: ${problems.join('; ')}`);
    t = m.topology;
    accepted++;
  }
  return accepted;
}
