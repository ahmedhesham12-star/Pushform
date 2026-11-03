import { describe, expect, test } from 'vitest';
import { createSession, definitionModel, type CommandSession } from '../src/commands';
import { boardFeet, cutList, toCsv, type CutList } from '../src/cutlist';
import { listFaces } from '../src/kernel';

/*
 * The cut list engine (milestone 5, step 9). Boxes are drawn on the ground,
 * width along red (x), depth along green (z), pushed up by the height (blue, y).
 */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

/** A box made a group (or a named component) in the root; returns its instance and definition. */
function part(s: CommandSession, x: number, w: number, d: number, h: number, name?: string) {
  const faces = () => listFaces(definitionModel(s.doc)!).map((f) => f.id);
  const before = new Set(faces());
  const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [x, 0, 0], width: w, depth: d }));
  ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: h }));
  const faceIds = faces().filter((f) => !before.has(f));
  return name ? ok(s.execute('core.makeComponent', { faceIds, name })) : ok(s.execute('core.makeGroup', { faceIds }));
}

const OPTIONS = { waste: 0.15, includeHidden: false };
const list = (s: CommandSession, options = OPTIONS) => cutList(s.doc.scene, options);
/** Rows as [name, quantity, length, width, thickness], sizes rounded to 0.01 mm. */
const rows = (l: CutList) => l.rows.map((r) => [r.name, r.quantity, ...[r.length, r.width, r.thickness].map((v) => Math.round(v * 100) / 100)]);

describe('parts', () => {
  test('leaf groups and components anywhere are parts; assemblies are not, and loose faces in one are reported', () => {
    const s = createSession();
    const side = part(s, 0, 18, 500, 720, 'Side');
    const bottom = part(s, 100, 764, 482, 18, 'Bottom');
    const carcass = ok(s.execute('core.makeComponent', { instanceIds: [side.instanceId, bottom.instanceId], name: 'Carcass' }));
    ok(s.execute('core.copyInstances', { instanceIds: [carcass.instanceId], translation: [2000, 0, 0] }));
    expect(rows(list(s))).toEqual([
      ['Bottom', 2, 764, 482, 18],
      ['Side', 2, 720, 500, 18],
    ]);
    expect(list(s).looseInAssemblies).toEqual([]);
    // A loose face inside the assembly is not a part; the list says so.
    ok(s.execute('core.drawRectangle', { definitionId: carcass.definitionId, faceId: null, corner: [0, 0, 600], width: 100, depth: 100 }));
    expect(list(s).looseInAssemblies.map((a) => a.name)).toEqual(['Carcass', 'Carcass']);
  });

  test('sizes are along the part own axes: turning, mirroring and uniform scale keep them right; a stretch is flagged', () => {
    const s = createSession();
    const a = part(s, 0, 600, 300, 18, 'Shelf');
    const copies = [1000, 2000].map((z) => ok(s.execute('core.copyInstances', { instanceIds: [a.instanceId], translation: [0, 0, z] })).instanceIds[0]!);
    ok(s.execute('core.rotate', { instanceIds: [copies[0]!], center: [0, 0, 1000], axis: [0, 1, 0], angle: 37 }));
    ok(s.execute('core.flip', { instanceIds: [copies[1]!], axis: 'red' }));
    expect(rows(list(s))).toEqual([['Shelf', 3, 600, 300, 18]]);
    // Twice the size, uniformly: a new row with doubled sizes, no warning.
    ok(s.execute('core.scale', { instanceIds: [a.instanceId], origin: [0, 0, 0], axes: [], factor: 2, sizes: [600] }));
    const l = list(s);
    expect(rows(l)).toEqual([
      ['Shelf', 1, 1200, 600, 36],
      ['Shelf', 2, 600, 300, 18],
    ]);
    expect(l.rows[0]!.warnings).not.toContain('stretched');
    // Stretched along red only.
    ok(s.execute('core.scale', { instanceIds: [a.instanceId], origin: [0, 0, 0], axes: [[1, 0, 0]], factor: 0.5, sizes: [1200] }));
    const stretched = list(s).rows.find((r) => r.quantity === 1)!;
    expect([stretched.length, stretched.width, stretched.thickness]).toEqual([600, 600, 36]);
    expect(stretched.warnings).toContain('stretched');
  });

  test('a grain direction sets the length; components share it', () => {
    const s = createSession();
    const p = part(s, 0, 600, 300, 18, 'Door');
    ok(s.execute('core.copyInstances', { instanceIds: [p.instanceId], translation: [0, 0, 1000] }));
    // Grain along green (z): the 300 mm side becomes the length.
    ok(s.execute('core.setGrain', { definitionId: p.definitionId, grain: 'green' }));
    const l = list(s);
    expect(rows(l)).toEqual([['Door', 2, 300, 600, 18]]);
    expect(l.rows[0]!.grain).toBe('green');
    ok(s.execute('core.setGrain', { definitionId: p.definitionId, grain: null }));
    expect(rows(list(s))).toEqual([['Door', 2, 600, 300, 18]]);
  });

  test('grouping: one definition or shared geometry, the same size, material and name', () => {
    const s = createSession();
    const g = part(s, 0, 400, 200, 18);
    const [copy] = ok(s.execute('core.copyInstances', { instanceIds: [g.instanceId], translation: [0, 0, 500] })).instanceIds;
    // Copied groups share their geometry until one is edited: one row.
    expect(rows(list(s))).toEqual([['Group', 2, 400, 200, 18]]);
    ok(s.execute('core.renameInstance', { instanceId: copy!, name: 'Rail' }));
    expect(rows(list(s))).toEqual([
      ['Group', 1, 400, 200, 18],
      ['Rail', 1, 400, 200, 18],
    ]);
    const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    ok(s.execute('core.renameInstance', { instanceId: copy!, name: '' }));
    ok(s.execute('core.paint', { instanceIds: [copy!], materialId: oak }));
    expect(list(s).rows.map((r) => [r.quantity, r.materialId])).toEqual([
      [1, oak],
      [1, null],
    ]);
  });
});

