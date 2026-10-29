import { describe, expect, test } from 'vitest';
import { createSession, definitionModel, documentFromText, documentToText, serializeDocument, type CommandSession } from '../src/commands';
import { getFace, listFaces } from '../src/kernel';
import { findInstance, getDefinition, inheritedMaterial, shownMaterial } from '../src/scene';

/* Materials (milestone 5, step 4): the model's list, painting faces and instances, deleting, Explode, files. */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}
const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error!.code);

/** A box in a definition (the root when omitted); returns its faces. */
function box(s: CommandSession, x: number, definitionId?: string): string[] {
  const faces = () => listFaces(definitionModel(s.doc, definitionId)!).map((f) => f.id);
  const before = new Set(faces());
  const r = ok(s.execute('core.drawRectangle', { definitionId, faceId: null, corner: [x, 0, 0], width: 100, depth: 100 }));
  ok(s.execute('core.pushPull', { definitionId, faceId: r.faceIds[0]!, distance: 100 }));
  return faces().filter((f) => !before.has(f));
}
const paintOf = (s: CommandSession, faceId: string, definitionId?: string) => getFace(definitionModel(s.doc, definitionId)!, faceId)?.paint;

describe('material commands', () => {
  test('starter materials come in with their name and color; new ones get the next free name', () => {
    const s = createSession();
    const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    const a = ok(s.execute('core.addMaterial', {})).materialId;
    const b = ok(s.execute('core.addMaterial', { color: '#AA0000' })).materialId;
    expect([...s.doc.scene.materials.values()].map((m) => [m.name, m.color])).toEqual([
      ['Oak', '#c8a165'],
      ['Material 1', '#b4b4b0'],
      ['Material 2', '#aa0000'],
    ]);
    ok(s.execute('core.renameMaterial', { materialId: a, name: ' Sapele ' }));
    ok(s.execute('core.setMaterialColor', { materialId: a, color: '#7a4a2a' }));
    expect(s.doc.scene.materials.get(a)).toEqual({ name: 'Sapele', color: '#7a4a2a' });
    const copy = ok(s.execute('core.duplicateMaterial', { materialId: oak })).materialId;
    expect(s.doc.scene.materials.get(copy)).toEqual({ name: 'Oak copy', color: '#c8a165' });
    expect(code(s.execute('core.renameMaterial', { materialId: b, name: '' }))).toBe('invalidInput');
    expect(code(s.execute('core.setMaterialColor', { materialId: 'm999', color: '#000000' }))).toBe('noSuchMaterial');
    const doc = s.doc;
    ok(s.execute('core.renameMaterial', { materialId: a, name: 'Sapele' }));
    expect(s.doc).toBe(doc);
  });

  test('a texture is set with its tile size, and taken away again', () => {
    const s = createSession();
    const id = ok(s.execute('core.addMaterial', {})).materialId;
    const texture = { data: 'iVBORw0KGgo=', mime: 'image/png' as const, width: 600, height: 300 };
    ok(s.execute('core.setMaterialTexture', { materialId: id, texture }));
    expect(s.doc.scene.materials.get(id)!.texture).toEqual(texture);
    expect(code(s.execute('core.setMaterialTexture', { materialId: id, texture: { ...texture, width: 0 } }))).toBe('invalidInput');
    expect(code(s.execute('core.setMaterialTexture', { materialId: id, texture: { ...texture, mime: 'image/gif' as never } }))).toBe('invalidInput');
    ok(s.execute('core.setMaterialTexture', { materialId: id, texture: null }));
    expect(s.doc.scene.materials.get(id)!.texture).toBeUndefined();
  });
});

