// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest';
import { createSession, cutListSettings, definitionModel, type CommandSession, type CutListSettings } from '../src/commands';
import { listFaces } from '../src/kernel';
import { CutListPanel, type CutListHost } from '../src/ui/cutListPanel';

/* The Cut List panel (milestone 5, step 10). */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

function part(s: CommandSession, x: number, w: number, d: number, h: number, name: string) {
  const faces = () => listFaces(definitionModel(s.doc)!).map((f) => f.id);
  const before = new Set(faces());
  const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [x, 0, 0], width: w, depth: d }));
  ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: h }));
  return ok(s.execute('core.makeComponent', { faceIds: faces().filter((f) => !before.has(f)), name }));
}

function setup() {
  const s = createSession();
  ok(s.execute('core.setDisplayUnits', { unit: 'mm', precision: 0 }));
  const ply = ok(s.execute('core.addMaterial', { starter: 'birchPly' })).materialId;
  ok(s.execute('core.setMaterialStock', { materialId: ply, stock: { kind: 'sheet', thickness: 12, length: 1525, width: 1525, price: 80, grain: true } }));
  const side = part(s, 0, 450, 180, 12, 'Drawer side');
  ok(s.execute('core.copyInstances', { instanceIds: [side.instanceId], translation: [0, 0, 1000] }));
  const bottom = part(s, 1000, 716, 426, 12, 'Drawer bottom');
  ok(s.execute('core.paint', { instanceIds: [...s.doc.scene.definitions.get(s.doc.scene.rootId)!.instances.keys()], materialId: ply }));
  part(s, 3000, 796, 226, 18, 'Front');
  const select = vi.fn();
  const host: CutListHost = {
    scene: () => s.doc.scene,
    units: () => s.doc.units,
    settings: () => cutListSettings(s.doc),
    setSettings: vi.fn((patch: Partial<CutListSettings>) => void ok(s.execute('core.setCutListSettings', patch))),
    select,
    showMaterial: vi.fn(),
    exportCsv: vi.fn(),
    close: vi.fn(),
    flash: vi.fn(),
    labelSettings: () => ({ preset: 'a4-3x8', page: 'a4', columns: 3, rows: 8 }),
    setLabelSettings: vi.fn(),
  };
  const p = new CutListPanel(host);
  document.body.replaceChildren(p.element);
  p.setOpen(true);
  const table = () => [...p.element.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent));
  return { s, p, host, table, bottom };
}

