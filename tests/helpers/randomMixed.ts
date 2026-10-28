import { createSession, documentFromText, documentToText, type CommandSession } from '../../src/commands';
import { checkModel, listFaces, snapPoints } from '../../src/kernel';
import { findInstance, followAnchors, instanceCount, placedInstances, type Scene } from '../../src/scene';
import { rng } from './randomRun';

/**
 * Problems with a scene: each model's invariants, single-instance groups,
 * nothing orphaned, and dimensions and text already following their geometry
 * (the session follows after every command, so following again changes nothing).
 */
export function sceneProblems(s: Scene): string[] {
  const out: string[] = [];
  if (followAnchors(s) !== s) out.push('anchors do not follow their geometry');
  for (const d of s.definitions.values()) {
    for (const p of checkModel(d.model)) out.push(`${d.id}: ${p}`);
    const n = instanceCount(s, d.id);
    if (d.kind === 'group' && n !== 1) out.push(`group ${d.id} has ${n} instances`);
    if (d.kind !== 'root' && n === 0) out.push(`definition ${d.id} is not used`);
  }
  return out;
}

const AXES: [number, number, number][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [-1, 0, 0],
  [0, 0, -1],
];

/**
 * Every milestone 3 command mixed at random on a 50 mm grid: boxes and
 * push/pull in any definition; groups and components; moves and rotations of
 * instances and of loose geometry; copy arrays (multiply and divide); offsets;
 * explode, make unique and erase; amending the last command; undo and redo.
 * After every step the scene passes sceneProblems and survives the .pushform
 * text unchanged. Returns the session and how many of each command changed it.
 * With `milestone4`, also: corners moved on their own (folding), scale and
 * flip of instances and loose geometry, arcs and pies, guides, dimensions and
 * text. Without it, a seed runs exactly as it did in milestone 3.
 */
