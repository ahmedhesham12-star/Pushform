import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  createSession,
  deserializeDocument,
  documentFromText,
  documentToText,
  newDocument,
  serializeDocument,
  showsWoodworking,
  STARTER_MATERIALS,
  starterName,
  WORKSPACE_STARTERS,
  WORKSPACES,
  workspaceUnits,
  type PushformDocument,
} from '../src/commands';

/* Workspaces (milestone 6, step 1): defaults per workspace, switching, and files from before workspaces. */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

/** The document as a version 5 file would have held it: no workspace field. */
function asVersion5(doc: PushformDocument): unknown {
  const { workspace: _w, ...rest } = JSON.parse(JSON.stringify(serializeDocument(doc)));
  return { ...rest, version: 5 };
}

describe('new documents', () => {
  test('take their units from the workspace; architecture uses feet and inches where buildings are measured so', () => {
    expect(newDocument('woodworking').units).toEqual({ unit: 'mm', precision: 0 });
    expect(newDocument('general').units).toEqual({ unit: 'mm', precision: 0 });
    expect(newDocument('architecture', 'US').units).toEqual({ unit: 'ft-in', precision: 16 });
    expect(newDocument('architecture', 'lr').units).toEqual({ unit: 'ft-in', precision: 16 });
    expect(newDocument('architecture', 'GB').units).toEqual({ unit: 'm', precision: 2 });
    expect(newDocument('architecture', 'EG').units).toEqual({ unit: 'm', precision: 2 });
    expect(newDocument('architecture').units).toEqual({ unit: 'm', precision: 2 });
    expect(workspaceUnits('woodworking', 'US')).toEqual({ unit: 'mm', precision: 0 });
    expect(newDocument().workspace).toBe('general');
    for (const w of WORKSPACES) expect(newDocument(w).workspace).toBe(w);
  });

  test('each workspace offers its own starter set, which can be added', () => {
    const names = new Set<string>();
    for (const w of WORKSPACES) {
      const s = createSession(newDocument(w));
      for (const key of WORKSPACE_STARTERS[w]) {
        expect(STARTER_MATERIALS[key], key).toBeDefined();
        expect(names.has(starterName(key)), key).toBe(false);
        names.add(starterName(key));
        const id = ok(s.execute('core.addMaterial', { starter: key })).materialId;
        expect(s.doc.scene.materials.get(id)!.name).toBe(starterName(key));
      }
    }
    // Woodworking: sheet goods and solid wood with stock; the others are paint only.
    expect(WORKSPACE_STARTERS.woodworking.filter((k) => STARTER_MATERIALS[k]!.stock)).toEqual(['birchPly', 'oak', 'walnut', 'whiteMdf', 'whiteMelamine']);
    expect([...WORKSPACE_STARTERS.architecture, ...WORKSPACE_STARTERS.general].some((k) => STARTER_MATERIALS[k]!.stock)).toBe(false);
    expect(WORKSPACE_STARTERS.architecture.map(starterName)).toEqual([
      'Concrete',
      'Brick',
      'Plaster',
      'Glass',
      'Ceramic tile',
      'Wood flooring',
      'Wall paint, white',
      'Wall paint, greige',
      'Wall paint, blue',
    ]);
    expect(WORKSPACE_STARTERS.general.map(starterName)).toEqual(['White', 'Light grey', 'Dark grey', 'Black', 'Wood']);
    expect(WORKSPACES.filter(showsWoodworking)).toEqual(['woodworking']);
  });
});

describe('switching workspace', () => {
  test('changes only the workspace: units, materials, stock and cut list settings stay; undo switches back', () => {
    const s = createSession(newDocument('woodworking'));
    const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    ok(s.execute('core.setCutListSettings', { waste: 0.2, currency: 'EUR' }));
    ok(s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 600, depth: 400 }));
    const before = s.doc;
    const r = s.execute('core.setWorkspace', { workspace: 'architecture' });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(s.doc.workspace).toBe('architecture');
    expect(s.doc.scene).toBe(before.scene);
    expect(s.doc.units).toBe(before.units);
    expect(s.doc.cutList).toBe(before.cutList);
    expect(s.doc.scene.materials.get(oak)!.stock).toEqual(STARTER_MATERIALS.oak!.stock);
    // Back to Woodworking: everything is still there.
    ok(s.execute('core.setWorkspace', { workspace: 'woodworking' }));
    expect(serializeDocument(s.doc)).toEqual(serializeDocument(before));
    s.undo();
    expect(s.doc.workspace).toBe('architecture');
    s.undo();
    expect(s.doc).toBe(before);
  });

  test('choosing the same workspace changes nothing; an unknown one is refused', () => {
    const s = createSession(newDocument('general'));
    expect(s.execute('core.setWorkspace', { workspace: 'general' })).toMatchObject({ ok: true, changed: false });
    expect(s.execute('core.setWorkspace', { workspace: 'kitchen' } as never)).toMatchObject({ ok: false });
    expect(s.canUndo).toBe(false);
  });
});

describe('files', () => {
  test('the workspace is saved and comes back', () => {
    for (const w of WORKSPACES) {
      const doc = newDocument(w, 'US');
      const text = documentToText(doc);
      expect(JSON.parse(text)).toMatchObject({ version: 6, workspace: w });
      expect(documentFromText(text)).toEqual(doc);
    }
  });

  test('files from before workspaces open as Woodworking when they hold stock or cut list settings, else as General', () => {
    const plain = createSession(newDocument('general'));
    ok(plain.execute('core.addMaterial', { starter: 'paintedSage' }));
    expect(deserializeDocument(asVersion5(plain.doc))!.workspace).toBe('general');

    const stocked = createSession(newDocument('general'));
    ok(stocked.execute('core.addMaterial', { starter: 'whiteMelamine' }));
    expect(deserializeDocument(asVersion5(stocked.doc))!.workspace).toBe('woodworking');

    const settings = createSession(newDocument('general'));
    ok(settings.execute('core.setCutListSettings', { waste: 0.1 }));
    expect(deserializeDocument(asVersion5(settings.doc))!.workspace).toBe('woodworking');

    // Milestone 1 and 2 autosaves hold no materials: General.
    for (const name of ['milestone1-autosave.json', 'milestone2-autosave.json']) {
      const old = JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
      const doc = deserializeDocument(old)!;
      expect(doc.workspace).toBe('general');
      expect(doc.units).toEqual({ unit: 'ft-in', precision: 16 });
    }
  });
});
