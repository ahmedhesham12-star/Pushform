import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  createSession,
  deserializeDocument,
  HISTORY_LIMIT,
  matchTypedValues,
  newDocument,
  serializeDocument,
  type CommandDef,
  type CommandSession,
} from '../src/commands';
import {
  checkModel,
  drawRectangle,
  faceArea,
  faceCount,
  getFace,
  hasFace,
  listEdges,
  listFaces,
  serialize,
} from '../src/kernel';
import { parseLengthList, parseTypedValues } from '../src/units';

function boxSession(): { s: CommandSession; top: string } {
  const s = createSession();
  const r = s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 3000, depth: 2000 });
  if (!r.ok) throw new Error('draw failed');
  const top = r.output.faceIds[0]!;
  s.execute('core.pushPull', { faceId: top, distance: 1000 });
  return { s, top };
}

const snapshot = (s: CommandSession) => JSON.stringify(serializeDocument(s.doc));

describe('undo and redo through commands', () => {
  test('each command is one undo step', () => {
    const { s, top } = boxSession();
    expect(faceCount(s.doc.model)).toBe(6);
    expect(s.history().map((h) => h.commandId)).toEqual(['core.drawRectangle', 'core.pushPull']);

    expect(s.undo()).toBe(true);
    expect(faceCount(s.doc.model)).toBe(1);
    expect(s.undo()).toBe(true);
    expect(faceCount(s.doc.model)).toBe(0);
    expect(s.undo()).toBe(false);
    expect(s.canUndo).toBe(false);

    expect(s.redo()).toBe(true);
    expect(s.redo()).toBe(true);
    expect(s.redo()).toBe(false);
    expect(faceCount(s.doc.model)).toBe(6);
    expect(getFace(s.doc.model, top)!.outer[0]![1]).toBe(1000);
  });

  test('undo then redo restores the exact document', () => {
    const { s, top } = boxSession();
    s.execute('core.pushPull', { faceId: top, distance: 250 });
    const after = snapshot(s);
    s.undo();
    expect(snapshot(s)).not.toBe(after);
    s.redo();
    expect(snapshot(s)).toBe(after);
  });

  test('a new command clears the redo stack', () => {
    const { s, top } = boxSession();
    s.undo();
    expect(s.canRedo).toBe(true);
    s.execute('core.pushPull', { faceId: top, distance: 500 });
    expect(s.canRedo).toBe(false);
  });

  test('unit changes are undoable too', () => {
    const s = createSession();
    s.execute('core.setDisplayUnits', { unit: 'ft-in', precision: 16 });
    expect(s.doc.units).toEqual({ unit: 'ft-in', precision: 16 });
    s.undo();
    expect(s.doc.units).toEqual({ unit: 'm', precision: 2 });
  });

  test('history is capped', () => {
    const { s, top } = boxSession();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s.execute('core.pushPull', { faceId: top, distance: i % 2 ? -10 : 10 });
    expect(s.history()).toHaveLength(HISTORY_LIMIT);
  });

  test('change events are emitted for execute, undo and redo', () => {
    const { s, top } = boxSession();
    const events: string[] = [];
    const off = s.subscribe((e) => events.push(`${e.reason}:${e.commandId}`));
    s.execute('core.erase', { faceIds: [top], edgeIds: [] });
    s.undo();
    s.redo();
    off();
    s.undo();
    expect(events).toEqual(['execute:core.erase', 'undo:core.erase', 'redo:core.erase']);
  });
});

describe('no-op commands record nothing', () => {
  test.each([
    ['clearing an empty model', (s: CommandSession) => s.execute('core.clearModel', {})],
    ['setting the same units', (s: CommandSession) => s.execute('core.setDisplayUnits', { unit: 'm', precision: 2 })],
  ])('%s', (_, run) => {
    const s = createSession();
    const r = run(s);
    expect(r).toMatchObject({ ok: true, changed: false });
    expect(s.canUndo).toBe(false);
  });

  test('a fully clamped push', () => {
    const { s, top } = boxSession();
    s.execute('core.pushPull', { faceId: top, distance: -999 });
    const before = s.history().length;
    const r = s.execute('core.pushPull', { faceId: top, distance: -50 });
    expect(r).toEqual({ ok: true, output: { distance: 0, createdFaceIds: [], removedFaceIds: [] }, changed: false });
    expect(s.history()).toHaveLength(before);
  });
});