describe('materials and warnings', () => {
  test('a part takes the material most of its area shows: its own faces, else what is passed down', () => {
    const s = createSession();
    const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    const ply = ok(s.execute('core.addMaterial', { starter: 'birchPly' })).materialId;
    const p = part(s, 0, 600, 300, 18, 'Panel');
    const faces = listFaces(definitionModel(s.doc, p.definitionId)!);
    const small = faces.filter((f) => f.normal[1] === 0).map((f) => f.id);
    // The four edges in oak: less area than the two big faces, which show the instance's ply.
    ok(s.execute('core.paint', { definitionId: p.definitionId, faceIds: small, materialId: oak }));
    ok(s.execute('core.paint', { instanceIds: [p.instanceId], materialId: ply }));
    expect(list(s).rows[0]!.materialId).toBe(ply);
    const asm = ok(s.execute('core.makeGroup', { instanceIds: [p.instanceId] }));
    // Without the instance material, the painted edges give the part its material: unpainted faces do not count.
    ok(s.execute('core.paint', { definitionId: asm.definitionId, instanceIds: [p.instanceId], materialId: null }));
    expect(list(s).rows[0]!.materialId).toBe(oak);
    ok(s.execute('core.paint', { instanceIds: [asm.instanceId], materialId: ply }));
    expect(list(s).rows[0]!.materialId).toBe(ply);
  });

  test('warnings: a thickness off the stock, a part that is not a solid, a part with no material', () => {
    const s = createSession();
    const ply = ok(s.execute('core.addMaterial', { starter: 'birchPly' })).materialId;
    const p15 = part(s, 0, 600, 300, 15, 'Thin');
    ok(s.execute('core.paint', { instanceIds: [p15.instanceId], materialId: ply }));
    const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 2000], width: 100, depth: 100 }));
    ok(s.execute('core.makeGroup', { faceIds: r.faceIds }));
    const byName = (n: string) => list(s).rows.find((x) => x.name === n)!.warnings;
    expect(byName('Thin')).toEqual(['thickness']);
    expect(byName('Group')).toEqual(['notSolid', 'noMaterial']);
    const p12 = part(s, 1000, 600, 300, 12, 'Right');
    ok(s.execute('core.paint', { instanceIds: [p12.instanceId], materialId: ply }));
    expect(byName('Right')).toEqual([]);
  });

  test('hidden parts are left out and counted, unless the switch lists them', () => {
    const s = createSession();
    const tag = ok(s.execute('core.addTag', { name: 'Doors' })).tagId;
    const door = part(s, 0, 600, 400, 18, 'Door');
    part(s, 1000, 600, 400, 18, 'Shelf');
    const asm = ok(s.execute('core.makeGroup', { instanceIds: [door.instanceId] }));
    ok(s.execute('core.setTag', { instanceIds: [asm.instanceId], tagId: tag }));
    ok(s.execute('core.setTagVisible', { tagId: tag, visible: false }));
    expect(rows(list(s)).map((r) => r[0])).toEqual(['Shelf']);
    expect(list(s).hiddenLeftOut).toBe(1);
    const all = list(s, { ...OPTIONS, includeHidden: true });
    expect(rows(all).map((r) => r[0])).toEqual(['Door', 'Shelf']);
    expect(all.hiddenLeftOut).toBe(0);
  });
});

