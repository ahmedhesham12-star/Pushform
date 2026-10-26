import { describe, expect, test } from 'vitest';
import { createSession, definitionModel, matchTypedValues, type CommandSession } from '../src/commands';
import { bounds, checkModel, listFaces } from '../src/kernel';
import { findInstance, getDefinition, instanceCount } from '../src/scene';
import { parseTypedValues } from '../src/units';

/* All sizes in mm. */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

function box(s: CommandSession, x: number, z: number, w: number, d: number, h: number, definitionId?: string): string[] {
  const m = () => definitionModel(s.doc, definitionId)!;
  const before = new Set(listFaces(m()).map((f) => f.id));
  const r = ok(s.execute('core.drawRectangle', { definitionId, faceId: null, corner: [x, 0, z], width: w, depth: d }));
  ok(s.execute('core.pushPull', { definitionId, faceId: r.faceIds[0]!, distance: h }));
  return listFaces(m())
    .map((f) => f.id)
    .filter((f) => !before.has(f));
}

/** Type into the measurements box after a command, as the app does. */
function type(s: CommandSession, text: string) {
  const target = s.amendTarget();
  if (!target) throw new Error('nothing to amend');
  const parsed = parseTypedValues(text, 'mm');
  if (!parsed.ok) throw new Error(`could not parse ${text}`);
  const matched = matchTypedValues(target.fields, parsed);
  if (!matched.ok) return matched;
  return s.amend(matched.value);
}

const translationOf = (s: CommandSession, id: string) => findInstance(s.doc.scene, id)!.instance.transform.translation;
const rootInstances = (s: CommandSession) => [...getDefinition(s.doc.scene, s.doc.scene.rootId)!.instances.keys()];

describe('core.move', () => {
  test('a group moves by changing its transform; typing a distance amends it in one step', () => {
    const s = createSession();
    const g = ok(s.execute('core.makeGroup', { faceIds: box(s, 0, 0, 1000, 500, 300) }));
    const model = getDefinition(s.doc.scene, g.definitionId)!.model;
    ok(s.execute('core.move', { instanceIds: [g.instanceId], direction: [1, 0, 0], distance: 400 }));
    expect(translationOf(s, g.instanceId)).toEqual([400, 0, 0]);
    expect(getDefinition(s.doc.scene, g.definitionId)!.model).toBe(model);
    const steps = s.history().length;
    expect(type(s, '1000mm').ok).toBe(true);
    expect(translationOf(s, g.instanceId)).toEqual([1000, 0, 0]);
    expect(s.history().length).toBe(steps);
    s.undo();
    expect(translationOf(s, g.instanceId)).toEqual([0, 0, 0]);
  });

  test('loose geometry and an instance move together', () => {
    const s = createSession();
    const g = ok(s.execute('core.makeGroup', { faceIds: box(s, 0, 0, 500, 500, 500) }));
    const loose = box(s, 2000, 0, 500, 500, 500);
    const r = ok(s.execute('core.move', { faceIds: loose, instanceIds: [g.instanceId], direction: [0, 0, 1], distance: 1000 }));
    expect(r.instanceIds).toEqual([g.instanceId]);
    expect(r.faceIds.sort()).toEqual([...loose].sort());
    expect(translationOf(s, g.instanceId)).toEqual([0, 0, 1000]);
    expect(bounds(definitionModel(s.doc)!)).toEqual({ min: [2000, 0, 1000], max: [2500, 500, 1500] });
  });

  test('inside a group, its geometry moves in its own coordinates', () => {
    const s = createSession();
    const g = ok(s.execute('core.makeGroup', { faceIds: box(s, 1000, 0, 1000, 1000, 500) }));
    const top = listFaces(definitionModel(s.doc, g.definitionId)!).find((f) => f.normal[1] === 1)!;
    ok(s.execute('core.move', { definitionId: g.definitionId, faceIds: [top.id], direction: [0, 1, 0], distance: 250 }));
    expect(bounds(definitionModel(s.doc, g.definitionId)!)).toEqual({ min: [0, 0, 0], max: [1000, 750, 1000] });
    expect(listFaces(definitionModel(s.doc)!)).toHaveLength(0);
  });

  test('a move that would bend a face is refused and records nothing', () => {
    const s = createSession();
    box(s, 0, 0, 1000, 1000, 500);
    const m = definitionModel(s.doc)!;
    const top = listFaces(m).find((f) => f.normal[1] === 1)!;
    const steps = s.history().length;
    const r = s.execute('core.move', { faceIds: [top.id], direction: [0, -1, 0], distance: 900 });
    expect(r.ok ? '' : r.error.code).toBe('moveCrosses');
    expect(s.history().length).toBe(steps);
  });

  test('nothing selected is rejected', () => {
    const s = createSession();
    const r = s.execute('core.move', { faceIds: ['nope'], direction: [1, 0, 0], distance: 100 });
    expect(r.ok ? '' : r.error.code).toBe('nothingSelected');
  });
});

