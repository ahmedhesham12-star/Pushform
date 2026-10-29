// @vitest-environment happy-dom
import { Vector3 } from 'three';
import { describe, expect, test, vi } from 'vitest';
import { createSession, definitionModel, type CommandSession } from '../src/commands';
import { getFace, listFaces, type FaceSide } from '../src/kernel';
import { findInstance } from '../src/scene';
import { createPaintBucketTool } from '../src/tools/paintBucket';
import { fillFor, paintTargets } from '../src/tools/paintTargets';
import type { PaintChoice, ToolContext } from '../src/tools/tool';
import { MaterialsPanel, type MaterialsHost } from '../src/ui/materialsPanel';
import { Frame } from '../src/viewport/frame';

/* The Paint Bucket (milestone 5, step 6): which faces a click paints, sampling, and the Materials panel. */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

/** Two boxes side by side on the ground, touching (one connected piece), and a third apart. */
function scene() {
  const s = createSession();
  const box = (x: number) => {
    const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [x, 0, 0], width: 100, depth: 100 }));
    ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: 100 }));
  };
  box(0);
  box(100);
  box(500);
  return s;
}
const model = (s: CommandSession) => definitionModel(s.doc)!;
const tops = (s: CommandSession) => listFaces(model(s)).filter((f) => f.normal[1] === 1).sort((a, b) => a.outer[0]![0] - b.outer[0]![0]);

describe('what a click paints', () => {
  test('one face; adjacent faces of the same material; all of them; those of the same connected piece', () => {
    const s = scene();
    const m = model(s);
    const [a, b, c] = tops(s).map((f) => f.id);
    expect(paintTargets(m, a!, 'front', 'one')).toEqual([a]);
    // Unpainted everywhere: adjacent spreads over the first two boxes, all takes every face.
    expect(paintTargets(m, a!, 'front', 'adjacent').length).toBe(10);
    expect(paintTargets(m, a!, 'front', 'all').length).toBe(16);
    expect(paintTargets(m, a!, 'front', 'object').length).toBe(10);
    const red = ok(s.execute('core.addMaterial', { color: '#cc0000' })).materialId;
    ok(s.execute('core.paint', { faceIds: [b!, c!], materialId: red }));
    // Adjacent stops at faces of another material; all finds the far one too.
    expect(paintTargets(model(s), b!, 'front', 'adjacent')).toEqual([b]);
    expect(paintTargets(model(s), b!, 'front', 'all').sort()).toEqual([b!, c!].sort());
    expect(paintTargets(model(s), b!, 'front', 'object')).toEqual([b]);
  });

  test('modifiers: Ctrl (Option on a Mac) adjacent, Shift all, both the connected piece', () => {
    const e = (o: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean }>) => ({ shiftKey: false, ctrlKey: false, altKey: false, ...o });
    expect(fillFor(e({}), false)).toBe('one');
    expect(fillFor(e({ ctrlKey: true }), false)).toBe('adjacent');
    expect(fillFor(e({ altKey: true }), true)).toBe('adjacent');
    expect(fillFor(e({ ctrlKey: true }), true)).toBe('one');
    expect(fillFor(e({ shiftKey: true }), false)).toBe('all');
    expect(fillFor(e({ shiftKey: true, ctrlKey: true }), false)).toBe('object');
  });
});

