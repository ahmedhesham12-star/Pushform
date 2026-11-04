// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest';
import { createSession, cutListSettings, definitionModel, type CommandSession, type CutListSettings } from '../src/commands';
import { listFaces } from '../src/kernel';
import { CutListPanel, type CutListHost } from '../src/ui/cutListPanel';

/* The Diagrams view of the Cut List panel (milestone 6, step 5). */

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

/** Two 1000 x 1000 ply parts (two sheets), a drawer side, an oak top, and a part with no material. */
function setup() {
  const s = createSession();
  ok(s.execute('core.setDisplayUnits', { unit: 'mm', precision: 0 }));
  const ply = ok(s.execute('core.addMaterial', { starter: 'birchPly' })).materialId;
  const big = part(s, 0, 1000, 1000, 12, 'Panel');
  ok(s.execute('core.copyInstances', { instanceIds: [big.instanceId], translation: [0, 0, 2000] }));
  const side = part(s, 3000, 450, 180, 12, 'Drawer side');
  ok(s.execute('core.paint', { instanceIds: [big.instanceId, side.instanceId, ...[...s.doc.scene.definitions.get(s.doc.scene.rootId)!.instances.keys()]], materialId: ply }));
  const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
  const top = part(s, 5000, 840, 540, 18, 'Top');
  ok(s.execute('core.paint', { instanceIds: [top.instanceId], materialId: oak }));
  part(s, 7000, 300, 300, 18, 'Block');
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
    labelSettings: () => ({ preset: 'a4-3x8', page: 'a4', columns: 3, rows: 8 }),
    setLabelSettings: vi.fn(),
  };
  const p = new CutListPanel(host);
  document.body.replaceChildren(p.element);
  p.setOpen(true);
  const tab = (label: string) => [...p.element.querySelectorAll<HTMLButtonElement>('.cutlist-tab')].find((b) => b.textContent === label)!;
  tab('Diagrams').click();
  const field = (label: string) => [...p.element.querySelectorAll('.diagrams-settings label')].find((l) => l.firstChild!.textContent === label)!.querySelector('input, select') as HTMLInputElement;
  return { s, p, host, tab, field, ply };
}

const texts = (root: Element, selector: string) => [...root.querySelectorAll(selector)].map((e) => e.textContent);

