import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  createSession,
  deserializeDocument,
  HISTORY_LIMIT,
  newDocument,
  serializeDocument,
  type CommandDef,
  type CommandSession,
} from '../src/commands';
import { faceCount, getFace, serialize } from '../src/kernel';

function boxSession(): { s: CommandSession; top: string } {
  const s = createSession();
  const r = s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 3000, depth: 2000 });
  if (!r.ok) throw new Error('draw failed');
  const top = r.output.faceId;
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
    s.execute('core.deleteFace', { faceId: top });
    s.undo();
    s.redo();
    off();
    s.undo();
    expect(events).toEqual(['execute:core.deleteFace', 'undo:core.deleteFace', 'redo:core.deleteFace']);
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
    expect(r).toEqual({ ok: true, output: { distance: 0 }, changed: false });
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
    expect(s.execute('core.deleteFace', { faceId: 'f1' })).toMatchObject({ ok: false, error: { code: 'noSuchFace' } });
  });

  test('kernel errors become command errors', () => {
    const { s, top } = boxSession();
    const r = s.execute('core.drawRectangle', { faceId: top, corner: [2500, 1000, 500], width: 1000, depth: 500 });
    expect(r).toMatchObject({ ok: false, error: { code: 'outsideFace' } });
    expect(s.execute('core.setDisplayUnits', { unit: 'ft-in', precision: 10 })).toMatchObject({
      ok: false,
      error: { code: 'invalidPrecision' },
    });
  });
});

describe('plugins', () => {
  test('can register a namespaced command that runs through the same history', () => {
    const s = createSession();
    const def: CommandDef<{ size: number }, { faceId: string }> = {
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
    expect(deserializeDocument({ ...good, version: 2 })).toBeNull();
    expect(deserializeDocument({ ...good, units: { unit: 'km', precision: 2 } })).toBeNull();
    expect(deserializeDocument({ ...good, units: { unit: 'mm', precision: 16 } })).toBeNull();
    expect(deserializeDocument({ faces: {}, next: 1 })).toBeNull();
  });
});
