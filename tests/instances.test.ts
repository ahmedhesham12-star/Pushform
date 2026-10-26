import { describe, expect, test } from 'vitest';
import {
  createSession,
  deserializeDocument,
  rootModel,
  serializeDocument,
  type CommandSession,
  type PushformDocument,
} from '../src/commands';
import { bounds, checkModel, edgeCount, faceArea, faceCount, listFaces, serialize, type Model } from '../src/kernel';
import {
  definitionBounds,
  findInstance,
  getDefinition,
  instanceCount,
  placedInstances,
  putInstance,
  rotationAbout,
  compose,
  translation,
} from '../src/scene';
import { randomSceneRun } from './helpers/randomScene';

/* All sizes in mm. */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

/** A box drawn in a definition (the root by default); returns the ids of its faces. */
function box(s: CommandSession, x: number, z: number, w: number, d: number, h: number, definitionId?: string): string[] {
  const before = new Set(listFaces(model(s, definitionId)).map((f) => f.id));
  const r = ok(s.execute('core.drawRectangle', { definitionId, faceId: null, corner: [x, 0, z], width: w, depth: d }));
  ok(s.execute('core.pushPull', { definitionId, faceId: r.faceIds[0]!, distance: h }));
  return listFaces(model(s, definitionId))
    .map((f) => f.id)
    .filter((f) => !before.has(f));
}

const model = (s: CommandSession, id?: string): Model => getDefinition(s.doc.scene, id ?? s.doc.scene.rootId)!.model;
const area = (m: Model) => listFaces(m).reduce((a, f) => a + faceArea(m, f.id), 0);

/** Every definition's geometry passes the invariant checker. */
function expectValid(doc: PushformDocument) {
  for (const d of doc.scene.definitions.values()) expect(checkModel(d.model), `definition ${d.id}`).toEqual([]);
}

