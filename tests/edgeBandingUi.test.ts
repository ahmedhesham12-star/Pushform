// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest';
import { createSession, cutListSettings, definitionModel, type CommandSession, type CutListSettings } from '../src/commands';
import { partAxes, partEdges, type Edge } from '../src/cutlist';
import { listFaces } from '../src/kernel';
import { pathTransform } from '../src/scene';
import { CutListPanel, type CutListHost } from '../src/ui/cutListPanel';
import { EntityInfo, type EdgesField, type EntityInfoData, type EntityInfoHost } from '../src/ui/entityInfo';
import { MaterialsPanel, type MaterialsHost } from '../src/ui/materialsPanel';
import { Vector3 } from 'three';
import { findInstance } from '../src/scene';
import { createPaintBucketTool } from '../src/tools/paintBucket';
import type { PaintChoice, ToolContext } from '../src/tools/tool';
import { Frame } from '../src/viewport/frame';

/* Edge banding in the Cut List panel, the diagrams, Entity Info and Materials (milestone 6, step 6). */

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

function band(s: CommandSession, p: { instanceId: string; definitionId: string }, edges: Edge[], materialId: string) {
  const def = s.doc.scene.definitions.get(p.definitionId)!;
  const all = partEdges(s.doc.scene, def.model, partAxes(def.model, null, pathTransform(s.doc.scene, [p.instanceId]))!);
  for (const e of edges) ok(s.execute('core.paint', { definitionId: p.definitionId, faceIds: [...all[e].faceIds], materialId }));
}

/** A 600 x 300 melamine shelf, banded on one length edge and one width edge with white ABS at 0.50 a meter. */
function setup(withBand = true) {
  const s = createSession();
  ok(s.execute('core.setDisplayUnits', { unit: 'mm', precision: 0 }));
  const melamine = ok(s.execute('core.addMaterial', { starter: 'whiteMelamine' })).materialId;
  const p = part(s, 0, 600, 300, 18, 'Shelf');
  ok(s.execute('core.paint', { instanceIds: [p.instanceId], materialId: melamine }));
  if (withBand) {
    const abs = ok(s.execute('core.addMaterial', { starter: 'whiteAbsBand' })).materialId;
    ok(s.execute('core.setMaterialStock', { materialId: abs, stock: { kind: 'band', thickness: 1, width: 22, price: 0.5 } }));
    band(s, p, ['length1', 'width2'], abs);
  }
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
  const panel = new CutListPanel(host);
  document.body.replaceChildren(panel.element);
  panel.setOpen(true);
  return { s, p, panel };
}

const headers = (root: Element) => [...root.querySelectorAll('.cutlist-body thead th')].map((th) => th.textContent);

describe('the Cut List panel', () => {
  test('an Edge banding column only once the file has edge band; each row draws its banded edges', () => {
    expect(headers(setup(false).panel.element)).not.toContain('Edge banding');
    const { panel } = setup();
    expect(headers(panel.element)).toContain('Edge banding');
    const marks = panel.element.querySelector('.cutlist-edges svg')!;
    expect(marks.getAttribute('aria-label')).toBe('Length edge 1: White ABS edge band · Width edge 2: White ABS edge band');
    expect(marks.querySelectorAll('.edge-marks-band')).toHaveLength(2);
    expect(marks.querySelectorAll('.edge-marks-plain')).toHaveLength(2);
  });

  test('the band total in meters with the waste and its cost, counted in the total cost', () => {
    const { panel } = setup();
    const totals = [...panel.element.querySelectorAll('.cutlist-total')].map((r) => r.textContent);
    expect(totals).toContain('White ABS edge band: 0.90 m, 1.04 m with waste · 0.52');
    expect(panel.element.querySelector('.cutlist-grand')!.textContent).toBe('Total cost: 0.52');
  });

  test('Show cut sizes adds the cut length and width, saved in the file', () => {
    const { s, panel } = setup();
    expect(headers(panel.element)).not.toContain('Cut length');
    const check = [...panel.element.querySelectorAll('.cutlist-check')].find((l) => l.textContent === 'Show cut sizes (less edge banding)')!.querySelector('input')!;
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    expect(cutListSettings(s.doc).cutSize).toBe(true);
    panel.sync();
    const h = headers(panel.element);
    expect(h.slice(h.indexOf('Thickness'), h.indexOf('Thickness') + 3)).toEqual(['Thickness', 'Cut length', 'Cut width']);
    const cells = [...panel.element.querySelectorAll('.cutlist-row td')].map((td) => td.textContent);
    expect(cells.slice(3, 8)).toEqual(['600 mm', '300 mm', '18 mm', '599 mm', '299 mm']);
  });

  test('the diagrams mark each banded edge of a part', () => {
    const { panel } = setup();
    [...panel.element.querySelectorAll<HTMLButtonElement>('.cutlist-tab')].find((b) => b.textContent === 'Diagrams')!.click();
    const lines = [...panel.element.querySelectorAll('.diagram .diagram-band')];
    expect(lines).toHaveLength(2);
    // Laid out unturned: the length edge runs along the drawing, the width edge up it.
    const [a, b] = lines.map((l) => ['x1', 'y1', 'x2', 'y2'].map((k) => Number(l.getAttribute(k))));
    expect(a![1]).toBe(a![3]);
    expect(b![0]).toBe(b![2]);
  });
});