describe('the Diagrams view', () => {
  test('switches with the parts list; the diagram settings show only with it', () => {
    const { p, tab } = setup();
    expect(tab('Diagrams').getAttribute('aria-selected')).toBe('true');
    expect(p.element.querySelector<HTMLElement>('.cutlist-body')!.hidden).toBe(true);
    expect(p.element.querySelector<HTMLElement>('.diagrams-settings')!.hidden).toBe(false);
    tab('Parts').click();
    expect(p.element.querySelector<HTMLElement>('.cutlist-body')!.hidden).toBe(false);
    expect(p.element.querySelector<HTMLElement>('.diagrams')!.hidden).toBe(true);
    expect(p.element.querySelector<HTMLElement>('.diagrams-settings')!.hidden).toBe(true);
  });

  test('per material: its stock, sheet count and use; each sheet drawn with numbered parts, its parts and offcuts', () => {
    const { p } = setup();
    const ply = p.element.querySelectorAll('.diagrams-material')[0]!;
    expect(ply.querySelector('h3')!.textContent).toBe('Birch ply');
    expect(ply.querySelector('.diagrams-summary')!.textContent).toBe('12 mm, sheets 1525 mm × 1525 mm · 2 sheets (45% used) · Parts follow the grain along the sheet length');
    const pages = ply.querySelectorAll('.diagram-page');
    expect(pages).toHaveLength(2);
    expect(texts(pages[0]!, 'figcaption span')).toEqual(['Sheet 1 of 2', '46% used']);
    // Drawer side is 1, Panel 2 (list order); the first sheet holds a panel and the drawer side.
    expect(texts(pages[0]!, '.diagram-number').sort()).toEqual(['1', '2']);
    expect(texts(pages[1]!, '.diagram-number')).toEqual(['2']);
    const svg = pages[0]!.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 1525 1525');
    expect(svg.getAttribute('aria-label')).toBe('Birch ply, Sheet 1 of 2');
    expect([...pages[0]!.querySelectorAll('.diagrams-parts tbody tr')].map((r) => texts(r, 'td'))).toEqual([
      ['1', 'Drawer side', '450 mm', '180 mm', '1'],
      ['2', 'Panel', '1000 mm', '1000 mm', '1'],
    ]);
    expect(pages[0]!.querySelector('.diagrams-offcuts')!.textContent).toMatch(/^Offcuts: \d+ mm × \d+ mm/);
    // The oak top on a 2400 mm board.
    const oak = p.element.querySelectorAll('.diagrams-material')[1]!;
    expect(oak.querySelector('.diagrams-summary')!.textContent).toBe('18 mm, boards 2400 mm long · 1 board (35% used)');
    expect(texts(oak, 'figcaption span')).toEqual(['Board 1 of 1', '35% used']);
    expect(oak.querySelector('.diagrams-offcuts')!.textContent).toBe('Offcuts: 1537 mm');
    // The part with no material is named, not drawn.
    expect(p.element.querySelector('.diagrams > .cutlist-note')!.textContent).toBe('Not laid out: No material. Set sheet goods, or solid wood with a board length, in Materials.');
  });

  test('settings are typed in the file units, saved in the file, and the diagrams follow', () => {
    const { s, p, host, field } = setup();
    expect(field('Kerf').value).toBe('3 mm');
    expect(field('Trim').value).toBe('10 mm');
    expect(field('Smallest offcut').value).toBe('100 mm');
    expect((field('First cuts') as unknown as HTMLSelectElement).value).toBe('best');
    field('Trim').value = '0';
    field('Trim').dispatchEvent(new Event('change'));
    field('Kerf').value = '1/8"';
    field('Kerf').dispatchEvent(new Event('change'));
    expect(cutListSettings(s.doc)).toMatchObject({ trim: 0, kerf: 3.175 });
    field('Kerf').value = '60mm';
    field('Kerf').dispatchEvent(new Event('change'));
    expect(host.flash).toHaveBeenCalledWith('Type a length from 0 to 50 mm, such as 3mm or 1/8".', true);
    expect(cutListSettings(s.doc).kerf).toBe(3.175);
    const guillotine = p.element.querySelector<HTMLInputElement>('.diagrams-settings .cutlist-check input')!;
    guillotine.click();
    p.sync();
    expect(cutListSettings(s.doc).guillotine).toBe(false);
    expect((field('First cuts') as unknown as HTMLSelectElement).disabled).toBe(true);
    // Without trim the 1000 mm panels still need a sheet each: 1000 + 3.175 + 1000 > 1525.
    expect(p.element.querySelectorAll('.diagrams-material')[0]!.querySelectorAll('.diagram-page')).toHaveLength(2);
  });

  test('parts too large for the sheet are named with their number and count', () => {
    const { s, p, ply } = setup();
    const huge = part(s, 9000, 1600, 400, 12, 'Long shelf');
    ok(s.execute('core.paint', { instanceIds: [huge.instanceId], materialId: ply }));
    ok(s.execute('core.setMaterialStock', { materialId: ply, stock: { kind: 'sheet', thickness: 12, length: 1525, width: 1525, grain: true } }));
    p.sync();
    const ply0 = p.element.querySelectorAll('.diagrams-material')[0]!;
    expect(ply0.querySelector('.cutlist-warning')!.textContent).toBe('Too large to lay out: No. 2 Long shelf × 1.');
  });

  test('Print prints a copy of the diagrams in a page of its own, removed after printing', () => {
    const { p } = setup();
    const print = vi.fn(() => {
      const root = document.querySelector('.print-root')!;
      expect(root.classList.contains('print-diagrams')).toBe(true);
      expect(root.querySelectorAll('.diagram-page')).toHaveLength(3);
      expect(document.body.classList.contains('printing')).toBe(true);
    });
    window.print = print;
    [...p.element.querySelectorAll<HTMLButtonElement>('.cutlist-buttons button')].find((b) => b.textContent === 'Print')!.click();
    expect(print).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('afterprint'));
    expect(document.querySelector('.print-root')).toBeNull();
    expect(document.body.classList.contains('printing')).toBe(false);
  });
});