describe('make group and make component', () => {
  test('a box becomes a group with its origin at the minimum corner, and the world does not move', () => {
    const s = createSession();
    const faces = box(s, 100, 200, 1000, 500, 300);
    const before = bounds(rootModel(s.doc));
    const r = ok(s.execute('core.makeGroup', { faceIds: faces }));
    expectValid(s.doc);
    expect(faceCount(rootModel(s.doc))).toBe(0);
    expect(edgeCount(rootModel(s.doc))).toBe(0);
    const def = getDefinition(s.doc.scene, r.definitionId)!;
    expect(def.kind).toBe('group');
    expect(faceCount(def.model)).toBe(6);
    expect(bounds(def.model)).toEqual({ min: [0, 0, 0], max: [1000, 300, 500] });
    expect(findInstance(s.doc.scene, r.instanceId)!.instance.transform.translation).toEqual([100, 0, 200]);
    expect(definitionBounds(s.doc.scene, s.doc.scene.rootId)).toEqual(before);
    // One undo step brings the loose box back.
    s.undo();
    expect(faceCount(rootModel(s.doc))).toBe(6);
    expect(s.doc.scene.definitions.size).toBe(1);
  });

  test('edges shared with geometry left behind are copied', () => {
    const s = createSession();
    ok(s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 1000, depth: 1000 }));
    const right = ok(s.execute('core.drawRectangle', { faceId: null, corner: [1000, 0, 0], width: 1000, depth: 1000 }));
    const r = ok(s.execute('core.makeGroup', { faceIds: right.faceIds }));
    expectValid(s.doc);
    expect(faceCount(rootModel(s.doc))).toBe(1);
    expect(edgeCount(rootModel(s.doc))).toBe(4);
    expect(edgeCount(getDefinition(s.doc.scene, r.definitionId)!.model)).toBe(4);
  });

  test('components get numbered default names, or the name given', () => {
    const s = createSession();
    const a = ok(s.execute('core.makeComponent', { faceIds: box(s, 0, 0, 100, 100, 100) }));
    const b = ok(s.execute('core.makeComponent', { faceIds: box(s, 500, 0, 100, 100, 100) }));
    const c = ok(s.execute('core.makeComponent', { faceIds: box(s, 1000, 0, 100, 100, 100), name: '  Drawer ' }));
    expect(getDefinition(s.doc.scene, a.definitionId)!.name).toBe('Component#1');
    expect(getDefinition(s.doc.scene, b.definitionId)!.name).toBe('Component#2');
    expect(getDefinition(s.doc.scene, c.definitionId)!.name).toBe('Drawer');
    expect(getDefinition(s.doc.scene, c.definitionId)!.kind).toBe('component');
  });

  test('geometry in different definitions never merges', () => {
    const s = createSession();
    const g = ok(s.execute('core.makeGroup', { faceIds: box(s, 0, 0, 1000, 1000, 500) }));
    const inside = getDefinition(s.doc.scene, g.definitionId)!.model;
    // A rectangle on the ground right across the group's footprint stays a single face in the root.
    ok(s.execute('core.drawRectangle', { faceId: null, corner: [-500, 0, -500], width: 2000, depth: 2000 }));
    expect(faceCount(rootModel(s.doc))).toBe(1);
    expect(getDefinition(s.doc.scene, g.definitionId)!.model).toBe(inside);
  });

  test('instances nest: grouping two groups keeps their world positions', () => {
    const s = createSession();
    const a = ok(s.execute('core.makeGroup', { faceIds: box(s, 0, 0, 100, 100, 100) }));
    const b = ok(s.execute('core.makeGroup', { faceIds: box(s, 500, 300, 100, 100, 100) }));
    const before = definitionBounds(s.doc.scene, s.doc.scene.rootId);
    const outer = ok(s.execute('core.makeGroup', { instanceIds: [a.instanceId, b.instanceId] }));
    expectValid(s.doc);
    expect(getDefinition(s.doc.scene, s.doc.scene.rootId)!.instances.size).toBe(1);
    expect(findInstance(s.doc.scene, b.instanceId)!.parent.id).toBe(outer.definitionId);
    expect(findInstance(s.doc.scene, b.instanceId)!.instance.transform.translation).toEqual([500, 0, 300]);
    expect(definitionBounds(s.doc.scene, s.doc.scene.rootId)).toEqual(before);
    expect(placedInstances(s.doc.scene).map((p) => p.path.length)).toEqual([1, 2, 2]);
  });

  test('loose geometry and instances group together', () => {
    const s = createSession();
    const a = ok(s.execute('core.makeGroup', { faceIds: box(s, 0, 0, 100, 100, 100) }));
    const loose = box(s, 300, 0, 100, 100, 100);
    const r = ok(s.execute('core.makeComponent', { faceIds: loose, instanceIds: [a.instanceId] }));
    const def = getDefinition(s.doc.scene, r.definitionId)!;
    expect(faceCount(def.model)).toBe(6);
    expect(def.instances.has(a.instanceId)).toBe(true);
  });

  test('geometry commands edit a definition in its local coordinates', () => {
    const s = createSession();
    const g = ok(s.execute('core.makeGroup', { faceIds: box(s, 1000, 0, 1000, 1000, 500) }));
    const top = listFaces(model(s, g.definitionId)).find((f) => f.normal[1] === 1)!;
    ok(s.execute('core.pushPull', { definitionId: g.definitionId, faceId: top.id, distance: 200 }));
    expect(bounds(model(s, g.definitionId))).toEqual({ min: [0, 0, 0], max: [1000, 700, 1000] });
    expect(faceCount(rootModel(s.doc))).toBe(0);
  });

  test('nothing selected, or a missing context, is rejected', () => {
    const s = createSession();
    const r = s.execute('core.makeGroup', { faceIds: ['nope'] });
    expect(r.ok ? '' : r.error.code).toBe('nothingSelected');
    const missing = s.execute('core.makeGroup', { definitionId: 'd99', faceIds: ['f1'] });
    expect(missing.ok ? '' : missing.error.code).toBe('noSuchDefinition');
    expect(s.canUndo).toBe(false);
  });
});

