import { createSession, deserializeDocument, serializeDocument, type CommandSession } from '../../src/commands';
import { checkModel, listFaces } from '../../src/kernel';
import { instanceCount, placedInstances, type Scene } from '../../src/scene';
import { rng } from './randomRun';

/** Problems with a scene beyond each model's own invariants. */
function sceneProblems(s: Scene): string[] {
  const out: string[] = [];
  for (const d of s.definitions.values()) {
    for (const p of checkModel(d.model)) out.push(`${d.id}: ${p}`);
    const n = instanceCount(s, d.id);
    if (d.kind === 'group' && n !== 1) out.push(`group ${d.id} has ${n} instances`);
    if (d.kind !== 'root' && n === 0) out.push(`definition ${d.id} is not used`);
  }
  return out;
}

/**
 * Random boxes, push/pull, make group or component, copies, explode, make
 * unique and erase, in the root and inside definitions, on a 50 mm grid.
 * After every step each definition passes the invariant checker, groups have
 * one instance, nothing is orphaned, and the document survives a save and load.
 */
export function randomSceneRun(seed: number, steps: number): CommandSession {
  const r = rng(seed);
  const s = createSession();
  const grid = (n: number) => Math.floor(r() * n) * 50;
  const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(r() * xs.length)];
  for (let step = 0; step < steps; step++) {
    const scene = s.doc.scene;
    const defs = [...scene.definitions.values()];
    const root = scene.definitions.get(scene.rootId)!;
    const placed = placedInstances(scene);
    const op = Math.floor(r() * 8);
    const where = `seed ${seed}, step ${step}, op ${op}`;
    if (op <= 1 || !listFaces(root.model).length) {
      const def = pick(defs)!;
      const definitionId = def.kind === 'root' ? undefined : def.id;
      const rect = s.execute('core.drawRectangle', { definitionId, faceId: null, corner: [grid(16), 0, grid(16)], width: 50 + grid(6), depth: 50 + grid(6) });
      if (rect.ok && rect.output.faceIds[0]) s.execute('core.pushPull', { definitionId, faceId: rect.output.faceIds[0], distance: 50 + grid(6) });
    } else if (op === 2) {
      const def = pick(defs)!;
      const face = pick(listFaces(def.model).filter((f) => Math.abs(f.normal[1]) === 1));
      if (face) s.execute('core.pushPull', { definitionId: def.id, faceId: face.id, distance: (r() < 0.5 ? -1 : 1) * (50 + grid(4)) });
    } else if (op === 3) {
      const faceIds = listFaces(root.model).map((f) => f.id).filter(() => r() < 0.4);
      const instanceIds = [...root.instances.keys()].filter(() => r() < 0.3);
      if (faceIds.length + instanceIds.length) s.execute(r() < 0.5 ? 'core.makeGroup' : 'core.makeComponent', { faceIds, instanceIds });
    } else if (op === 4) {
      const p = pick(placed);
      if (p) s.execute('core.copyInstances', { instanceIds: [p.instance.id], translation: [grid(10) - 250, 0, grid(10) - 250] });
    } else if (op === 5) {
      const p = pick(placed);
      if (p) s.execute('core.explode', { instanceIds: [p.instance.id] });
    } else if (op === 6) {
      const p = pick(placed);
      if (p) s.execute('core.makeUnique', { instanceIds: [p.instance.id] });
    } else {
      const p = pick([...root.instances.values()]);
      if (p) s.execute('core.erase', { faceIds: [], edgeIds: [], instanceIds: [p.id] });
    }
    const problems = sceneProblems(s.doc.scene);
    if (problems.length) throw new Error(`${where}: ${problems.join('; ')}`);
    const saved = JSON.parse(JSON.stringify(serializeDocument(s.doc)));
    const loaded = deserializeDocument(saved);
    if (!loaded) throw new Error(`${where}: the saved document does not load`);
    if (JSON.stringify(serializeDocument(loaded)) !== JSON.stringify(saved)) throw new Error(`${where}: save and load differ`);
  }
  return s;
}