describe('Entity Info', () => {
  const host = (): EntityInfoHost => ({ renameDefinition: vi.fn(), renameInstance: vi.fn(), setTag: vi.fn(), setGrain: vi.fn(), setEdgeBand: vi.fn(), previewEdge: vi.fn(), setHardware: vi.fn() });
  const data = (edges: EdgesField): EntityInfoData => ({
    kind: 'instance',
    type: 'component',
    definitionId: 'd1',
    instanceId: 'i2',
    definitionName: 'Shelf',
    instanceName: '',
    copies: 1,
    volume: null,
    scale: null,
    stretched: false,
    tag: { value: null, options: [] },
    material: 'Default',
    grain: null,
    edges,
  });
  const field = (options: EdgesField['options']): EdgesField => ({
    edges: { length1: { faceIds: ['f1'], band: 'm3' }, length2: { faceIds: ['f2'], band: null }, width1: { faceIds: [], band: null }, width2: { faceIds: ['f4', 'f5'], band: null } },
    options,
  });

  test('a menu per edge; picking a band bands its side faces; an edge with no straight face cannot be banded', () => {
    const h = host();
    const info = new EntityInfo(h);
    document.body.replaceChildren(info.element);
    info.show(data(field([{ value: 'm3', name: 'White ABS' }])));
    const labels = [...info.element.querySelectorAll('label')].map((l) => l.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Length edge 1', 'Length edge 2', 'Width edge 1', 'Width edge 2']));
    const selects = [...info.element.querySelectorAll('select')].slice(-4);
    expect(selects.map((s) => s.value)).toEqual(['m3', '', '', '']);
    expect(selects[2]!.disabled).toBe(true);
    selects[3]!.value = 'm3';
    selects[3]!.dispatchEvent(new Event('change'));
    expect(h.setEdgeBand).toHaveBeenCalledWith('width2', 'm3');
    selects[0]!.value = '';
    selects[0]!.dispatchEvent(new Event('change'));
    expect(h.setEdgeBand).toHaveBeenCalledWith('length1', null);
  });

  test('pointing at an edge outlines it, and the outline goes with the rows', () => {
    const h = host();
    const info = new EntityInfo(h);
    document.body.replaceChildren(info.element);
    info.show(data(field([{ value: 'm3', name: 'White ABS' }])));
    const select = [...info.element.querySelectorAll('select')].at(-1)!;
    select.dispatchEvent(new Event('focus'));
    expect(h.previewEdge).toHaveBeenLastCalledWith(['f4', 'f5']);
    info.show({ kind: 'none' });
    expect(h.previewEdge).toHaveBeenLastCalledWith(null);
  });

  test('without an edge band in the file, a hint says where to make one', () => {
    const info = new EntityInfo(host());
    info.show(data(field([])));
    expect(info.element.querySelector('.entity-info-hint')!.textContent).toBe('No edge band in this file yet. Add White ABS or Oak veneer edge band from the Starter set in Materials, or set a material to be bought as Edge band.');
  });
});

describe('Entity Info, more', () => {
  const host = (): EntityInfoHost => ({ renameDefinition: vi.fn(), renameInstance: vi.fn(), setTag: vi.fn(), setGrain: vi.fn(), setEdgeBand: vi.fn(), previewEdge: vi.fn(), setHardware: vi.fn() });
  const instance = (edges: Extract<EntityInfoData, { kind: 'instance' }>['edges']): EntityInfoData => ({
    kind: 'instance',
    type: 'component',
    definitionId: 'd1',
    instanceId: 'i2',
    definitionName: 'Drawer',
    instanceName: '',
    copies: 1,
    volume: null,
    scale: null,
    stretched: false,
    tag: { value: null, options: [] },
    material: 'Default',
    grain: null,
    ...(edges ? { edges } : {}),
  });

  test('the starter bands are in the menus; picking one passes its value', () => {
    const h = host();
    const info = new EntityInfo(h);
    document.body.replaceChildren(info.element);
    const none = { faceIds: ['f1'], band: null };
    info.show(instance({ edges: { length1: none, length2: none, width1: none, width2: none }, options: [{ value: 'starter:whiteAbsBand', name: 'White ABS edge band (starter)' }] }));
    const select = [...info.element.querySelectorAll('select')].at(-1)!;
    expect([...select.options].map((o) => o.textContent)).toEqual(['None', 'White ABS edge band (starter)']);
    select.value = 'starter:whiteAbsBand';
    select.dispatchEvent(new Event('change'));
    expect(h.setEdgeBand).toHaveBeenCalledWith('width2', 'starter:whiteAbsBand');
  });

  test('an assembly says where banding is set', () => {
    const info = new EntityInfo(host());
    info.show(instance('assembly'));
    expect(info.element.querySelector('.entity-info-hint')!.textContent).toBe('Edge banding is set per part: open this one and select a part in it.');
  });
});

describe('the Paint Bucket with an edge band', () => {
  /** A shelf part, closed, and a drawer assembly holding a side. */
  function setup() {
    const s = createSession();
    const shelf = part(s, 0, 600, 300, 18, 'Shelf');
    const side = part(s, 1000, 450, 12, 180, 'Drawer side');
    const drawer = ok(s.execute('core.makeComponent', { instanceIds: [side.instanceId], name: 'Drawer' }));
    let choice: PaintChoice = { starter: 'whiteAbsBand' };
    let under: { id: string; path: string[] } | null = null;
    const flash = vi.fn();
    const showFacesPreview = vi.fn();
    const clearPreview = vi.fn();
    const ctx = {
      session: s,
      selection: { faces: new Set(), edges: new Set(), instances: new Set(), guides: new Set(), annotations: new Set(), hovered: null },
      paint: { current: () => choice, set: (c: PaintChoice) => (choice = c) },
      contextPath: () => [],
      flash,
      flashError: (e: { code: string }) => {
        throw new Error(e.code);
      },
      viewport: {
        frame: Frame.ROOT,
        pick: () => under && { kind: 'instance', id: under.path[0]!, point: new Vector3() },
        faceUnderCursor: () => under && { path: under.path, faceId: under.id, side: 'front', model: definitionModel(s.doc, findInstance(s.doc.scene, under.path.at(-1)!)!.instance.definitionId)! },
        showFacesPreview,
        clearPreview,
      },
    } as unknown as ToolContext;
    const tool = createPaintBucketTool(ctx);
    const click = (id: string, path: string[]) => {
      under = { id, path };
      tool.down!({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false } as PointerEvent);
    };
    const hover = (id: string | null, path: string[] = []) => {
      under = id ? { id, path } : null;
      tool.move!({} as PointerEvent);
    };
    const paintWith = (c: PaintChoice) => (choice = c);
    return { s, shelf, side, drawer, click, hover, paintWith, flash, tool, showFacesPreview, clearPreview, choice: () => choice };
  }
  const faces = (s: CommandSession, definitionId: string) => listFaces(s.doc.scene.definitions.get(definitionId)!.model);

  test('a click on a side face of a closed part bands that edge; again takes it off; the hint says so', () => {
    const { s, shelf, click, flash, tool, choice } = setup();
    expect(tool.hint()).toContain('Click a side face of a part to band that edge');
    const front = faces(s, shelf.definitionId).find((f) => f.normal[2] > 0.99)!.id;
    click(front, [shelf.instanceId]);
    const abs = [...s.doc.scene.materials].find(([, m]) => m.name === 'White ABS edge band')![0];
    expect(choice()).toEqual({ materialId: abs });
    expect(flash).toHaveBeenLastCalledWith('Shelf: Length edge 2 banded with White ABS edge band.');
    // The part is not painted as a whole.
    expect(findInstance(s.doc.scene, shelf.instanceId)!.instance.material).toBeUndefined();
    click(front, [shelf.instanceId]);
    expect(flash).toHaveBeenLastCalledWith('Shelf: band taken off Length edge 2.');
    expect(faces(s, shelf.definitionId).find((f) => f.id === front)!.paint).toBeUndefined();
  });

  test('a broad face, or an assembly, is refused with a word on why', () => {
    const { s, shelf, side, drawer, click, flash } = setup();
    const top = faces(s, shelf.definitionId).find((f) => f.normal[1] > 0.99)!.id;
    click(top, [shelf.instanceId]);
    expect(flash).toHaveBeenLastCalledWith("Edge band goes on a part's edges: click one of its narrow side faces.", true);
    // Inside the closed drawer, the click reaches its side part.
    const end = faces(s, side.definitionId).find((f) => f.normal[0] > 0.99)!.id;
    click(end, [drawer.instanceId, side.instanceId]);
    expect(flash).toHaveBeenLastCalledWith('Drawer side: Width edge 2 banded with White ABS edge band.');
    expect(s.doc.scene.materials.size).toBe(1);
  });

  test('hovering a part shows its banded edges filled and the edge a click bands outlined', () => {
    const { s, shelf, click, hover, paintWith, showFacesPreview, clearPreview } = setup();
    const front = faces(s, shelf.definitionId).find((f) => f.normal[2] > 0.99)!.id;
    const end = faces(s, shelf.definitionId).find((f) => f.normal[0] > 0.99)!.id;
    click(front, [shelf.instanceId]);
    hover(end, [shelf.instanceId]);
    const shown = showFacesPreview.mock.lastCall![0] as { points: Vector3[]; filled: boolean; outlined: boolean }[];
    expect(shown.map((f) => [f.filled, f.outlined])).toEqual([[true, false], [false, true]]);
    // In world coordinates: the banded front face is at z = 300 (the shelf is 300 deep).
    expect(shown[0]!.points.every((p) => Math.abs(p.z - 300) < 1e-6)).toBe(true);
    hover(null);
    expect(clearPreview).toHaveBeenCalledTimes(1);
    // Painting with a plain material shows nothing, as in SketchUp.
    paintWith({ materialId: null });
    showFacesPreview.mockClear();
    hover(end, [shelf.instanceId]);
    expect(showFacesPreview).not.toHaveBeenCalled();
  });
});

describe('the Materials panel', () => {
  test('Edge band stock: thickness, band width and price per meter, no grain', () => {
    const s = createSession();
    const id = ok(s.execute('core.addMaterial', { starter: 'whiteAbsBand' })).materialId;
    const setStock = vi.fn();
    const h: MaterialsHost = {
      scene: () => s.doc.scene,
      units: () => s.doc.units,
      starters: () => [],
      stock: () => true,
      current: () => ({ materialId: id }),
      choose: vi.fn(),
      add: vi.fn(),
      rename: vi.fn(),
      setColor: vi.fn(),
      setTexture: vi.fn(),
      setStock,
      duplicate: vi.fn(),
      remove: vi.fn(),
      flash: vi.fn(),
    };
    const panel = new MaterialsPanel(h);
    document.body.replaceChildren(panel.element);
    panel.sync();
    const labels = [...panel.element.querySelectorAll('.materials-field > span')].map((x) => x.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Bought as', 'Thickness', 'Band width', 'Price per meter']));
    expect(labels).not.toContain('Sheet length');
    expect(panel.element.querySelector('.materials-check')).toBeNull();
    const kind = panel.element.querySelector('.materials-field select') as HTMLSelectElement;
    expect(kind.value).toBe('band');
    kind.value = 'sheet';
    kind.dispatchEvent(new Event('change'));
    // A band's 1 mm does not carry over to a board.
    expect(setStock).toHaveBeenCalledWith(id, { kind: 'sheet', thickness: 18, length: 2440, width: 1220, grain: false });
  });
});
