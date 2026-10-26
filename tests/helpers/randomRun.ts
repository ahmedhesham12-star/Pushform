import { createSession, type CommandSession , rootModel } from '../../src/commands';
import { checkModel, listFaces } from '../../src/kernel';

/** Small seeded generator so failures can be reproduced. */
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random ground rectangles, and push/pull on random horizontal faces (facing
 * up or down, by positive or negative distances), on a 50 mm grid. The
 * invariant checker runs after every step; a failure names the seed and step.
 */
export function randomRun(seed: number, steps: number): CommandSession {
  const r = rng(seed);
  const s = createSession();
  const grid = (n: number) => Math.floor(r() * n) * 50;
  for (let i = 0; i < steps; i++) {
    const horizontal = listFaces(rootModel(s.doc)).filter((f) => Math.abs(f.normal[1]) === 1);
    if (!horizontal.length || r() < 0.4) {
      s.execute('core.drawRectangle', { faceId: null, corner: [grid(16), 0, grid(16)], width: 50 + grid(8), depth: 50 + grid(8) });
    } else {
      const face = horizontal[Math.floor(r() * horizontal.length)]!;
      const distance = (r() < 0.5 ? -1 : 1) * (50 + grid(6));
      s.execute('core.pushPull', { faceId: face.id, distance });
    }
    const problems = checkModel(rootModel(s.doc));
    if (problems.length) throw new Error(`seed ${seed}, step ${i}: ${problems.join('; ')}`);
  }
  return s;
}