describe('preview', () => {
  test('returns the result without committing or recording history', () => {
    const { s, top } = boxSession();
    const before = snapshot(s);
    const p = s.preview('core.pushPull', { faceId: top, distance: 400 });
    expect(p.ok && p.output.distance).toBe(400);
    expect(p.ok && getFace(p.doc.model, top)!.outer[0]![1]).toBe(1400);
    expect(snapshot(s)).toBe(before);
    expect(s.history()).toHaveLength(2);
  });
});

describe('face ids in command output', () => {
  test('drawRectangle returns every face it creates, including pieces of faces it overlaps', () => {
    const s = createSession();
    s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 2000, depth: 2000 });
    const r = s.execute('core.drawRectangle', { faceId: null, corner: [1000, 0, 1000], width: 2000, depth: 2000 });
    expect(r.ok && r.output.faceIds).toHaveLength(2);
    expect(faceCount(s.doc.model)).toBe(3);
  });

  test('pushPull returns its walls and the bottom a lone face leaves behind', () => {
    const s = createSession();
    const d = s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 2000, depth: 2000 });
    const id = d.ok ? d.output.faceIds[0]! : '';
    const r = s.execute('core.pushPull', { faceId: id, distance: 500 });
    expect(r.ok && r.output.createdFaceIds).toHaveLength(5);
    if (r.ok) for (const f of r.output.createdFaceIds) expect(hasFace(s.doc.model, f)).toBe(true);
  });

  test('erase merges coplanar faces and reports the faces that are gone', () => {
    const s = createSession();
    s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 2000, depth: 2000 });
    s.execute('core.drawRectangle', { faceId: null, corner: [2000, 0, 0], width: 1000, depth: 2000 });
    const shared = listEdges(s.doc.model).find((e) => e.a[0] === 2000 && e.b[0] === 2000)!;
    const r = s.execute('core.erase', { faceIds: [], edgeIds: [shared.id] });
    expect(r.ok && r.output.removedFaceIds).toHaveLength(1);
    expect(faceCount(s.doc.model)).toBe(1);
    s.undo();
    expect(faceCount(s.doc.model)).toBe(2);
  });
});

describe('core.drawLine', () => {
  const seg = (s: CommandSession, start: [number, number, number], direction: [number, number, number], length: number) =>
    s.execute('core.drawLine', { start, direction, length });

  test('each segment is one undo step, and closing a loop returns the new face', () => {
    const s = createSession();
    seg(s, [0, 0, 0], [1, 0, 0], 2000);
    seg(s, [2000, 0, 0], [0, 0, 1], 1000);
    seg(s, [2000, 0, 1000], [-1, 0, 0], 2000);
    const last = seg(s, [0, 0, 1000], [0, 0, -1], 1000);
    expect(last.ok && last.output.faceIds).toHaveLength(1);
    expect(s.history().map((h) => h.commandId)).toEqual(Array(4).fill('core.drawLine'));
    s.undo();
    expect(faceCount(s.doc.model)).toBe(0);
    expect(listEdges(s.doc.model)).toHaveLength(3);
  });

  test('typing a length amends the segment just drawn, along the same direction', () => {
    const s = createSession();
    seg(s, [0, 0, 0], [3, 0, 4], 1000);
    const typed = parseTypedValues('2\' 0"', s.doc.units.unit);
    const m = typed.ok ? matchTypedValues(s.amendTarget()!.fields, typed) : null;
    expect(m?.ok && s.amend(m.value)).toMatchObject({ ok: true });
    const [e] = listEdges(s.doc.model);
    const len = Math.hypot(e!.b[0] - e!.a[0], e!.b[1] - e!.a[1], e!.b[2] - e!.a[2]);
    expect(len).toBeCloseTo(609.6, 6);
    expect(s.history()).toHaveLength(1);
  });

  test('a zero direction or zero length is rejected', () => {
    const s = createSession();
    expect(seg(s, [0, 0, 0], [0, 0, 0], 1000)).toMatchObject({ ok: false, error: { code: 'invalidInput' } });
    expect(seg(s, [0, 0, 0], [1, 0, 0], 0)).toMatchObject({ ok: false, error: { code: 'tooSmall' } });
  });
});