describe('the Cut List panel', () => {
  test('parts grouped by material, each with a total; no material last', () => {
    const { table } = setup();
    expect(table()).toEqual([
      ['Birch ply'],
      ['1', 'Drawer bottom', '1', '716 mm', '426 mm', '12 mm', 'Birch ply', '', ''],
      ['2', 'Drawer side', '2', '450 mm', '180 mm', '12 mm', 'Birch ply', '', ''],
      ['3 parts · 0.47 m² · 1 sheet (20% used) · 80.00'],
      ['No material'],
      ['3', 'Front', '1', '796 mm', '226 mm', '18 mm', 'No material', '', 'No material'],
      ['1 part · 0.18 m²'],
    ]);
  });

  test('a column heading sorts, and sorts the other way when clicked again', () => {
    const { p, table } = setup();
    const heading = (label: string) => [...p.element.querySelectorAll<HTMLButtonElement>('.cutlist-sort')].find((b) => b.textContent === label)!;
    heading('Quantity').click();
    expect(table()[1]![1]).toBe('Drawer bottom');
    heading('Quantity').click();
    expect(table()[1]![1]).toBe('Drawer side');
    expect(heading('Quantity').parentElement!.getAttribute('aria-sort')).toBe('descending');
  });

  test('a click on a row selects its parts', () => {
    const { p, host, bottom } = setup();
    const row = [...p.element.querySelectorAll<HTMLElement>('.cutlist-row')].find((r) => r.children[1]!.textContent === 'Drawer bottom')!;
    row.click();
    expect(host.select).toHaveBeenCalledWith([[bottom.instanceId]]);
  });

  test('settings: waste and currency are saved in the file and the totals follow', () => {
    const { s, p, host, table } = setup();
    const waste = p.element.querySelector<HTMLInputElement>('.cutlist-settings input')!;
    expect(waste.value).toBe('15');
    waste.value = '50';
    waste.dispatchEvent(new Event('change'));
    expect(cutListSettings(s.doc).waste).toBe(0.5);
    const currency = p.element.querySelectorAll<HTMLInputElement>('.cutlist-settings input')[1]!;
    currency.value = 'eur';
    currency.dispatchEvent(new Event('change'));
    p.sync();
    expect(table()[3]![0]).toMatch(/^3 parts · 0.47 m² · 1 sheet \(20% used\) · €80.00$/);
    waste.value = 'lots';
    waste.dispatchEvent(new Event('change'));
    expect(host.flash).toHaveBeenCalledWith('Type the waste as a percentage, such as 15.', true);
  });

  test('hidden parts: counted, and listed with the switch', () => {
    const { s, p, table } = setup();
    const tag = ok(s.execute('core.addTag', {})).tagId;
    const front = [...s.doc.scene.definitions.get(s.doc.scene.rootId)!.instances.values()].find((i) => s.doc.scene.definitions.get(i.definitionId)!.name === 'Front')!;
    ok(s.execute('core.setTag', { instanceIds: [front.id], tagId: tag }));
    ok(s.execute('core.setTagVisible', { tagId: tag, visible: false }));
    p.sync();
    expect(table().some((r) => r[1] === 'Front')).toBe(false);
    expect(p.element.querySelector('.cutlist-note')!.textContent).toBe('1 hidden part is not listed.');
    p.element.querySelector<HTMLInputElement>('.cutlist-check input')!.click();
    p.sync();
    expect(table().some((r) => r[1] === 'Front')).toBe(true);
  });
});

describe('the several boards tip', () => {
  test('shows with the warning, and only then', () => {
    const { s, p } = setup();
    expect(p.element.querySelector('.cutlist-tip')).toBeNull();
    // A whole cabinet in one component: an open box 300 mm deep.
    const c = part(s, 5000, 800, 300, 720, 'Cabinet');
    const front = listFaces(definitionModel(s.doc, c.definitionId)!).find((f) => f.normal[2] === 1)!.id;
    ok(s.execute('core.erase', { definitionId: c.definitionId, faceIds: [front], edgeIds: [] }));
    p.sync();
    const row = [...p.element.querySelectorAll('.cutlist-row')].find((r) => r.children[1]!.textContent === 'Cabinet')!;
    expect(row.lastElementChild!.textContent).toBe('Looks like several boards in one part: make each board its own group; No material');
    expect(p.element.querySelector('.cutlist-tip')!.textContent).toBe(
      'The cut list counts each group or component holding faces as one board. Model each board on its own: draw it, push/pull it to its thickness, and make it a group before drawing the next. Then put the boards of one cabinet inside one component.',
    );
  });
});

describe('a thickness off the material stock', () => {
  test('the warning says both thicknesses; the material name opens the material, without selecting the row', () => {
    const { s, p, host } = setup();
    // A 15 mm board in 12 mm birch ply.
    const shelf = part(s, 6000, 600, 300, 15, 'Shelf');
    const ply = [...s.doc.scene.materials.keys()][0]!;
    ok(s.execute('core.paint', { instanceIds: [shelf.instanceId], materialId: ply }));
    p.sync();
    const row = [...p.element.querySelectorAll<HTMLElement>('.cutlist-row')].find((r) => r.children[1]!.textContent === 'Shelf')!;
    expect(row.lastElementChild!.textContent).toBe('Thickness 15 mm, material is 12 mm');
    const button = row.querySelector<HTMLButtonElement>('.cutlist-material')!;
    expect(button.textContent).toBe('Birch ply');
    button.click();
    expect(host.showMaterial).toHaveBeenCalledWith(ply);
    expect(host.select).not.toHaveBeenCalled();
    // Rows without the warning keep the name as plain text.
    expect([...p.element.querySelectorAll('.cutlist-material')]).toHaveLength(1);
  });
});
