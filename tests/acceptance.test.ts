// @vitest-environment happy-dom
import { validateBytes } from 'gltf-validator';
import { describe, expect, test } from 'vitest';
import {
  createSession,
  definitionModel,
  documentFromText,
  documentToText,
  matchTypedValues,
  serializeDocument,
  type CommandSession,
} from '../src/commands';
import { exportGlb, exportStl, worldTriangles } from '../src/export';
import { checkModel, listFaces, solidVolume } from '../src/kernel';
import { definitionBounds, findInstance, getDefinition, instanceCount, placedInstances, type Scene } from '../src/scene';
import { loadAutosave, saveAutosave } from '../src/storage';
import { parseTypedValues } from '../src/units';

/*
 * Milestone 3 acceptance: a cabinet built the way a user would, through
 * commands only. A carcass group (an 800 x 500 x 720 box, open at the front,
 * 18 mm panels), a drawer component placed three times with a move-copy array
 * (one copy, then x2 typed), three front groups, and the middle drawer with
 * its front pulled open. Then save, reload and compare.
 */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

/** Type into the measurements box after a command, as the app does. */
function type(s: CommandSession, text: string) {
  const target = s.amendTarget()!;
  const parsed = parseTypedValues(text, s.doc.units.unit);
  if (!parsed.ok) throw new Error(`could not parse ${text}`);
  const matched = matchTypedValues(target.fields, parsed);
  if (!matched.ok) throw new Error(matched.error.code);
  return ok(s.amend(matched.value));
}

/** A box in the root: a rectangle in the horizontal plane at height y, pushed up by h. Returns its faces. */
function box(s: CommandSession, x: number, y: number, z: number, w: number, d: number, h: number): string[] {
  const before = new Set(listFaces(definitionModel(s.doc)!).map((f) => f.id));
  const r = ok(s.execute('core.drawRectangle', { faceId: null, normal: [0, 1, 0], corner: [x, y, z], width: w, depth: d }));
  ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: h }));
  return listFaces(definitionModel(s.doc)!)
    .map((f) => f.id)
    .filter((f) => !before.has(f));
}

function buildCabinet() {
  const s = createSession();
  s.execute('core.setDisplayUnits', { unit: 'mm', precision: 0 });

  // Carcass: a box, its front offset in by 18 mm and pushed in 482 mm, leaving an 18 mm back.
  const carcassFaces = box(s, 0, 0, 0, 800, 500, 720);
  const front = listFaces(definitionModel(s.doc)!).find((f) => f.normal[2] === 1)!;
  ok(s.execute('core.offset', { faceId: front.id, distance: 18 }));
  // The inner face of the front (the ring around it has a hole).
  const opening = listFaces(definitionModel(s.doc)!).find((f) => f.normal[2] === 1 && f.holes.length === 0)!.id;
  ok(s.execute('core.pushPull', { faceId: opening, distance: -482 }));
  const carcass = ok(s.execute('core.makeGroup', { faceIds: listFaces(definitionModel(s.doc)!).map((f) => f.id) }));
  ok(s.execute('core.renameInstance', { instanceId: carcass.instanceId, name: 'Carcass' }));
  expect(carcassFaces).toHaveLength(6);

  // Drawer: a component, copied up by 230 mm, then x2 typed for three in all.
  const drawer = ok(s.execute('core.makeComponent', { faceIds: box(s, 20, 30, 20, 760, 460, 200), name: 'Drawer' }));
  ok(s.execute('core.moveCopies', { instanceIds: [drawer.instanceId], direction: [0, 1, 0], distance: 230, copies: 1, divide: false }));
  const drawers = type(s, 'x2') as { instanceIds: string[] };

  // Fronts: a group, copied the same way (each copy is its own group).
  const front1 = ok(s.execute('core.makeGroup', { faceIds: box(s, 2, 20, 500, 796, 18, 226) }));
  ok(s.execute('core.renameInstance', { instanceId: front1.instanceId, name: 'Front' }));
  const fronts = ok(s.execute('core.moveCopies', { instanceIds: [front1.instanceId], direction: [0, 1, 0], distance: 230, copies: 2, divide: false }));

  // The middle drawer and its front pulled open by 300 mm.
  const middle = [drawers.instanceIds[0]!, fronts.instanceIds[0]!];
  ok(s.execute('core.move', { instanceIds: middle, direction: [0, 0, 1], distance: 300 }));
  return { s, carcass, drawer, drawers: [drawer.instanceId, ...drawers.instanceIds], fronts: [front1.instanceId, ...fronts.instanceIds] };
}