describe('painting', () => {
  test('faces on either side, and instances, in the open context; null takes paint off', () => {
    const s = createSession();
    const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    const ply = ok(s.execute('core.addMaterial', { starter: 'birchPly' })).materialId;
    const [f] = box(s, 0);
    ok(s.execute('core.paint', { faceIds: [f!], materialId: oak }));
    ok(s.execute('core.paint', { faceIds: [f!], sides: ['back'], materialId: ply }));
    expect(paintOf(s, f!)).toEqual({ front: oak, back: ply });
    ok(s.execute('core.paint', { faceIds: [f!], sides: ['front', 'back'], materialId: null }));
    expect(paintOf(s, f!)).toBeUndefined();
    const g = ok(s.execute('core.makeGroup', { faceIds: box(s, 500) }));
    ok(s.execute('core.paint', { instanceIds: [g.instanceId], materialId: oak }));
    expect(findInstance(s.doc.scene, g.instanceId)!.instance.material).toBe(oak);
    expect(code(s.execute('core.paint', { faceIds: [f!], materialId: 'm999' }))).toBe('noSuchMaterial');
    expect(code(s.execute('core.paint', { materialId: oak }))).toBe('nothingSelected');
  });

  test('an instance material shows on the unpainted faces inside it, the nearest painted instance first', () => {
    const s = createSession();
    const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    const red = ok(s.execute('core.addMaterial', { starter: 'paintedSage' })).materialId;
    const outer = ok(s.execute('core.makeGroup', { faceIds: box(s, 0) }));
    const innerFaces = box(s, 300, outer.definitionId);
    const inner = ok(s.execute('core.makeGroup', { definitionId: outer.definitionId, faceIds: innerFaces }));
    ok(s.execute('core.paint', { instanceIds: [outer.instanceId], materialId: oak }));
    const model = definitionModel(s.doc, inner.definitionId)!;
    const [f, g] = listFaces(model).map((x) => x.id);
    ok(s.execute('core.paint', { definitionId: inner.definitionId, faceIds: [g!], materialId: red }));
    const path = [outer.instanceId, inner.instanceId];
    const model2 = definitionModel(s.doc, inner.definitionId)!;
    expect(inheritedMaterial(s.doc.scene, path)).toBe(oak);
    expect(shownMaterial(s.doc.scene, path, model2, f!, 'front')).toBe(oak);
    expect(shownMaterial(s.doc.scene, path, model2, g!, 'front')).toBe(red);
    ok(s.execute('core.paint', { definitionId: outer.definitionId, instanceIds: [inner.instanceId], materialId: red }));
    expect(shownMaterial(s.doc.scene, path, model2, f!, 'back')).toBe(red);
  });

  test('deleting a material takes it off every face and instance, in every definition; undo brings it back', () => {
    const s = createSession();
    const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    const [f] = box(s, 0);
    const g = ok(s.execute('core.makeComponent', { faceIds: box(s, 500), name: 'Box' }));
    const inside = listFaces(definitionModel(s.doc, g.definitionId)!)[0]!.id;
    ok(s.execute('core.paint', { faceIds: [f!], sides: ['front', 'back'], materialId: oak }));
    ok(s.execute('core.paint', { definitionId: g.definitionId, faceIds: [inside], materialId: oak }));
    ok(s.execute('core.paint', { instanceIds: [g.instanceId], materialId: oak }));
    ok(s.execute('core.deleteMaterial', { materialId: oak }));
    expect(s.doc.scene.materials.size).toBe(0);
    expect(paintOf(s, f!)).toBeUndefined();
    expect(paintOf(s, inside, g.definitionId)).toBeUndefined();
    expect(findInstance(s.doc.scene, g.instanceId)!.instance.material).toBeUndefined();
    s.undo();
    expect(paintOf(s, f!)).toEqual({ front: oak, back: oak });
  });

  test('Explode gives the material to every unpainted side, backs too, and to unpainted groups inside (as SketchUp does)', () => {
    const s = createSession();
    const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    const red = ok(s.execute('core.addMaterial', { starter: 'paintedSage' })).materialId;
    const outer = ok(s.execute('core.makeGroup', { faceIds: box(s, 0) }));
    const inner = ok(s.execute('core.makeGroup', { definitionId: outer.definitionId, faceIds: box(s, 300, outer.definitionId) }));
    const faces = listFaces(definitionModel(s.doc, outer.definitionId)!).map((f) => f.id);
    ok(s.execute('core.paint', { definitionId: outer.definitionId, faceIds: [faces[0]!], materialId: red }));
    ok(s.execute('core.paint', { instanceIds: [outer.instanceId], materialId: oak }));
    const out = ok(s.execute('core.explode', { instanceIds: [outer.instanceId] }));
    const paints = listFaces(definitionModel(s.doc)!).map((f) => `${f.paint?.front}/${f.paint?.back}`).sort();
    expect(paints).toEqual([...Array(5).fill(`${oak}/${oak}`), `${red}/${oak}`].sort());
    const root = getDefinition(s.doc.scene, s.doc.scene.rootId)!;
    expect(root.instances.get(out.instanceIds[0]!)!.material).toBe(oak);
    expect(inner.instanceId).not.toBe(out.instanceIds[0]);
  });
});

describe('materials in files', () => {
  test('materials, textures, painted faces and instances are saved and come back the same', () => {
    const s = createSession();
    const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    ok(s.execute('core.setMaterialTexture', { materialId: oak, texture: { data: 'iVBORw0KGgo=', mime: 'image/png', width: 400, height: 400 } }));
    const [f] = box(s, 0);
    ok(s.execute('core.paint', { faceIds: [f!], sides: ['back'], materialId: oak }));
    const g = ok(s.execute('core.makeGroup', { faceIds: box(s, 500) }));
    ok(s.execute('core.paint', { instanceIds: [g.instanceId], materialId: oak }));
    const back = documentFromText(documentToText(s.doc))!;
    expect(serializeDocument(back)).toEqual(serializeDocument(s.doc));
    expect(back.scene.materials).toEqual(s.doc.scene.materials);
  });

  test('paint or an instance naming a missing material, or a bad material, makes the file invalid', () => {
    const s = createSession();
    const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    const [f] = box(s, 0);
    ok(s.execute('core.paint', { faceIds: [f!], materialId: oak }));
    const saved = JSON.parse(documentToText(s.doc));
    const missing = structuredClone(saved);
    delete missing.scene.materials[oak];
    expect(documentFromText(JSON.stringify(missing))).toBeNull();
    const bad = structuredClone(saved);
    bad.scene.materials[oak].texture = { data: 'x', mime: 'image/gif', width: 1, height: 1 };
    expect(documentFromText(JSON.stringify(bad))).toBeNull();
  });
});
