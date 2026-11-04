// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest';
import { createSession, cutListSettings, definitionModel, type CommandSession, type CutListSettings } from '../src/commands';
import { cutList, defaultLabelSettings, labelSheet, PAGE_SIZES, partLabels, validLabelSettings, type LabelSettings } from '../src/cutlist';
import { listFaces } from '../src/kernel';
import { loadViewSettings, saveViewSettings } from '../src/storage';
import { CutListPanel, type CutListHost } from '../src/ui/cutListPanel';

/* Part labels (milestone 6, step 7). */

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

/** A drawer component holding two ply sides, placed twice (the second named), and a loose melamine shelf. */
function setup() {
  const s = createSession();
  ok(s.execute('core.setDisplayUnits', { unit: 'mm', precision: 0 }));
  const ply = ok(s.execute('core.addMaterial', { starter: 'birchPly' })).materialId;
  const melamine = ok(s.execute('core.addMaterial', { starter: 'whiteMelamine' })).materialId;
  const side = part(s, 0, 450, 180, 12, 'Drawer side');
  const side2 = ok(s.execute('core.copyInstances', { instanceIds: [side.instanceId], translation: [0, 0, 500] })).instanceIds[0]!;
  ok(s.execute('core.paint', { instanceIds: [side.instanceId, side2], materialId: ply }));
  const drawer = ok(s.execute('core.makeComponent', { instanceIds: [side.instanceId, side2], name: 'Drawer' }));
  const lower = ok(s.execute('core.copyInstances', { instanceIds: [drawer.instanceId], translation: [0, 300, 0] })).instanceIds[0]!;
  ok(s.execute('core.renameInstance', { instanceId: lower, name: 'Lower drawer' }));
  const shelf = part(s, 2000, 600, 300, 18, 'Shelf');
  ok(s.execute('core.paint', { instanceIds: [shelf.instanceId], materialId: melamine }));
  return { s, ply, melamine };
}

describe('the labels', () => {
  test('one per part placed, numbered with its copy, with its assembly, size, material and grain', () => {
    const { s, ply, melamine } = setup();
    const list = cutList(s.doc.scene, { waste: 0.15, includeHidden: false });
    const labels = partLabels(s.doc.scene, list);
    expect(labels.map((l) => [l.number, l.copy, l.count, l.name, l.assembly])).toEqual([
      [1, 1, 4, 'Drawer side', 'Drawer'],
      [1, 2, 4, 'Drawer side', 'Drawer'],
      [1, 3, 4, 'Drawer side', 'Lower drawer'],
      [1, 4, 4, 'Drawer side', 'Lower drawer'],
      [2, 1, 1, 'Shelf', null],
    ]);
    expect(labels[0]).toMatchObject({ length: 450, width: 180, thickness: 12, materialId: ply, grain: true });
    // Melamine has no grain.
    expect(labels[4]).toMatchObject({ materialId: melamine, grain: false });
  });

  test('a grain direction on the part gives it a grain arrow too; the cut size when asked', () => {
    const { s } = setup();
    const shelf = [...s.doc.scene.definitions.values()].find((d) => d.name === 'Shelf')!;
    ok(s.execute('core.setGrain', { definitionId: shelf.id, grain: 'red' }));
    const abs = ok(s.execute('core.addMaterial', { starter: 'whiteAbsBand' })).materialId;
    const front = listFaces(shelf.model).find((f) => f.normal[2] > 0.99)!.id;
    ok(s.execute('core.paint', { definitionId: shelf.id, faceIds: [front], materialId: abs }));
    const list = cutList(s.doc.scene, { waste: 0.15, includeHidden: false });
    const label = partLabels(s.doc.scene, list, { cutSize: true }).find((l) => l.name === 'Shelf')!;
    expect(label).toMatchObject({ grain: true, cutSize: true, length: 600, width: 299 });
    expect(label.bands.length2).toBe(abs);
  });
});