describe('loading milestone 1 documents', () => {
  test('a version 1 autosave loads as a version 2 document with the same faces and units', () => {
    const v1 = JSON.parse(readFileSync(join(__dirname, 'fixtures/milestone1-autosave.json'), 'utf8'));
    expect(v1.version).toBe(1);
    const doc = deserializeDocument(v1)!;
    expect(doc).not.toBeNull();
    expect(doc.units).toEqual({ unit: 'ft-in', precision: 16 });
    expect(checkModel(doc.model)).toEqual([]);
    expect(listFaces(doc.model).map((f) => f.id).sort()).toEqual(Object.keys(v1.model.faces).sort());
    const saved = serializeDocument(doc);
    expect(saved.version).toBe(2);
    expect(saved.model.kind).toBe('topology');
    expect(serializeDocument(deserializeDocument(JSON.parse(JSON.stringify(saved)))!)).toEqual(saved);
  });

  test('a converted document keeps working with commands', () => {
    const v1 = JSON.parse(readFileSync(join(__dirname, 'fixtures/milestone1-autosave.json'), 'utf8'));
    const s = createSession(deserializeDocument(v1)!);
    const top = listFaces(s.doc.model).find((f) => f.normal[1] === 1 && f.holes.length === 1)!;
    expect(s.execute('core.pushPull', { faceId: top.id, distance: 100 })).toMatchObject({ ok: true, changed: true });
    expect(checkModel(s.doc.model)).toEqual([]);
  });
});

describe('validation and errors', () => {
  test('untrusted JSON input is validated', () => {
    const s = createSession();
    const bad = [
      { faceId: null, corner: [0, 0], width: 1000, depth: 1000 },
      { faceId: null, corner: [0, 0, 0], width: '1000', depth: 1000 },
      { faceId: null, corner: [0, 0, 0], width: 1000, depth: 1000, extra: true },
      { corner: [0, 0, 0], width: 1000, depth: 1000 },
      { faceId: null, corner: [0, 0, 0], width: Infinity, depth: 1000 },
    ];
    for (const input of bad) {
      const r = s.executeUnchecked('core.drawRectangle', input);
      expect(r.ok, JSON.stringify(input)).toBe(false);
      expect(!r.ok && r.error.code).toBe('invalidInput');
    }
    expect(s.canUndo).toBe(false);
  });

  test('JSON input round-trips through executeUnchecked', () => {
    const s = createSession();
    const input = JSON.parse('{"faceId":null,"corner":[0,0,0],"width":600,"depth":400}');
    expect(s.executeUnchecked('core.drawRectangle', input)).toMatchObject({ ok: true, changed: true });
    expect(s.history()[0]!.input).toEqual(input);
  });

  test('unknown commands and missing faces are reported by code', () => {
    const s = createSession();
    expect(s.executeUnchecked('core.nope', {})).toMatchObject({ ok: false, error: { code: 'unknownCommand' } });
    expect(s.execute('core.pushPull', { faceId: 'f1', distance: 10 })).toMatchObject({
      ok: false,
      error: { code: 'noSuchFace' },
    });
    expect(s.execute('core.erase', { faceIds: ['f1'], edgeIds: [] })).toMatchObject({ ok: false, error: { code: 'nothingToErase' } });
  });

  test('kernel errors become command errors', () => {
    const { s, top } = boxSession();
    expect(s.execute('core.drawRectangle', { faceId: top, corner: [500, 1000, 500], width: 2, depth: 500 })).toMatchObject({
      ok: false,
      error: { code: 'tooSmall' },
    });
    expect(s.execute('core.drawRectangle', { faceId: top, corner: [500, 400, 500], width: 500, depth: 500 })).toMatchObject({
      ok: false,
      error: { code: 'notOnPlane' },
    });
    expect(s.execute('core.setDisplayUnits', { unit: 'ft-in', precision: 10 })).toMatchObject({
      ok: false,
      error: { code: 'invalidPrecision' },
    });
  });
});