describe('totals', () => {
  test('sheet goods: area, sheets with waste rounded up, cost per sheet', () => {
    const s = createSession();
    const ply = ok(s.execute('core.addMaterial', { starter: 'birchPly' })).materialId;
    ok(s.execute('core.setMaterialStock', { materialId: ply, stock: { kind: 'sheet', thickness: 12, length: 1525, width: 1525, price: 80, grain: true } }));
    const p = part(s, 0, 1000, 1000, 12, 'Big');
    ok(s.execute('core.copyInstances', { instanceIds: [p.instanceId], translation: [0, 0, 2000] }));
    ok(s.execute('core.paint', { instanceIds: [...s.doc.scene.definitions.get(s.doc.scene.rootId)!.instances.keys()], materialId: ply }));
    const [total] = list(s).totals;
    expect(total!.area).toBeCloseTo(2e6, 6);
    // 2 m² with 15% waste over 2.325625 m² sheets: 0.99 of a sheet, so 1.
    expect(total!.sheets!.exact).toBeCloseTo((2e6 * 1.15) / (1525 * 1525), 9);
    expect(total!.sheets!.count).toBe(1);
    expect(total!.cost).toBe(80);
    expect(list(s, { ...OPTIONS, waste: 0.2 }).totals[0]!.sheets!.count).toBe(2);
  });

  test('solid wood: board volume with waste, priced per cubic meter or per board foot', () => {
    const s = createSession();
    const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    const top = part(s, 0, 840, 540, 18, 'Top');
    ok(s.execute('core.paint', { instanceIds: [top.instanceId], materialId: oak }));
    ok(s.execute('core.setMaterialStock', { materialId: oak, stock: { kind: 'solid', thickness: 18, price: 2000, per: 'cubicMeter', grain: true } }));
    const volume = 840 * 540 * 18 * 1.15;
    let t = list(s).totals[0]!;
    expect(t.boardVolume).toBeCloseTo(volume, 6);
    expect(t.cost).toBeCloseTo((volume / 1e9) * 2000, 9);
    ok(s.execute('core.setMaterialStock', { materialId: oak, stock: { kind: 'solid', thickness: 18, price: 12, per: 'boardFoot', grain: true } }));
    t = list(s).totals[0]!;
    expect(t.cost).toBeCloseTo(boardFeet(volume) * 12, 9);
    expect(boardFeet(25.4 * 25.4 * 25.4 * 144)).toBeCloseTo(1, 12);
  });

  test('no price, no cost; no stock, no sheets or board volume', () => {
    const s = createSession();
    const sage = ok(s.execute('core.addMaterial', { starter: 'paintedSage' })).materialId;
    const p = part(s, 0, 600, 300, 18, 'Front');
    ok(s.execute('core.paint', { instanceIds: [p.instanceId], materialId: sage }));
    expect(list(s).totals[0]).toMatchObject({ quantity: 1, sheets: null, boardVolume: null, cost: null });
  });
});