describe('explode', () => {
  test('exploding a group puts the geometry back and removes the definition', () => {
    const s = createSession();
    box(s, 100, 200, 1000, 500, 300);
    const before = serialize(rootModel(s.doc));
    const g = ok(s.execute('core.makeGroup', { faceIds: listFaces(rootModel(s.doc)).map((f) => f.id) }));
    const r = ok(s.execute('core.explode', { instanceIds: [g.instanceId] }));
    expectValid(s.doc);
    expect(s.doc.scene.definitions.size).toBe(1);
    expect(r.faceIds).toHaveLength(6);
    const after = rootModel(s.doc);
    expect(faceCount(after)).toBe(6);
    expect(edgeCount(after)).toBe(12);
    expect(bounds(after)).toEqual({ min: [100, 0, 200], max: [1100, 300, 700] });
    expect(Object.keys(serialize(after).vertices)).toHaveLength(Object.keys(before.vertices).length);
  });

  test('coplanar faces merge with the parent; edges that meet split', () => {
    const s = createSession();
    ok(s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 2000, depth: 2000 }));
    const sq = ok(s.execute('core.drawRectangle', { faceId: null, corner: [3000, 0, 0], width: 1000, depth: 1000 }));
    const g = ok(s.execute('core.makeGroup', { faceIds: sq.faceIds }));
    // Place the group over the corner of the big square and explode it.
    const placed = putInstance(s.doc.scene, s.doc.scene.rootId, {
      ...findInstance(s.doc.scene, g.instanceId)!.instance,
      transform: translation([1500, 0, 1500]),
    });
    s.load({ ...s.doc, scene: placed });
    ok(s.execute('core.explode', { instanceIds: [g.instanceId] }));
    expectValid(s.doc);
    const root = rootModel(s.doc);
    // Big square minus the overlap, the overlap, and the part of the small square outside.
    expect(faceCount(root)).toBe(3);
    expect(area(root)).toBeCloseTo(4e6 + 1e6 - 0.25e6, 3);
  });

  test('a component turned a quarter explodes onto exact coordinates', () => {
    const s = createSession();
    const c = ok(s.execute('core.makeComponent', { faceIds: box(s, 0, 0, 1000, 500, 300) }));
    const i = findInstance(s.doc.scene, c.instanceId)!.instance;
    const turned = compose(translation([2000, 0, 2000]), rotationAbout([0, 0, 0], [0, 1, 0], Math.PI / 2));
    s.load({ ...s.doc, scene: putInstance(s.doc.scene, s.doc.scene.rootId, { ...i, transform: turned }) });
    ok(s.execute('core.explode', { instanceIds: [c.instanceId] }));
    expectValid(s.doc);
    const root = rootModel(s.doc);
    for (const v of Object.values(serialize(root).vertices)) for (const x of v) expect(Number.isInteger(x)).toBe(true);
    expect(bounds(root)).toEqual({ min: [2000, 0, 1000], max: [2500, 300, 2000] });
  });

  test('nested instances move up with composed transforms; nested groups stay single', () => {
    const s = createSession();
    const inner = ok(s.execute('core.makeGroup', { faceIds: box(s, 100, 0, 100, 100, 100) }));
    const outer = ok(s.execute('core.makeComponent', { faceIds: box(s, 0, 0, 50, 50, 50), instanceIds: [inner.instanceId] }));
    ok(s.execute('core.copyInstances', { instanceIds: [outer.instanceId], translation: [1000, 0, 0] }));
    const before = definitionBounds(s.doc.scene, s.doc.scene.rootId);
    const r = ok(s.execute('core.explode', { instanceIds: [outer.instanceId] }));
    expectValid(s.doc);
    expect(r.instanceIds).toHaveLength(1);
    const moved = findInstance(s.doc.scene, r.instanceIds[0]!)!;
    expect(moved.parent.id).toBe(s.doc.scene.rootId);
    expect(moved.instance.transform.translation).toEqual([100, 0, 0]);
    // The component's other copy still holds the original group; the exploded copy got its own.
    expect(moved.instance.definitionId).not.toBe(inner.definitionId);
    for (const d of s.doc.scene.definitions.values()) if (d.kind === 'group') expect(instanceCount(s.doc.scene, d.id)).toBe(1);
    expect(definitionBounds(s.doc.scene, s.doc.scene.rootId)).toEqual(before);
  });

  test('a missing instance is rejected', () => {
    const r = createSession().execute('core.explode', { instanceIds: ['i42'] });
    expect(r.ok ? '' : r.error.code).toBe('noSuchInstance');
  });
});

describe('copies and make unique', () => {
  test('component copies share the definition; editing it changes them all', () => {
    const s = createSession();
    const c = ok(s.execute('core.makeComponent', { faceIds: box(s, 0, 0, 100, 100, 100) }));
    const copies = ok(s.execute('core.copyInstances', { instanceIds: [c.instanceId], translation: [500, 0, 0] }));
    expect(instanceCount(s.doc.scene, c.definitionId)).toBe(2);
    expect(findInstance(s.doc.scene, copies.instanceIds[0]!)!.instance.transform.translation).toEqual([500, 0, 0]);
    expect(findInstance(s.doc.scene, copies.instanceIds[0]!)!.instance.definitionId).toBe(c.definitionId);
  });

  test('group copies share geometry until one of them is edited', () => {
    const s = createSession();
    const g = ok(s.execute('core.makeGroup', { faceIds: box(s, 0, 0, 100, 100, 100) }));
    const copy = ok(s.execute('core.copyInstances', { instanceIds: [g.instanceId], translation: [500, 0, 0] }));
    const copyDef = findInstance(s.doc.scene, copy.instanceIds[0]!)!.instance.definitionId;
    expect(copyDef).not.toBe(g.definitionId);
    expect(model(s, copyDef)).toBe(model(s, g.definitionId));
    const top = listFaces(model(s, copyDef)).find((f) => f.normal[1] === 1)!;
    ok(s.execute('core.pushPull', { definitionId: copyDef, faceId: top.id, distance: 100 }));
    expect(bounds(model(s, copyDef))!.max[1]).toBe(200);
    expect(bounds(model(s, g.definitionId))!.max[1]).toBe(100);
  });

  test('make unique gives the selected copies one new definition', () => {
    const s = createSession();
    const c = ok(s.execute('core.makeComponent', { faceIds: box(s, 0, 0, 100, 100, 100), name: 'Drawer' }));
    const copies = ok(s.execute('core.copyInstances', { instanceIds: [c.instanceId], translation: [500, 0, 0] }));
    const more = ok(s.execute('core.copyInstances', { instanceIds: [c.instanceId], translation: [1000, 0, 0] }));
    const r = ok(s.execute('core.makeUnique', { instanceIds: [copies.instanceIds[0]!, more.instanceIds[0]!] }));
    expect(r.definitionIds).toHaveLength(1);
    const unique = r.definitionIds[0]!;
    expect(getDefinition(s.doc.scene, unique)!.name).toBe('Drawer#1');
    expect(instanceCount(s.doc.scene, unique)).toBe(2);
    expect(instanceCount(s.doc.scene, c.definitionId)).toBe(1);
    // Editing the unique definition leaves the original alone.
    const top = listFaces(model(s, unique)).find((f) => f.normal[1] === 1)!;
    ok(s.execute('core.pushPull', { definitionId: unique, faceId: top.id, distance: 50 }));
    expect(bounds(model(s, c.definitionId))!.max[1]).toBe(100);
    // Making the only instance unique changes nothing and records no undo step.
    const steps = s.history().length;
    const again = ok(s.execute('core.makeUnique', { instanceIds: [c.instanceId] }));
    expect(again.definitionIds).toEqual([]);
    expect(s.history().length).toBe(steps);
  });
});