describe('core.moveCopies', () => {
  test('one copy, then x5 makes an array of five, then /4 divides the distance', () => {
    const s = createSession();
    const c = ok(s.execute('core.makeComponent', { faceIds: box(s, 0, 0, 100, 100, 100) }));
    ok(s.execute('core.moveCopies', { instanceIds: [c.instanceId], direction: [1, 0, 0], distance: 400, copies: 1, divide: false }));
    expect(instanceCount(s.doc.scene, c.definitionId)).toBe(2);
    const steps = s.history().length;

    expect(type(s, 'x5').ok).toBe(true);
    expect(instanceCount(s.doc.scene, c.definitionId)).toBe(6);
    const xs = rootInstances(s).map((id) => translationOf(s, id)[0]).sort((a, b) => a - b);
    expect(xs).toEqual([0, 400, 800, 1200, 1600, 2000]);

    expect(type(s, '/4').ok).toBe(true);
    const divided = rootInstances(s).map((id) => translationOf(s, id)[0]).sort((a, b) => a - b);
    expect(divided).toEqual([0, 100, 200, 300, 400]);

    // A distance typed now changes the span and keeps the division.
    expect(type(s, '800').ok).toBe(true);
    expect(rootInstances(s).map((id) => translationOf(s, id)[0]).sort((a, b) => a - b)).toEqual([0, 200, 400, 600, 800]);
    expect(s.history().length).toBe(steps);
    expect(s.amendTarget()?.input.divide).toBe(true);
    s.undo();
    expect(instanceCount(s.doc.scene, c.definitionId)).toBe(1);
  });

  test('5x and *5 mean the same as x5', () => {
    for (const text of ['5x', '*5']) {
      const s = createSession();
      const c = ok(s.execute('core.makeComponent', { faceIds: box(s, 0, 0, 100, 100, 100) }));
      ok(s.execute('core.moveCopies', { instanceIds: [c.instanceId], direction: [0, 0, 1], distance: 300, copies: 1, divide: false }));
      expect(type(s, text).ok).toBe(true);
      expect(instanceCount(s.doc.scene, c.definitionId)).toBe(6);
    }
  });

  test('an array typed after a plain move does not fit', () => {
    const s = createSession();
    const g = ok(s.execute('core.makeGroup', { faceIds: box(s, 0, 0, 100, 100, 100) }));
    ok(s.execute('core.move', { instanceIds: [g.instanceId], direction: [1, 0, 0], distance: 300 }));
    const r = type(s, 'x5');
    expect(r.ok ? '' : r.error.code).toBe('amendValueCount');
  });

  test('copies of loose geometry are separate boxes; group copies get their own definitions', () => {
    const s = createSession();
    const faces = box(s, 0, 0, 500, 500, 500);
    const g = ok(s.execute('core.makeGroup', { faceIds: box(s, 0, 2000, 500, 500, 500) }));
    const r = ok(s.execute('core.moveCopies', { faceIds: faces, instanceIds: [g.instanceId], direction: [1, 0, 0], distance: 1000, copies: 3, divide: false }));
    const m = definitionModel(s.doc)!;
    expect(checkModel(m)).toEqual([]);
    expect(listFaces(m)).toHaveLength(24);
    expect(bounds(m)).toEqual({ min: [0, 0, 0], max: [3500, 500, 500] });
    expect(r.faceIds).toHaveLength(18);
    expect(r.instanceIds).toHaveLength(3);
    const defs = r.instanceIds.map((id) => findInstance(s.doc.scene, id)!.instance.definitionId);
    expect(new Set([...defs, g.definitionId]).size).toBe(4);
  });

  test('copies touching each other merge where they meet', () => {
    const s = createSession();
    const faces = box(s, 0, 0, 500, 500, 500);
    ok(s.execute('core.moveCopies', { faceIds: faces, direction: [1, 0, 0], distance: 500, copies: 2, divide: false }));
    const m = definitionModel(s.doc)!;
    expect(checkModel(m)).toEqual([]);
    expect(bounds(m)).toEqual({ min: [0, 0, 0], max: [1500, 500, 500] });
  });
});