describe('amend last operation', () => {
  const area = (s: CommandSession, id: string) => faceArea(s.doc.model, id);

  test('typed values replace the size of the rectangle just drawn', () => {
    const s = createSession();
    const r = s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 3000, depth: 2000 });
    const id = r.ok ? r.output.faceIds[0]! : '';
    expect(s.amendTarget()).toMatchObject({ commandId: 'core.drawRectangle', values: [3000, 2000] });

    const a = s.amend([600, 400]);
    expect(a).toMatchObject({ ok: true, changed: true, output: { faceIds: [id] } });
    expect(faceCount(s.doc.model)).toBe(1);
    expect(area(s, id)).toBeCloseTo(600 * 400, 6);
    expect(s.history()).toHaveLength(1);
    expect(s.history()[0]!.input).toMatchObject({ width: 600, depth: 400 });
  });

  test('a rectangle keeps the direction it was drawn in', () => {
    const s = createSession();
    s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: -3000, depth: 2000 });
    s.amend([600, 400]);
    expect(s.history()[0]!.input).toMatchObject({ width: -600, depth: 400 });
  });

  test('typed values in either unit system work through parseLengthList', () => {
    const s = createSession();
    s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 3000, depth: 2000 });
    const typed = parseLengthList('2\' 0", 600mm', s.doc.units.unit);
    expect(typed.ok && s.amend(typed.mm).ok).toBe(true);
    expect(s.history()[0]!.input).toMatchObject({ width: 609.6, depth: 600 });
  });

  test('typed distance replaces the push/pull just done, from the state before it', () => {
    const { s, top } = boxSession();
    expect(s.amendTarget()).toMatchObject({ commandId: 'core.pushPull', values: [1000] });
    expect(s.amend([500])).toMatchObject({ ok: true, output: { distance: 500 } });
    expect(faceCount(s.doc.model)).toBe(6);
    expect(getFace(s.doc.model, top)!.outer[0]![1]).toBe(500);
    expect(s.history()).toHaveLength(2);
  });

  test('a negative typed distance reverses the push/pull', () => {
    const { s, top } = boxSession();
    s.amend([-300]);
    expect(getFace(s.doc.model, top)!.outer[0]![1]).toBe(-300);
    expect(faceCount(s.doc.model)).toBe(6);
  });

  test('amending again keeps replacing the same step', () => {
    const { s, top } = boxSession();
    s.amend([500]);
    s.amend([750]);
    expect(getFace(s.doc.model, top)!.outer[0]![1]).toBe(750);
    expect(s.history()).toHaveLength(2);
  });

  test('one undo after amending returns to the state before the command', () => {
    const { s, top } = boxSession();
    s.amend([500]);
    expect(s.undo()).toBe(true);
    expect(faceCount(s.doc.model)).toBe(1);
    expect(s.redo()).toBe(true);
    expect(getFace(s.doc.model, top)!.outer[0]![1]).toBe(500);
    expect(s.undo()).toBe(true);
    expect(s.undo()).toBe(true);
    expect(faceCount(s.doc.model)).toBe(0);
  });

  test('is cleared by running another command', () => {
    const { s, top } = boxSession();
    s.execute('core.setDisplayUnits', { unit: 'mm', precision: 0 });
    expect(s.canAmend).toBe(false);
    expect(s.amend([500])).toMatchObject({ ok: false, error: { code: 'nothingToAmend' } });
    expect(getFace(s.doc.model, top)!.outer[0]![1]).toBe(1000);
  });

  test('is cleared by a failed command, undo, and clearAmend', () => {
    const a = boxSession();
    a.s.execute('core.erase', { faceIds: ['nope'], edgeIds: [] });
    expect(a.s.canAmend).toBe(false);

    const b = boxSession();
    b.s.undo();
    expect(b.s.canAmend).toBe(false);
    b.s.redo();
    expect(b.s.canAmend).toBe(false);

    const c = boxSession();
    c.s.clearAmend();
    expect(c.s.canAmend).toBe(false);
  });

  test('commands without amendable inputs cannot be amended', () => {
    const { s, top } = boxSession();
    s.execute('core.erase', { faceIds: [top], edgeIds: [] });
    expect(s.canAmend).toBe(false);
  });

  test('bad values are rejected and the original result is kept', () => {
    const { s, top } = boxSession();
    expect(s.amend([500, 200])).toMatchObject({ ok: false, error: { code: 'amendValueCount' } });
    expect(s.amend([0])).toMatchObject({ ok: false, error: { code: 'amendValueInvalid' } });
    expect(getFace(s.doc.model, top)!.outer[0]![1]).toBe(1000);
    expect(s.canAmend).toBe(true);

    const r = createSession();
    r.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 3000, depth: 2000 });
    expect(r.amend([-600, 400])).toMatchObject({ ok: false, error: { code: 'amendValueInvalid' } });
    expect(r.amend([2, 400])).toMatchObject({ ok: false, error: { code: 'tooSmall' } });
    expect(r.history()[0]!.input).toMatchObject({ width: 3000, depth: 2000 });
  });

  test('emits an amend change event', () => {
    const { s } = boxSession();
    const events: string[] = [];
    s.subscribe((e) => events.push(`${e.reason}:${e.commandId}`));
    s.amend([500]);
    expect(events).toEqual(['amend:core.pushPull']);
  });

  test('plugin commands become amendable by declaring their fields', () => {
    const s = createSession();
    const def: CommandDef<{ size: number }, { faceId: string }> = {
      id: 'example.square',
      title: () => 'Square',
      input: z.strictObject({ size: z.number().positive() }),
      amendable: [{ key: 'size', mode: 'positive' }],
      run(doc, input) {
        const r = drawRectangle(doc.model, { faceId: null, corner: [0, 0, 0], width: input.size, depth: input.size });
        return r.ok ? { ok: true, doc: { ...doc, model: r.model }, output: { faceId: r.faceIds[0]! } } : { ok: false, error: { code: r.error } };
      },
    };
    s.registry.register(def);
    const r = s.executeUnchecked('example.square', { size: 500 }) as { ok: true; output: { faceId: string } };
    s.amend([800]);
    expect(faceArea(s.doc.model, r.output.faceId)).toBeCloseTo(640000, 6);
    expect(s.history()).toHaveLength(1);
  });
});