describe('label sheets', () => {
  const settings = (preset: LabelSettings['preset'], page: LabelSettings['page'] = 'a4', columns = 3, rows = 8): LabelSettings => ({ preset, page, columns, rows });

  test('the presets fit their paper', () => {
    for (const preset of ['a4-3x8', 'a4-2x7', 'letter-3x10'] as const) {
      const sheet = labelSheet(settings(preset));
      const paper = PAGE_SIZES[sheet.page];
      const width = 2 * sheet.margin.start + sheet.columns * sheet.label.width + (sheet.columns - 1) * sheet.gap.x;
      const height = sheet.margin.top + sheet.rows * sheet.label.height + (sheet.rows - 1) * sheet.gap.y;
      expect(width, preset).toBeLessThanOrEqual(paper.width + 1e-9);
      expect(height, preset).toBeLessThanOrEqual(paper.height - 0.2 + 1e-9);
    }
    expect(labelSheet(settings('a4-3x8'))).toMatchObject({ columns: 3, rows: 8, label: { width: 70, height: 37 } });
    expect(labelSheet(settings('letter-3x10')).label).toEqual({ width: 66.675, height: 25.4 });
  });

  test('a custom grid fills its page inside a 10 mm margin', () => {
    const sheet = labelSheet(settings('custom', 'letter', 2, 5));
    expect(sheet.page).toBe('letter');
    expect(sheet.label.width).toBeCloseTo((215.9 - 20 - 2) / 2, 9);
    expect(sheet.label.height).toBeCloseTo((279.4 - 20 - 8) / 5, 9);
  });

  test('a setting of the device: Letter where Letter paper is used, A4 elsewhere; bad values are ignored', () => {
    expect(defaultLabelSettings('US').preset).toBe('letter-3x10');
    expect(defaultLabelSettings('DE').preset).toBe('a4-3x8');
    expect(defaultLabelSettings(null).preset).toBe('a4-3x8');
    expect(validLabelSettings(settings('custom', 'a4', 7, 8))).toBeNull();
    expect(validLabelSettings({ ...settings('a4-2x7'), page: 'a3' })).toBeNull();
    localStorage.clear();
    const view = loadViewSettings();
    saveViewSettings({ ...view, labels: settings('custom', 'letter', 2, 5) });
    expect(loadViewSettings().labels).toEqual(settings('custom', 'letter', 2, 5));
    localStorage.setItem('pushform.view.v1', JSON.stringify({ labels: { preset: 'huge' } }));
    expect(validLabelSettings(loadViewSettings().labels)).not.toBeNull();
  });
});

describe('the Labels view', () => {
  function panel() {
    const { s } = setup();
    let labels: LabelSettings = { preset: 'a4-3x8', page: 'a4', columns: 3, rows: 8 };
    const host: CutListHost = {
      scene: () => s.doc.scene,
      units: () => s.doc.units,
      settings: () => cutListSettings(s.doc),
      setSettings: vi.fn((patch: Partial<CutListSettings>) => void ok(s.execute('core.setCutListSettings', patch))),
      select: vi.fn(),
      showMaterial: vi.fn(),
      exportCsv: vi.fn(),
      close: vi.fn(),
      flash: vi.fn(),
      labelSettings: () => labels,
      setLabelSettings: vi.fn((next: LabelSettings) => {
        labels = next;
      }),
    };
    const p = new CutListPanel(host);
    document.body.replaceChildren(p.element);
    p.setOpen(true);
    [...p.element.querySelectorAll<HTMLButtonElement>('.cutlist-tab')].find((b) => b.textContent === 'Labels')!.click();
    return { p, host };
  }

  test('sheets of labels at their size, each label with its number, copy, name, assembly, size and material', () => {
    const { p } = panel();
    expect(p.element.querySelector('.labels-count')!.textContent).toBe('5 labels on 1 sheet. Print at 100% (actual size).');
    const page = p.element.querySelector<HTMLElement>('.label-page')!;
    expect([page.style.inlineSize, page.style.gridTemplateColumns]).toEqual(['210mm', 'repeat(3, 70mm)']);
    const labels = [...p.element.querySelectorAll('.part-label')];
    expect(labels).toHaveLength(5);
    expect(labels[2]!.getAttribute('aria-label')).toBe('Part 1, 3 of 4');
    expect([...labels[2]!.querySelectorAll('.label-name, .label-line')].map((e) => e.textContent)).toEqual(['Drawer side', 'Lower drawer', '450 mm × 180 mm × 12 mm', 'Birch ply']);
    expect(labels[2]!.querySelector('.label-grain')).not.toBeNull();
    expect(labels[4]!.querySelector('.label-grain')).toBeNull();
    expect(labels[4]!.querySelector('.edge-marks')!.getAttribute('aria-label')).toBe('No edge banding');
  });

  test('the sheet menu; a custom grid asks for its page, columns and rows', () => {
    const { p, host } = panel();
    const custom = p.element.querySelector<HTMLElement>('.labels-custom')!;
    expect(custom.hidden).toBe(true);
    const preset = p.element.querySelector<HTMLSelectElement>('.labels-settings select')!;
    preset.value = 'custom';
    preset.dispatchEvent(new Event('change'));
    expect(host.setLabelSettings).toHaveBeenLastCalledWith({ preset: 'custom', page: 'a4', columns: 3, rows: 8 });
    p.sync();
    expect(custom.hidden).toBe(false);
    const [columns, rows] = [...custom.querySelectorAll('input')];
    columns!.value = '2';
    columns!.dispatchEvent(new Event('change'));
    expect(host.setLabelSettings).toHaveBeenLastCalledWith({ preset: 'custom', page: 'a4', columns: 2, rows: 8 });
    rows!.value = '40';
    rows!.dispatchEvent(new Event('change'));
    expect(rows!.value).toBe('8');
  });

  test('Print prints the sheets alone, with no heading', () => {
    const { p } = panel();
    window.print = vi.fn();
    [...p.element.querySelectorAll<HTMLButtonElement>('.cutlist-buttons button')].find((b) => b.textContent === 'Print')!.click();
    const root = document.querySelector('.print-root.print-labels')!;
    expect(root.querySelector('h1')).toBeNull();
    expect(root.querySelectorAll('.part-label')).toHaveLength(5);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.querySelector('.print-root')).toBeNull();
  });
});