describe('the Paint Bucket tool', () => {
  function tool(s: CommandSession) {
    let choice: PaintChoice = { materialId: null };
    let under: { kind: 'face' | 'instance' | 'outside'; id: string; side: FaceSide; path?: string[] } | null = null;
    const selection = { faces: new Set<string>(), edges: new Set<string>(), instances: new Set<string>(), guides: new Set<string>(), annotations: new Set<string>(), hovered: null };
    const flash = vi.fn();
    const ctx = {
      session: s,
      selection,
      paint: { current: () => choice, set: (c: PaintChoice) => (choice = c) },
      contextPath: () => [],
      flash,
      flashError: (e: { code: string }) => {
        throw new Error(e.code);
      },
      viewport: {
        frame: Frame.ROOT,
        pick: () => under && { kind: under.kind, id: under.id, point: new Vector3(), ...(under.kind === 'outside' ? { path: under.path } : {}) },
        faceUnderCursor: () =>
          under && under.kind !== 'instance' ? { path: under.path ?? [], faceId: under.id, side: under.side, model: definitionModel(s.doc, under.path?.length ? findInstance(s.doc.scene, under.path.at(-1)!)!.instance.definitionId : undefined)! } : null,
      },
    } as unknown as ToolContext;
    const t = createPaintBucketTool(ctx);
    const click = (u: typeof under, mods: Partial<PointerEvent> = {}) => {
      under = u;
      t.down!({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods } as PointerEvent);
    };
    return { click, selection, flash, choose: (c: PaintChoice) => (choice = c), choice: () => choice };
  }

  test('paints the side clicked; a starter material comes into the file and stays the current one', () => {
    const s = scene();
    const [a] = tops(s).map((f) => f.id);
    const t = tool(s);
    t.choose({ starter: 'oak' });
    t.click({ kind: 'face', id: a!, side: 'back' });
    const oak = [...s.doc.scene.materials.keys()][0]!;
    expect(getFace(model(s), a!)!.paint).toEqual({ back: oak });
    expect(t.choice()).toEqual({ materialId: oak });
    t.click({ kind: 'face', id: a!, side: 'front' });
    expect(getFace(model(s), a!)!.paint).toEqual({ front: oak, back: oak });
    expect(s.doc.scene.materials.size).toBe(1);
  });

  test('a selected face paints the whole selection; Ctrl fills adjacent faces; Default takes paint off', () => {
    const s = scene();
    const [a, b, c] = tops(s).map((f) => f.id);
    const t = tool(s);
    const red = ok(s.execute('core.addMaterial', { color: '#cc0000' })).materialId;
    t.choose({ materialId: red });
    t.selection.faces.add(a!).add(c!);
    t.click({ kind: 'face', id: a!, side: 'front' });
    expect([a, b, c].map((f) => getFace(model(s), f!)!.paint?.front)).toEqual([red, undefined, red]);
    t.selection.faces.clear();
    t.click({ kind: 'face', id: b!, side: 'front' }, { ctrlKey: true });
    // The nine unpainted faces of the joined boxes, b among them, reached from b; with a and c already red.
    expect(listFaces(model(s)).filter((f) => f.paint?.front === red).length).toBe(9 + 2);
    t.choose({ materialId: null });
    t.click({ kind: 'face', id: c!, side: 'front' });
    expect(getFace(model(s), c!)!.paint).toBeUndefined();
  });

  test('a group or component is painted as a whole; Alt picks up the material a face shows', () => {
    const s = scene();
    const faces = listFaces(model(s))
      .filter((f) => f.outer.every((p) => p[0] >= 500))
      .map((f) => f.id);
    const g = ok(s.execute('core.makeGroup', { faceIds: faces }));
    const t = tool(s);
    const red = ok(s.execute('core.addMaterial', { color: '#cc0000' })).materialId;
    t.choose({ materialId: red });
    t.click({ kind: 'instance', id: g.instanceId, side: 'front' });
    expect(findInstance(s.doc.scene, g.instanceId)!.instance.material).toBe(red);
    t.choose({ materialId: null });
    const inside = listFaces(definitionModel(s.doc, g.definitionId)!)[0]!.id;
    t.click({ kind: 'outside', id: inside, side: 'front', path: [g.instanceId] }, { altKey: true });
    expect(t.choice()).toEqual({ materialId: red });
    expect(t.flash).toHaveBeenLastCalledWith(expect.stringMatching(/Picked up/));
    // Clicking a face inside it without opening it says how to.
    t.click({ kind: 'outside', id: inside, side: 'front', path: [g.instanceId] });
    expect(t.flash).toHaveBeenLastCalledWith(expect.stringMatching(/Open the group/), true);
  });
});

