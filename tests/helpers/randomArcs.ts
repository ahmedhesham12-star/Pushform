import { createSession, rootModel, type CommandSession } from '../../src/commands';
import { checkModel, listFaces } from '../../src/kernel';
import { rng } from './randomRun';

const UP: [number, number, number] = [0, 1, 0];
const root = (s: CommandSession) => rootModel(s.doc);

/** Rectangles, arcs, pies and push/pulls on a 50 mm grid; the invariants hold after every step. */
export function arcRun(seed: number, steps: number): CommandSession {
  const r = rng(seed);
  const s = createSession();
  const grid = (n: number) => Math.floor(r() * n) * 50;
  for (let i = 0; i < steps; i++) {
    const roll = r();
    const faces = listFaces(root(s)).filter((f) => Math.abs(f.normal[1]) === 1);
    const face = faces.length && r() < 0.5 ? faces[Math.floor(r() * faces.length)]! : null;
    const y = face ? face.outer[0]![1] : 0;
    const at = (): [number, number, number] => [grid(12), y, grid(12)];
    const plane = { faceId: face?.id ?? null, ...(face ? {} : { normal: UP }) };
    if (roll < 0.25) s.execute('core.drawRectangle', { faceId: null, corner: at(), width: 50 + grid(6), depth: 50 + grid(6) });
    else if (roll < 0.5) s.execute('core.drawArc', { ...plane, start: at(), end: at(), bulge: (r() < 0.5 ? -1 : 1) * (25 + grid(6)), segments: 2 + Math.floor(r() * 12) });
    else if (roll < 0.75) {
      const center = at();
      const angle = (r() < 0.5 ? -1 : 1) * (15 + Math.floor(r() * 23) * 15);
      const command = r() < 0.5 ? 'core.drawPie' : 'core.drawArcCenter';
      s.execute(command, { ...plane, center, start: [center[0] + 50 + grid(5), y, center[2]], angle, segments: 2 + Math.floor(r() * 12) });
    } else if (faces.length) {
      const f = faces[Math.floor(r() * faces.length)]!;
      s.execute('core.pushPull', { faceId: f.id, distance: (r() < 0.5 ? -1 : 1) * (50 + grid(4)) });
    }
    const problems = checkModel(root(s));
    if (problems.length) throw new Error(`seed ${seed}, step ${i}: ${problems.join('; ')}`);
  }
  return s;
}