describe('CSV', () => {
  test('one line per row, grouped by material; numbers in the file unit; quoted where needed', () => {
    const s = createSession();
    ok(s.execute('core.setDisplayUnits', { unit: 'mm', precision: 1 }));
    const ply = ok(s.execute('core.addMaterial', { starter: 'birchPly', name: 'Birch ply, 12' })).materialId;
    const side = part(s, 0, 450, 180, 12, 'Drawer side');
    ok(s.execute('core.copyInstances', { instanceIds: [side.instanceId], translation: [0, 0, 1000] }));
    ok(s.execute('core.paint', { instanceIds: [...s.doc.scene.definitions.get(s.doc.scene.rootId)!.instances.keys()], materialId: ply }));
    ok(s.execute('core.setGrain', { definitionId: side.definitionId, grain: 'red' }));
    part(s, 3000, 600.25, 300, 18, 'Shelf "A"');
    expect(toCsv(list(s), s.doc.scene, s.doc.units)).toBe(
      '﻿Material,Part,Quantity,Length (mm),Width (mm),Thickness (mm),Grain,Warnings\r\n' +
        '"Birch ply, 12",Drawer side,2,450,180,12,Along red,\r\n' +
        'No material,"Shelf ""A""",1,600.3,300,18,,No material\r\n',
    );
  });

  test('fractional inches are written as shown', () => {
    const s = createSession();
    ok(s.execute('core.setDisplayUnits', { unit: 'in-frac', precision: 16 }));
    part(s, 0, 19.05 * 10, 19.05 * 4, 19.05, 'Rail');
    expect(toCsv(list(s), s.doc.scene, s.doc.units).split('\r\n')[1]).toBe('No material,Rail,1,"7 1/2""","3""","3/4""",,No material');
  });
});

describe('several boards in one part', () => {
  /** An open box (no top: not a solid) of the given height, made a component. */
  function openBox(s: CommandSession, x: number, h: number, name: string) {
    const p = part(s, x, 600, 500, h, name);
    const top = listFaces(definitionModel(s.doc, p.definitionId)!).find((f) => f.normal[1] === 1)!.id;
    ok(s.execute('core.erase', { definitionId: p.definitionId, faceIds: [top], edgeIds: [] }));
    return p;
  }
  const warnings = (s: CommandSession, name: string) => list(s).rows.find((r) => r.name === name)!.warnings;

  test('a thick part that is not a solid gets one warning that says what to do, instead of two', () => {
    const s = createSession();
    openBox(s, 0, 300, 'Cabinet');
    expect(warnings(s, 'Cabinet')).toEqual(['severalBoards', 'noMaterial']);
    // Thin enough to be one board: the usual warning stays.
    openBox(s, 1000, 40, 'Tray');
    expect(warnings(s, 'Tray')).toEqual(['notSolid', 'noMaterial']);
  });

  test("with a material, its stock thickness is the limit; a closed box keeps the thickness warning", () => {
    const s = createSession();
    const mel = ok(s.execute('core.addMaterial', { starter: 'whiteMelamine' })).materialId;
    const thin = openBox(s, 0, 30, 'Shelf');
    const closed = part(s, 1000, 600, 500, 300, 'Block');
    ok(s.execute('core.paint', { instanceIds: [thin.instanceId, closed.instanceId], materialId: mel }));
    // 30 mm open on 18 mm stock: several boards.
    expect(warnings(s, 'Shelf')).toEqual(['severalBoards']);
    expect(warnings(s, 'Block')).toEqual(['thickness']);
    expect(toCsv(list(s), s.doc.scene, s.doc.units)).toContain('Looks like several boards in one part: make each board its own group');
  });
});

describe('paint on the group or component counts (the usual SketchUp way)', () => {
  test("a board's material is its instance's paint, else the paint of the cabinet around it; the nearest wins", () => {
    const s = createSession();
    const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    const ply = ok(s.execute('core.addMaterial', { starter: 'birchPly' })).materialId;
    const left = part(s, 0, 18, 500, 720, 'Side');
    const shelf = part(s, 100, 764, 482, 18, 'Shelf');
    // No face of either board is painted.
    for (const p of [left, shelf]) expect(listFaces(definitionModel(s.doc, p.definitionId)!).every((f) => !f.paint)).toBe(true);
    // Paint on the board's own group or component.
    ok(s.execute('core.paint', { instanceIds: [left.instanceId], materialId: oak }));
    expect(list(s).rows.find((r) => r.name === 'Side')!.materialId).toBe(oak);
    // Paint on the cabinet component around the boards reaches the unpainted one; the side keeps its own.
    const cabinet = ok(s.execute('core.makeComponent', { instanceIds: [left.instanceId, shelf.instanceId], name: 'Cabinet' }));
    ok(s.execute('core.paint', { instanceIds: [cabinet.instanceId], materialId: ply }));
    const rows = list(s).rows;
    expect(rows.find((r) => r.name === 'Shelf')!.materialId).toBe(ply);
    expect(rows.find((r) => r.name === 'Side')!.materialId).toBe(oak);
    expect(rows.every((r) => !r.warnings.includes('noMaterial'))).toBe(true);
  });
});