describe('amending counts', () => {
  /** A row of `copies` squares of side `size`: one length field and one count field. */
  function rowSession() {
    const s = createSession();
    const def: CommandDef<{ size: number; copies: number }, Record<string, never>> = {
      id: 'example.row',
      title: () => 'Row',
      input: z.strictObject({ size: z.number().positive(), copies: z.number().int().min(1) }),
      amendable: [
        { key: 'size', mode: 'positive' },
        { key: 'copies', mode: 'positive', kind: 'count' },
      ],
      amendHint: () => 'Type a size, or a count like 3s.',
      run(doc, input) {
        let model = doc.model;
        for (let i = 0; i < input.copies; i++) {
          const r = drawRectangle(model, { faceId: null, corner: [i * input.size * 2, 0, 0], width: input.size, depth: input.size });
          if (!r.ok) return { ok: false, error: { code: r.error } };
          model = r.model;
        }
        return { ok: true, doc: { ...doc, model }, output: {} };
      },
    };
    s.registry.register(def);
    s.executeUnchecked('example.row', { size: 500, copies: 2 });
    return s;
  }
  const amendTyped = (s: CommandSession, text: string) => {
    const typed = parseTypedValues(text, s.doc.units.unit);
    if (!typed.ok) throw new Error(text);
    const m = matchTypedValues(s.amendTarget()!.fields, typed);
    return m.ok ? s.amend(m.value) : m;
  };

  test('a typed count changes only the count field', () => {
    const s = rowSession();
    expect(amendTyped(s, '3s')).toMatchObject({ ok: true });
    expect(faceCount(s.doc.model)).toBe(3);
    expect(s.history()[0]!.input).toEqual({ size: 500, copies: 3 });
    expect(s.history()).toHaveLength(1);
  });

  test('a typed length changes only the length field', () => {
    const s = rowSession();
    amendTyped(s, '800mm');
    expect(s.history()[0]!.input).toEqual({ size: 800, copies: 2 });
  });

  test('a length and a count together, in either order', () => {
    const s = rowSession();
    amendTyped(s, '4s, 300mm');
    expect(s.history()[0]!.input).toEqual({ size: 300, copies: 4 });
    expect(faceCount(s.doc.model)).toBe(4);
    s.undo();
    expect(faceCount(s.doc.model)).toBe(0);
  });

  test('the amend target shows counts as counts', () => {
    const s = rowSession();
    expect(s.amendTarget()).toMatchObject({ values: [500, 2] });
    expect(s.amendTarget()!.fields[1]).toMatchObject({ kind: 'count' });
  });

  test('wrong numbers of values, fractional counts and unknown keys are rejected', () => {
    const s = rowSession();
    expect(amendTyped(s, '1s, 2s')).toMatchObject({ ok: false, error: { code: 'amendValueCount' } });
    expect(amendTyped(s, '1m, 2m')).toMatchObject({ ok: false, error: { code: 'amendValueCount' } });
    expect(s.amend({ copies: 2.5 })).toMatchObject({ ok: false, error: { code: 'amendValueInvalid' } });
    expect(s.amend({ width: 3 })).toMatchObject({ ok: false, error: { code: 'amendValueCount' } });
    expect(s.amend({ copies: 0 })).toMatchObject({ ok: false, error: { code: 'amendValueInvalid' } });
    expect(s.history()[0]!.input).toEqual({ size: 500, copies: 2 });
  });

  test('a count typed for a command without count fields is rejected', () => {
    const s = createSession();
    s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 1000, depth: 1000 });
    expect(amendTyped(s, '4s')).toMatchObject({ ok: false, error: { code: 'amendValueCount' } });
  });
});

