import { describe, expect, test } from 'vitest';
import { createSession, documentFromText, documentToText } from '../src/commands';
import { cutList, toCsv } from '../src/cutlist';
import { listFaces } from '../src/kernel';
import { buildMesh, saveMesh } from '../src/scene';
import { buildCabinet, ok } from './helpers/cabinet';

const HINGE = { manufacturer: 'Blum', partNumber: '71B3550', price: 4.2, link: 'https://example.com/hinge' };
const OPTIONS = { waste: 0, includeHidden: false };

/** A small closed box component in the root. */
function component(s: ReturnType<typeof createSession>, x: number, name: string) {
  const before = new Set(listFaces(s.doc.scene.definitions.get(s.doc.scene.rootId)!.model).map((f) => f.id));
  const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [x, 0, 0], width: 100, depth: 50 }));
  ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: 18 }));
  const faceIds = listFaces(s.doc.scene.definitions.get(s.doc.scene.rootId)!.model).map((f) => f.id).filter((f) => !before.has(f));
  return ok(s.execute('core.makeComponent', { faceIds, name }));
}

describe('hardware details', () => {
  test('go on a component or a mesh, not a group; saved and opened again; null takes them off', () => {
    const s = createSession();
    const hinge = component(s, 0, 'Hinge');
    ok(s.execute('core.setHardware', { definitionId: hinge.definitionId, hardware: HINGE }));
    expect(s.doc.scene.definitions.get(hinge.definitionId)!.hardware).toEqual(HINGE);
    const group = ok(s.execute('core.makeGroup', { instanceIds: [hinge.instanceId] }));
    const r = s.execute('core.setHardware', { definitionId: group.definitionId, hardware: HINGE });
    expect(!r.ok && r.error.code).toBe('hardwareNeedsComponent');
    const bad = s.execute('core.setHardware', { definitionId: hinge.definitionId, hardware: { ...HINGE, link: 'javascript:alert(1)' } });
    expect(!bad.ok && bad.error.code).toBe('invalidInput');
    const mesh = buildMesh([{ positions: [0, 0, 0, 10, 0, 0, 0, 10, 0], color: '#808080' }])!;
    const placed = ok(s.execute('core.insertMesh', { name: 'Knob', mesh: saveMesh(mesh), position: [0, 0, 0] }));
    ok(s.execute('core.setHardware', { definitionId: placed.definitionId, hardware: { ...HINGE, price: null, link: '' } }));
    const doc = documentFromText(documentToText(s.doc))!;
    expect(doc.scene.definitions.get(hinge.definitionId)!.hardware).toEqual(HINGE);
    expect(doc.scene.definitions.get(placed.definitionId)!.hardware!.price).toBeNull();
    ok(s.execute('core.setHardware', { definitionId: hinge.definitionId, hardware: null }));
    expect(s.doc.scene.definitions.get(hinge.definitionId)!.hardware).toBeUndefined();
  });

  test('a file with hardware on a group, or a bad link, does not open', () => {
    const s = createSession();
    const hinge = component(s, 0, 'Hinge');
    ok(s.execute('core.setHardware', { definitionId: hinge.definitionId, hardware: HINGE }));
    const data = JSON.parse(documentToText(s.doc));
    const onGroup = structuredClone(data);
    onGroup.scene.definitions[hinge.definitionId].kind = 'group';
    expect(documentFromText(JSON.stringify(onGroup))).toBeNull();
    const badLink = structuredClone(data);
    badLink.scene.definitions[hinge.definitionId].hardware.link = 'file:///etc';
    expect(documentFromText(JSON.stringify(badLink))).toBeNull();
  });
});

describe('hardware in the cut list', () => {
  test('left out of the parts with everything inside it; listed by definition with quantity and cost', () => {
    const s = createSession();
    const shelf = component(s, 0, 'Shelf');
    const hinge = component(s, 200, 'Hinge');
    ok(s.execute('core.copyInstances', { instanceIds: [hinge.instanceId], translation: [0, 100, 0] }));
    ok(s.execute('core.setHardware', { definitionId: hinge.definitionId, hardware: HINGE }));
    // A hardware assembly holding a part and other hardware: counted once, as itself.
    const screw = component(s, 400, 'Screw');
    ok(s.execute('core.setHardware', { definitionId: screw.definitionId, hardware: { ...HINGE, price: 0.1 } }));
    const plate = component(s, 600, 'Plate');
    const kit = ok(s.execute('core.makeComponent', { instanceIds: [screw.instanceId, plate.instanceId], name: 'Kit' }));
    ok(s.execute('core.setHardware', { definitionId: kit.definitionId, hardware: { ...HINGE, price: 9 } }));
    const list = cutList(s.doc.scene, OPTIONS);
    expect(list.rows.map((r) => r.name)).toEqual(['Shelf']);
    expect(list.hardware.map((h) => [h.name, h.quantity, h.cost])).toEqual([
      ['Hinge', 2, 8.4],
      ['Kit', 1, 9],
    ]);
    expect(list.hardware[0]!.paths).toHaveLength(2);
    expect(shelf.instanceId).toBeTruthy();
  });

  test('hidden hardware is left out unless hidden parts are listed', () => {
    const s = createSession();
    const hinge = component(s, 0, 'Hinge');
    ok(s.execute('core.setHardware', { definitionId: hinge.definitionId, hardware: HINGE }));
    const tag = ok(s.execute('core.addTag', { name: 'Hardware' })).tagId;
    ok(s.execute('core.setTag', { instanceIds: [hinge.instanceId], tagId: tag }));
    ok(s.execute('core.setTagVisible', { tagId: tag, visible: false }));
    expect(cutList(s.doc.scene, OPTIONS).hardware).toHaveLength(0);
    expect(cutList(s.doc.scene, OPTIONS).hiddenLeftOut).toBe(0);
    expect(cutList(s.doc.scene, { ...OPTIONS, includeHidden: true }).hardware).toHaveLength(1);
  });

  test('the CSV lists the hardware after the parts, with its own header', () => {
    const { s } = buildCabinet();
    const hinge = component(s, 3000, 'Hinge');
    ok(s.execute('core.setHardware', { definitionId: hinge.definitionId, hardware: { ...HINGE, partNumber: '71B, soft close' } }));
    const lines = toCsv(cutList(s.doc.scene, OPTIONS), s.doc.scene, s.doc.units).split('\r\n');
    const at = lines.indexOf('');
    expect(lines[at + 1]).toBe('Hardware,Manufacturer,Part number,Quantity,Price each,Cost,Link');
    expect(lines[at + 2]).toBe('Hinge,Blum,"71B, soft close",1,4.20,4.20,https://example.com/hinge');
  });
});
