import { describe, expect, test } from 'vitest';
import { createSession, documentFromText, documentToText, libraryItem, readItem } from '../src/commands';
import { cutList } from '../src/cutlist';
import { listFaces } from '../src/kernel';
import { memoryLibrary } from '../src/library';
import { buildMesh, saveMesh, type Scene } from '../src/scene';
import { buildCabinet, ok } from './helpers/cabinet';

const names = (scene: Scene) => [...scene.definitions.values()].map((d) => d.name).filter(Boolean).sort();
const DRAWER = ['Drawer', 'Drawer bottom', 'Drawer front/back', 'Drawer side', 'Slide'];

describe('library items', () => {
  /** The cabinet's drawer, with a slide (hardware mesh) and a tag on its front, saved as an item. */
  function drawerItem() {
    const c = buildCabinet();
    const mesh = buildMesh([{ positions: [0, 0, 0, 450, 0, 0, 0, 45, 0], color: '#a7abb0' }])!;
    const slide = ok(c.s.execute('core.insertMesh', { definitionId: c.drawer.definitionId, name: 'Slide', mesh: saveMesh(mesh), position: [0, 0, 0] }));
    ok(c.s.execute('core.setHardware', { definitionId: slide.definitionId, hardware: { manufacturer: 'Hettich', partNumber: '', price: 12.5, link: '' } }));
    return { ...c, text: libraryItem(c.s.doc, c.drawer.definitionId) };
  }

  test('an item is a small document: the component at the origin, what it holds and the materials it uses', () => {
    const { s, text, drawer } = drawerItem();
    const item = readItem(text)!;
    expect(item.definitionId).toBe(drawer.definitionId);
    const scene = item.doc.scene;
    const root = scene.definitions.get(scene.rootId)!;
    expect([...root.instances.values()][0]!.transform.translation).toEqual([0, 0, 0]);
    expect(listFaces(root.model)).toHaveLength(0);
    expect(names(scene)).toEqual(DRAWER);
    // Only the birch ply of the drawer box, none of the cabinet's other materials.
    expect([...scene.materials.values()].map((m) => m.name)).toEqual(['Birch ply']);
    expect(scene.tags.size).toBe(0);
    expect(s.doc.scene.materials.size).toBeGreaterThan(1);
    expect(readItem(documentToText(s.doc))).toBeNull();
  });

  test('inserted into another file: a copy of its definitions, materials matched by name, hardware and mesh kept', () => {
    const { text } = drawerItem();
    const s = createSession();
    const ply = ok(s.execute('core.addMaterial', { starter: 'birchPly' })).materialId;
    const placed = ok(s.execute('core.insertItem', { item: text, position: [100, 0, 0] }));
    const scene = s.doc.scene;
    expect(names(scene)).toEqual(DRAWER);
    expect(scene.materials.size).toBe(1);
    const drawer = scene.definitions.get(placed.definitionId)!;
    const paints = new Set([...drawer.instances.values()].flatMap((i) => listFaces(scene.definitions.get(i.definitionId)!.model).map((f) => f.paint?.front ?? i.material)));
    expect(paints.has(ply) || [...drawer.instances.values()].some((i) => i.material === ply)).toBe(true);
    const list = cutList(scene, { waste: 0, includeHidden: true });
    expect(list.rows.reduce((n, r) => n + r.quantity, 0)).toBe(5);
    expect(list.rows.every((r) => r.materialId === ply)).toBe(true);
    expect(list.hardware.map((h) => [h.name, h.quantity, h.cost])).toEqual([['Slide', 1, 12.5]]);
    // Saved and opened again.
    expect(documentFromText(documentToText(s.doc))).not.toBeNull();
  });

  test('inserting again makes another copy, named apart; missing materials are added', () => {
    const { text } = drawerItem();
    const s = createSession();
    const a = ok(s.execute('core.insertItem', { item: text, position: [0, 0, 0] }));
    const b = ok(s.execute('core.insertItem', { item: text, position: [1000, 0, 0] }));
    expect(a.definitionId).not.toBe(b.definitionId);
    expect(names(s.doc.scene)).toEqual([...DRAWER, ...DRAWER, 'Drawer (2)'].filter((n, i, all) => n !== 'Drawer' || all.indexOf(n) === i).sort());
    expect([...s.doc.scene.materials.values()].map((m) => m.name)).toEqual(['Birch ply']);
    expect(cutList(s.doc.scene, { waste: 0, includeHidden: true }).hardware.map((h) => h.quantity)).toEqual([1, 1]);
  });

  test('a component painted as a whole keeps its paint', () => {
    const c = buildCabinet();
    const walnut = ok(c.s.execute('core.addMaterial', { starter: 'walnut' })).materialId;
    const text = libraryItem(c.s.doc, c.drawer.definitionId, walnut);
    const s = createSession();
    const placed = ok(s.execute('core.insertItem', { item: text, position: [0, 0, 0] }));
    const root = s.doc.scene.definitions.get(s.doc.scene.rootId)!;
    const material = root.instances.get(placed.instanceId)!.material!;
    expect(s.doc.scene.materials.get(material)!.name).toBe('Walnut');
  });

  test('a broken item is refused', () => {
    const s = createSession();
    const r = s.execute('core.insertItem', { item: '{"format":"pushform"}', position: [0, 0, 0] });
    expect(!r.ok && r.error.code).toBe('invalidItem');
  });

  test('the store keeps items by name', async () => {
    const lib = memoryLibrary();
    const b = await lib.save('Slide', 'x');
    await lib.save('Drawer', 'y');
    expect((await lib.list()).map((e) => e.name)).toEqual(['Drawer', 'Slide']);
    await lib.remove(b.id);
    expect((await lib.list()).map((e) => e.name)).toEqual(['Drawer']);
  });
});