describe('rename and erase', () => {
  test('definitions and instances are renamed; the root cannot be', () => {
    const s = createSession();
    const c = ok(s.execute('core.makeComponent', { faceIds: box(s, 0, 0, 100, 100, 100) }));
    ok(s.execute('core.renameDefinition', { definitionId: c.definitionId, name: 'Side panel' }));
    ok(s.execute('core.renameInstance', { instanceId: c.instanceId, name: 'Left' }));
    expect(getDefinition(s.doc.scene, c.definitionId)!.name).toBe('Side panel');
    expect(findInstance(s.doc.scene, c.instanceId)!.instance.name).toBe('Left');
    const root = s.execute('core.renameDefinition', { definitionId: s.doc.scene.rootId, name: 'x' });
    expect(root.ok ? '' : root.error.code).toBe('noSuchDefinition');
    const steps = s.history().length;
    ok(s.execute('core.renameInstance', { instanceId: c.instanceId, name: 'Left ' }));
    expect(s.history().length).toBe(steps);
  });

  test('erasing instances removes definitions nothing uses any more', () => {
    const s = createSession();
    const c = ok(s.execute('core.makeComponent', { faceIds: box(s, 0, 0, 100, 100, 100) }));
    const copy = ok(s.execute('core.copyInstances', { instanceIds: [c.instanceId], translation: [500, 0, 0] }));
    const loose = box(s, 2000, 0, 100, 100, 100);
    ok(s.execute('core.erase', { faceIds: [], edgeIds: [], instanceIds: [c.instanceId] }));
    expect(getDefinition(s.doc.scene, c.definitionId)).toBeDefined();
    ok(s.execute('core.erase', { faceIds: [loose[0]!], edgeIds: [], instanceIds: copy.instanceIds }));
    expect(getDefinition(s.doc.scene, c.definitionId)).toBeUndefined();
    expect(s.doc.scene.definitions.size).toBe(1);
    expect(faceCount(rootModel(s.doc))).toBe(5);
  });
});

describe('saving', () => {
  test('nested groups and components survive a save and load', () => {
    const s = createSession();
    const inner = ok(s.execute('core.makeComponent', { faceIds: box(s, 100, 0, 100, 100, 100), name: 'Knob' }));
    ok(s.execute('core.copyInstances', { instanceIds: [inner.instanceId], translation: [0, 0, 300] }));
    const outer = ok(s.execute('core.makeGroup', { faceIds: box(s, 0, 0, 50, 50, 50), instanceIds: [inner.instanceId] }));
    ok(s.execute('core.renameInstance', { instanceId: outer.instanceId, name: 'Front' }));
    const saved = JSON.parse(JSON.stringify(serializeDocument(s.doc)));
    const loaded = deserializeDocument(saved)!;
    expect(loaded).not.toBeNull();
    expect(serializeDocument(loaded)).toEqual(saved);
    // The knob's copy stays in the root; the group holds the original knob.
    expect(placedInstances(loaded.scene).map((p) => p.path.length)).toEqual([1, 1, 2]);
  });
});

describe('randomized scene commands', () => {
  test.each([1, 2, 3, 4, 5, 6])('seed %i, 40 steps', (seed) => {
    randomSceneRun(seed, 40);
  });
});