/** What a user would check: every placement's world bounds, by name. */
function layout(scene: Scene) {
  return placedInstances(scene).map((p) => {
    const def = scene.definitions.get(p.instance.definitionId)!;
    return { name: p.instance.name || def.name || def.kind, t: p.world.t, bounds: definitionBounds(scene, def.id) };
  });
}

describe('milestone 3 acceptance: a cabinet', () => {
  const c = buildCabinet();
  const scene = c.s.doc.scene;

  test('the carcass is a group with an open front and 18 mm panels', () => {
    const carcass = findInstance(scene, c.carcass.instanceId)!.instance;
    expect(carcass.name).toBe('Carcass');
    const def = getDefinition(scene, carcass.definitionId)!;
    expect(def.kind).toBe('group');
    expect(checkModel(def.model)).toEqual([]);
    expect(definitionBounds(scene, def.id)).toEqual({ min: [0, 0, 0], max: [800, 720, 500] });
    // The box minus the opening: 764 x 684 x 482 mm.
    expect(solidVolume(def.model)).toBeCloseTo(800 * 720 * 500 - 764 * 684 * 482, 0);
  });

  test('three drawers share one component; three fronts are separate groups', () => {
    expect(instanceCount(scene, c.drawer.definitionId)).toBe(3);
    const ys = c.drawers.map((id) => findInstance(scene, id)!.instance.transform.translation[1]).sort((a, b) => a - b);
    expect(ys).toEqual([30, 260, 490]);
    const frontDefs = new Set(c.fronts.map((id) => findInstance(scene, id)!.instance.definitionId));
    expect(frontDefs.size).toBe(3);
    for (const d of frontDefs) expect(getDefinition(scene, d)!.kind).toBe('group');
    // Root, carcass, drawer, three fronts.
    expect(scene.definitions.size).toBe(6);
    for (const d of scene.definitions.values()) expect(checkModel(d.model), d.id).toEqual([]);
  });

  test('the middle drawer and its front are pulled open by 300 mm', () => {
    const t = (id: string) => findInstance(scene, id)!.instance.transform.translation;
    expect(t(c.drawers[1]!)).toEqual([20, 260, 320]);
    expect(t(c.fronts[1]!)).toEqual([2, 250, 800]);
    expect(t(c.drawers[0]!)).toEqual([20, 30, 20]);
  });

  test('save and reload give back the same cabinet (file and autosave)', () => {
    const text = documentToText(c.s.doc);
    const reopened = documentFromText(text)!;
    expect(reopened).not.toBeNull();
    expect(serializeDocument(reopened)).toEqual(serializeDocument(c.s.doc));
    expect(layout(reopened.scene)).toEqual(layout(scene));
    // Editing the reopened cabinet works as before: the component is still shared.
    const again = createSession(reopened);
    const top = listFaces(definitionModel(again.doc, c.drawer.definitionId)!).find((f) => f.normal[1] === 1)!;
    ok(again.execute('core.pushPull', { definitionId: c.drawer.definitionId, faceId: top.id, distance: -20 }));
    expect(instanceCount(again.doc.scene, c.drawer.definitionId)).toBe(3);
    // Through the browser autosave too.
    localStorage.clear();
    saveAutosave(c.s.doc);
    expect(serializeDocument(loadAutosave()!)).toEqual(serializeDocument(c.s.doc));
  });

  test('it exports: STL with every part placed, GLB with the drawer as one shared mesh', async () => {
    const stl = exportStl(scene);
    expect(stl.byteLength).toBe(84 + 50 * worldTriangles(scene).length);
    const glb = exportGlb(scene, 'Cabinet');
    const report = await validateBytes(glb);
    expect(report.issues.numErrors).toBe(0);
    expect(report.issues.numWarnings).toBe(0);
  });
});