describe('the Materials panel', () => {
  function panel(s: CommandSession) {
    let choice: PaintChoice = { materialId: null };
    const host: MaterialsHost = {
      scene: () => s.doc.scene,
      units: () => s.doc.units,
      current: () => choice,
      choose: vi.fn((c: PaintChoice) => void (choice = c)),
      add: vi.fn(() => void ok(s.execute('core.addMaterial', {}))),
      rename: vi.fn((materialId, name) => void ok(s.execute('core.renameMaterial', { materialId, name }))),
      setColor: vi.fn((materialId, color) => void ok(s.execute('core.setMaterialColor', { materialId, color }))),
      setTexture: vi.fn((materialId, texture) => void ok(s.execute('core.setMaterialTexture', { materialId, texture }))),
      setStock: vi.fn((materialId, stock) => void ok(s.execute('core.setMaterialStock', { materialId, stock }))),
      duplicate: vi.fn(),
      remove: vi.fn((materialId) => void ok(s.execute('core.deleteMaterial', { materialId }))),
      flash: vi.fn(),
    };
    const p = new MaterialsPanel(host);
    document.body.replaceChildren(p.element);
    p.sync();
    const swatches = (i: number) => [...p.element.querySelectorAll('.materials-swatches')[i]!.querySelectorAll('.materials-swatch')].map((b) => b.getAttribute('aria-label'));
    return { p, host, swatches };
  }

  test('Default and the model materials, then starters not yet in the model; a click chooses one', () => {
    const s = createSession();
    ok(s.execute('core.addMaterial', { starter: 'oak' }));
    const { p, host, swatches } = panel(s);
    expect(swatches(0)).toEqual(['Default', 'Oak']);
    expect(swatches(1)).toEqual(['Birch ply', 'Walnut', 'White MDF', 'White melamine', 'Painted sage', 'Painted navy', 'Painted charcoal', 'Painted cream']);
    (p.element.querySelectorAll('.materials-swatches')[1]!.querySelector('.materials-swatch') as HTMLButtonElement).click();
    expect(host.choose).toHaveBeenCalledWith({ starter: 'birchPly' });
    p.sync();
    expect(p.element.querySelector('.materials-current')!.textContent).toBe('Painting with Birch ply');
    expect(p.element.querySelector('[aria-pressed="true"]')!.getAttribute('aria-label')).toBe('Birch ply');
  });

  test('the chosen model material can be renamed, recolored, given a tile size and deleted', () => {
    const s = createSession();
    const id = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    ok(s.execute('core.setDisplayUnits', { unit: 'mm', precision: 0 }));
    ok(s.execute('core.setMaterialTexture', { materialId: id, texture: { data: 'iVBORw0KGgo=', mime: 'image/png', width: 600, height: 300 } }));
    const { p, host } = panel(s);
    host.choose({ materialId: id });
    p.sync();
    const fields = [...p.element.querySelectorAll<HTMLInputElement>('.materials-editor input:not([type=file])')];
    const [name, color, tile] = fields;
    expect([name!.value, color!.value, tile!.value]).toEqual(['Oak', '#c8a165', '600 mm']);
    tile!.value = '900';
    tile!.dispatchEvent(new Event('change'));
    expect(s.doc.scene.materials.get(id)!.texture).toMatchObject({ width: 900, height: 450 });
    tile!.value = 'abc';
    tile!.dispatchEvent(new Event('change'));
    expect(host.flash).toHaveBeenCalledWith('Type the width of one tile of the image, such as 600mm.', true);
    name!.value = 'Oak, rift sawn';
    name!.dispatchEvent(new Event('change'));
    expect(s.doc.scene.materials.get(id)!.name).toBe('Oak, rift sawn');
    const del = [...p.element.querySelectorAll<HTMLButtonElement>('.materials-action')].find((b) => b.textContent === 'Delete')!;
    del.click();
    expect(s.doc.scene.materials.size).toBe(0);
  });

  test('the stock form: paint only, sheet goods with a typed thickness and price, solid wood priced per board foot', () => {
    const s = createSession();
    const id = ok(s.execute('core.addMaterial', {})).materialId;
    ok(s.execute('core.setDisplayUnits', { unit: 'mm', precision: 1 }));
    const { p, host } = panel(s);
    host.choose({ materialId: id });
    p.sync();
    const kind = () => p.element.querySelector<HTMLSelectElement>('.materials-editor select')!;
    expect(kind().value).toBe('none');
    kind().value = 'sheet';
    kind().dispatchEvent(new Event('change'));
    p.sync();
    expect(s.doc.scene.materials.get(id)!.stock).toEqual({ kind: 'sheet', thickness: 18, length: 2440, width: 1220, grain: false });
    const field = (label: string) =>
      [...p.element.querySelectorAll('.materials-field')].find((f) => f.firstChild!.textContent === label)!.querySelector('input') as HTMLInputElement;
    expect(field('Thickness').getAttribute('list')).toBeTruthy();
    field('Thickness').value = '3/4"';
    field('Thickness').dispatchEvent(new Event('change'));
    p.sync();
    field('Price per sheet').value = '45,50';
    field('Price per sheet').dispatchEvent(new Event('change'));
    p.sync();
    expect(s.doc.scene.materials.get(id)!.stock).toMatchObject({ thickness: 19.05, price: 45.5 });
    field('Sheet width').value = 'wide';
    field('Sheet width').dispatchEvent(new Event('change'));
    expect(host.flash).toHaveBeenCalledWith('Type a length, such as 18mm or 3/4".', true);
    kind().value = 'solid';
    kind().dispatchEvent(new Event('change'));
    p.sync();
    const per = p.element.querySelectorAll<HTMLSelectElement>('.materials-editor select')[1]!;
    per.value = 'boardFoot';
    per.dispatchEvent(new Event('change'));
    expect(s.doc.scene.materials.get(id)!.stock).toEqual({ kind: 'solid', thickness: 19.05, per: 'boardFoot', grain: true });
  });
});
