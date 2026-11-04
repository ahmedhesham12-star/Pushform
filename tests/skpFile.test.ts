import { describe, expect, test } from 'vitest';
import {
  createSession,
  DEFAULT_CUT_LIST,
  definitionModel,
  documentFromSkp,
  newDocument,
  skpMetadata,
  type CommandSession,
  type PushformDocument,
} from '../src/commands';
import { exportSkp } from '../src/export';
import { listFaces } from '../src/kernel';
import { addAnnotation, addGuide, guidePoint } from '../src/scene';

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

function box(s: CommandSession, x: number, z: number, w: number, d: number, h: number): string[] {
  const before = new Set(listFaces(definitionModel(s.doc)!).map((f) => f.id));
  const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [x, 0, z], width: w, depth: d }));
  ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: h }));
  return listFaces(definitionModel(s.doc)!)
    .map((f) => f.id)
    .filter((f) => !before.has(f));
}

function documentWithPushformData(): PushformDocument {
  const s = createSession();
  const faces = box(s, 0, 0, 1000, 500, 300);
  const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
  ok(s.execute('core.paint', { faceIds: [faces[0]!], materialId: oak }));
  const group = ok(s.execute('core.makeGroup', { faceIds: box(s, 2000, 0, 400, 400, 200) }));
  ok(s.execute('core.setGrain', { definitionId: group.definitionId, grain: 'red' }));
  const tag = ok(s.execute('core.addTag', { name: 'Case', color: '#4f81bd' })).tagId;
  ok(s.execute('core.setTag', { instanceIds: [group.instanceId], tagId: tag }));
  let scene = s.doc.scene;
  [, scene] = addGuide(scene, scene.rootId, guidePoint([100, 0, 0]));
  [, scene] = addAnnotation(scene, scene.rootId, { kind: 'dimension', start: { point: [0, 0, 0] }, end: { point: [1000, 0, 0] }, offset: [0, 200, 0] });
  return { ...s.doc, scene, units: { unit: 'in', precision: 4 }, workspace: 'woodworking', cutList: { ...DEFAULT_CUT_LIST, waste: 0.2 } };
}

describe('native .skp files', () => {
  test('Pushform-only data survives save and open', async () => {
    const doc = documentWithPushformData();
    const bytes = await exportSkp(doc.scene, JSON.stringify(skpMetadata(doc)));
    const loaded = await documentFromSkp(bytes.buffer);
    expect(loaded).not.toBeNull();
    expect(loaded!.units).toEqual(doc.units);
    expect(loaded!.workspace).toBe('woodworking');
    expect(loaded!.cutList?.waste).toBe(0.2);
    const oak = [...doc.scene.materials.values()].find((m) => m.name === 'Oak')!;
    expect([...loaded!.scene.materials.values()].find((m) => m.name === 'Oak')?.stock).toEqual(oak.stock);
    expect([...loaded!.scene.tags.values()].some((tag) => tag.name === 'Case')).toBe(true);
    const group = [...loaded!.scene.definitions.values()].find((def) => def.kind === 'group')!;
    expect(group.grain).toBe('red');
    expect([...loaded!.scene.definitions.values()].some((def) => def.name === 'Pushform data')).toBe(false);
    const root = loaded!.scene.definitions.get(loaded!.scene.rootId)!;
    expect(root.guides.size).toBe(1);
    expect(root.annotations.size).toBe(1);
    const placed = [...root.instances.values()].find((instance) => instance.definitionId === group.id)!;
    const caseTag = [...loaded!.scene.tags.entries()].find(([, tag]) => tag.name === 'Case')?.[0];
    expect(placed.tag).toBe(caseTag);
    expect([...root.instances.values()].some((instance) => instance.name === 'Pushform data')).toBe(false);
  });

  test('a SketchUp file without Pushform attributes opens as geometry with defaults', async () => {
    const s = createSession();
    box(s, 0, 0, 1000, 500, 300);
    const loaded = await documentFromSkp((await exportSkp(s.doc.scene)).buffer);
    expect(loaded).not.toBeNull();
    expect(loaded!.workspace).toBe('general');
    expect(loaded!.units.unit).toBe('mm');
    expect(listFaces(loaded!.scene.definitions.get(loaded!.scene.rootId)!.model)).toHaveLength(6);
  });

  test('an empty model saves and opens through the hidden carrier', async () => {
    const doc = newDocument('woodworking');
    const loaded = await documentFromSkp((await exportSkp(doc.scene, JSON.stringify(skpMetadata(doc)))).buffer);
    expect(loaded).not.toBeNull();
    expect(loaded!.workspace).toBe('woodworking');
    expect(loaded!.scene.definitions.size).toBe(1);
    expect(listFaces(loaded!.scene.definitions.get(loaded!.scene.rootId)!.model)).toHaveLength(0);
  });
});