export function randomMixedRun(seed: number, steps: number, milestone4 = false): { session: CommandSession; counts: Record<string, number> } {
  const r = rng(seed);
  const s = createSession();
  const counts: Record<string, number> = {};
  const grid = (n: number) => Math.floor(r() * n) * 50;
  const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(r() * xs.length)];
  let last = '';
  const run = (id: string, input: unknown) => {
    last = ` after ${id} ${JSON.stringify(input)}`;
    const before = s.doc;
    const out = s.executeUnchecked(id, input);
    if (out.ok && s.doc !== before) counts[id] = (counts[id] ?? 0) + 1;
    return out;
  };
  /** Loose geometry of some definition: its id (undefined for the root) and a random share of its faces. */
  const looseFaces = () => {
    const def = pick([...s.doc.scene.definitions.values()])!;
    const faceIds = listFaces(def.model).map((f) => f.id).filter(() => r() < 0.4);
    return { definitionId: def.kind === 'root' ? undefined : def.id, faceIds };
  };
  /** A placed instance with the context it is in. */
  const someInstance = () => {
    const p = pick(placedInstances(s.doc.scene));
    if (!p) return null;
    const parent = findInstance(s.doc.scene, p.instance.id)!.parent;
    return { instanceIds: [p.instance.id], definitionId: parent.kind === 'root' ? undefined : parent.id };
  };
  const turn = () => ({ center: [grid(16), 0, grid(16)], axis: [0, 1, 0], angle: pick([90, -90, 180, 45, 30])! });

  for (let step = 0; step < steps; step++) {
    const root = s.doc.scene.definitions.get(s.doc.scene.rootId)!;
    const op = Math.floor(r() * (milestone4 ? 23 : 16));
    last = '';
    const where = () => `seed ${seed}, step ${step}, op ${op}${last}`;
    if (op <= 1 || !listFaces(root.model).length) {
      const def = pick([...s.doc.scene.definitions.values()])!;
      const definitionId = def.kind === 'root' ? undefined : def.id;
      const rect = run('core.drawRectangle', { definitionId, faceId: null, corner: [grid(16), 0, grid(16)], width: 100 + grid(6), depth: 100 + grid(6) });
      const face = rect.ok ? (rect.output as { faceIds: string[] }).faceIds[0] : undefined;
      if (face) run('core.pushPull', { definitionId, faceId: face, distance: 50 + grid(6) });
    } else if (op === 2) {
      const { definitionId, faceIds } = looseFaces();
      if (faceIds[0]) run('core.pushPull', { definitionId, faceId: faceIds[0], distance: (r() < 0.5 ? -1 : 1) * (50 + grid(4)) });
    } else if (op === 3) {
      const faceIds = listFaces(root.model).map((f) => f.id).filter(() => r() < 0.4);
      const instanceIds = [...root.instances.keys()].filter(() => r() < 0.3);
      if (faceIds.length + instanceIds.length) run(r() < 0.5 ? 'core.makeGroup' : 'core.makeComponent', { faceIds, instanceIds });
    } else if (op === 4) {
      const i = someInstance();
      if (i) run('core.move', { ...i, direction: pick(AXES), distance: 50 + grid(10) });
    } else if (op === 5) {
      const l = looseFaces();
      if (l.faceIds.length) run('core.move', { ...l, direction: pick(AXES), distance: 50 + grid(6) });
    } else if (op === 6) {
      const i = someInstance();
      if (i) run('core.rotate', { ...i, ...turn() });
    } else if (op === 7) {
      const l = looseFaces();
      if (l.faceIds.length) run('core.rotate', { ...l, ...turn() });
    } else if (op === 8) {
      const i = r() < 0.5 ? someInstance() : looseFaces();
      if (i && ('instanceIds' in i || i.faceIds.length)) {
        run('core.moveCopies', { ...i, direction: pick(AXES), distance: 200 + grid(10), copies: 1 + Math.floor(r() * 3), divide: r() < 0.3 });
      }
    } else if (op === 9) {
      const i = someInstance();
      if (i) run('core.rotateCopies', { ...i, ...turn(), copies: 1 + Math.floor(r() * 3), divide: r() < 0.3 });
    } else if (op === 10) {
      const { definitionId, faceIds } = looseFaces();
      if (faceIds[0]) run('core.offset', { definitionId, faceId: faceIds[0], distance: (r() < 0.6 ? 1 : -1) * (10 + grid(3)) });
    } else if (op === 11) {
      const p = pick(placedInstances(s.doc.scene));
      if (p) run('core.explode', { instanceIds: [p.instance.id] });
    } else if (op === 12) {
      const p = pick(placedInstances(s.doc.scene));
      if (p) run('core.makeUnique', { instanceIds: [p.instance.id] });
    } else if (op === 13) {
      const p = pick([...root.instances.values()]);
      if (p) run('core.erase', { faceIds: [], edgeIds: [], instanceIds: [p.id] });
    } else if (op === 14) {
      // Amend the last command with a new value for its first field, as typing would.
      const target = s.amendTarget();
      if (target) {
        const field = target.fields[0]!;
        const value =
          field.kind === 'count' || field.kind === 'array'
            ? 1 + Math.floor(r() * 4)
            : field.kind === 'angle'
              ? pick([15, 60, 120])!
              : field.kind === 'factor'
                ? pick([0.5, 2, -1])!
                : 50 + grid(8);
        const before = s.doc;
        if (s.amend({ [field.key]: value }).ok && s.doc !== before) counts.amend = (counts.amend ?? 0) + 1;
      }
    } else if (op === 16) {
      // A corner moved on its own: the faces around it fold.
      const def = pick([...s.doc.scene.definitions.values()])!;
      const corner = pick(snapPoints(def.model).filter((p) => p.kind === 'end'));
      if (corner?.vertex) run('core.move', { definitionId: def.kind === 'root' ? undefined : def.id, vertexIds: [corner.vertex], direction: pick(AXES), distance: 50 + grid(4) });
    } else if (op === 17) {
      const sel = r() < 0.5 ? someInstance() : looseFaces();
      const uniform = r() < 0.5;
      const axes = uniform ? [] : AXES.slice(0, 3).filter(() => r() < 0.5);
      const factors = (axes.length ? axes : [0]).map(() => pick([0.5, 1.5, 2, -1])!);
      const [factor, factor2, factor3] = factors;
      if (sel && ('instanceIds' in sel || sel.faceIds.length)) {
        run('core.scale', { ...sel, origin: [grid(16), 0, grid(16)], axes, factor, ...(factor2 === undefined ? {} : { factor2 }), ...(factor3 === undefined ? {} : { factor3 }), sizes: factors.map(() => 100 + grid(4)) });
      }
    } else if (op === 18) {
      const sel = r() < 0.5 ? someInstance() : looseFaces();
      if (sel && ('instanceIds' in sel || sel.faceIds.length)) run('core.flip', { ...sel, axis: pick(['red', 'green', 'blue'] as const)! });
    } else if (op === 19) {
      const def = pick([...s.doc.scene.definitions.values()])!;
      const definitionId = def.kind === 'root' ? undefined : def.id;
      const center: [number, number, number] = [grid(16), 0, grid(16)];
      const plane = { definitionId, faceId: null, normal: [0, 1, 0] };
      if (r() < 0.4) run('core.drawArc', { ...plane, start: center, end: [center[0] + 50 + grid(6), 0, center[2] + grid(4)], bulge: (r() < 0.5 ? -1 : 1) * (25 + grid(4)), segments: 2 + Math.floor(r() * 12) });
      else run(r() < 0.5 ? 'core.drawPie' : 'core.drawArcCenter', { ...plane, center, start: [center[0] + 100 + grid(4), 0, center[2]], angle: pick([45, 90, -90, 180, 270])!, segments: 2 + Math.floor(r() * 12) });
    } else if (op === 20) {
      const def = pick([...s.doc.scene.definitions.values()])!;
      const definitionId = def.kind === 'root' ? undefined : def.id;
      if (r() < 0.5) run('core.addGuideLine', { definitionId, point: [grid(16), grid(4), grid(16)], direction: pick(AXES) });
      else run('core.addGuidePoint', { definitionId, from: [grid(16), 0, grid(16)], direction: pick(AXES), distance: 50 + grid(4) });
    } else if (op === 21) {
      // A dimension between two corners (attached to them), or a text on one.
      const def = pick([...s.doc.scene.definitions.values()])!;
      const definitionId = def.kind === 'root' ? undefined : def.id;
      const corners = snapPoints(def.model).filter((p) => p.kind === 'end');
      const [a, b] = [pick(corners), pick(corners)];
      if (a && b && r() < 0.6) run('core.addDimension', { definitionId, start: a.point, end: b.point, offset: [0, 0, 100] });
      else if (a) run('core.addText', { definitionId, point: a.point, leader: [100, 100, 0], text: 'note' });
    } else if (op === 22) {
      // Dimensions and text moved with or without their geometry.
      const def = pick([...s.doc.scene.definitions.values()])!;
      const annotationIds = [...def.annotations.keys()].filter(() => r() < 0.5);
      const faceIds = listFaces(def.model).map((f) => f.id).filter(() => r() < 0.3);
      if (annotationIds.length) run('core.move', { definitionId: def.kind === 'root' ? undefined : def.id, annotationIds, faceIds, direction: pick(AXES), distance: 50 + grid(4) });
    } else if (s.canUndo) {
      const before = s.doc;
      s.undo();
      const problems = sceneProblems(s.doc.scene);
      if (problems.length) throw new Error(`${where()}, after undo: ${problems.join('; ')}`);
      s.redo();
      if (s.doc !== before) throw new Error(`${where()}: redo did not restore the document`);
      counts.undoRedo = (counts.undoRedo ?? 0) + 1;
    }
    const problems = sceneProblems(s.doc.scene);
    if (problems.length) throw new Error(`${where()}: ${problems.join('; ')}`);
    const text = documentToText(s.doc);
    const loaded = documentFromText(text);
    if (!loaded) throw new Error(`${where()}: the saved file does not open`);
    if (documentToText(loaded) !== text) throw new Error(`${where()}: save and open differ`);
  }
  return { session: s, counts };
}