describe('plugins', () => {
  test('can register a namespaced command that runs through the same history', () => {
    const s = createSession();
    const def: CommandDef<{ size: number }, { faceIds: string[] }> = {
      id: 'example.square',
      title: () => 'Square',
      input: z.strictObject({ size: z.number().positive() }),
      run(_doc, input) {
        const p = s.preview('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: input.size, depth: input.size });
        return p.ok ? { ok: true, doc: p.doc, output: p.output } : p;
      },
    };
    s.registry.register(def);
    expect(s.executeUnchecked('example.square', { size: 500 })).toMatchObject({ ok: true, changed: true });
    expect(faceCount(s.doc.model)).toBe(1);
    s.undo();
    expect(faceCount(s.doc.model)).toBe(0);
  });

  test('rejects duplicate and unnamespaced ids', () => {
    const s = createSession();
    const base = { title: () => '', input: z.strictObject({}), run: (doc: never) => ({ ok: true as const, doc, output: {} }) };
    expect(() => s.registry.register({ ...base, id: 'core.pushPull' })).toThrow(/already registered/);
    expect(() => s.registry.register({ ...base, id: 'square' })).toThrow(/namespaced/);
  });
});

describe('document serialization', () => {
  test('round-trips geometry and units', () => {
    const { s } = boxSession();
    s.execute('core.setDisplayUnits', { unit: 'in-frac', precision: 32 });
    const json = JSON.parse(JSON.stringify(serializeDocument(s.doc)));
    const back = deserializeDocument(json)!;
    expect(back.units).toEqual({ unit: 'in-frac', precision: 32 });
    expect(serialize(back.model)).toEqual(serialize(s.doc.model));
  });

  test('rejects other formats and bad settings', () => {
    const good = serializeDocument(newDocument());
    expect(deserializeDocument(good)).not.toBeNull();
    expect(deserializeDocument({ ...good, format: 'other' })).toBeNull();
    expect(deserializeDocument({ ...good, version: 3 })).toBeNull();
    expect(deserializeDocument({ ...good, units: { unit: 'km', precision: 2 } })).toBeNull();
    expect(deserializeDocument({ ...good, units: { unit: 'mm', precision: 16 } })).toBeNull();
    expect(deserializeDocument({ faces: {}, next: 1 })).toBeNull();
  });
});
