import { describe, expect, test } from 'vitest';
import { createSession, cutListSettings, definitionModel, documentFromText, documentToText, type CommandSession } from '../src/commands';
import { cutList, partAxes, partEdges, toCsv, type CutListOptions, type Edge } from '../src/cutlist';
import { listFaces } from '../src/kernel';
import { pathTransform, validStock } from '../src/scene';

/*
 * Edge banding (milestone 6, step 6). Boxes are drawn on the ground, width
 * along red (x), depth along green (z), pushed up by the height (y): a
 * 600 x 300 x 18 part has its length along x and its width along z.
 */

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

/** The side faces at one edge of a placed part. */
function edgeFaces(s: CommandSession, instanceId: string, definitionId: string, edge: Edge): string[] {
  const def = s.doc.scene.definitions.get(definitionId)!;
  const axes = partAxes(def.model, def.grain ?? null, pathTransform(s.doc.scene, [instanceId]))!;
  return [...partEdges(s.doc.scene, def.model, axes)[edge].faceIds];
}

/** Band edges of a part, as Entity Info does: paint their side faces with the band. */
function band(s: CommandSession, p: { instanceId: string; definitionId: string }, edges: Edge[], materialId: string | null) {
  for (const e of edges) ok(s.execute('core.paint', { definitionId: p.definitionId, faceIds: edgeFaces(s, p.instanceId, p.definitionId, e), materialId }));
}

const OPTIONS: CutListOptions = { waste: 0.15, includeHidden: false };

function shelf() {
  const s = createSession();
  const melamine = ok(s.execute('core.addMaterial', { starter: 'whiteMelamine' })).materialId;
  const abs = ok(s.execute('core.addMaterial', { starter: 'whiteAbsBand' })).materialId;
  ok(s.execute('core.setMaterialStock', { materialId: abs, stock: { kind: 'band', thickness: 1, width: 22, price: 0.5 } }));
  const p = part(s, 0, 600, 300, 18, 'Shelf');
  ok(s.execute('core.paint', { instanceIds: [p.instanceId], materialId: melamine }));
  return { s, melamine, abs, p };
}

describe('edge band stock', () => {
  test('a third kind of stock: thickness, width and a price per meter, no grain', () => {
    expect(validStock({ kind: 'band', thickness: 1, width: 22, price: 0.5 })).toEqual({ kind: 'band', thickness: 1, width: 22, price: 0.5 });
    expect(validStock({ kind: 'band', thickness: 0.6, width: 22 })).toEqual({ kind: 'band', thickness: 0.6, width: 22 });
    expect(validStock({ kind: 'band', thickness: 1, width: 0 })).toBeNull();
    expect(validStock({ kind: 'band', thickness: 1 })).toBeNull();
    const { s, abs } = shelf();
    expect(s.doc.scene.materials.get(abs)!.stock).toEqual({ kind: 'band', thickness: 1, width: 22, price: 0.5 });
    const r = s.execute('core.setMaterialStock', { materialId: abs, stock: { kind: 'band', thickness: 1, width: 22, grain: true } as never });
    expect(r.ok).toBe(false);
    const reopened = documentFromText(documentToText(s.doc))!;
    expect(reopened.scene.materials.get(abs)!.stock).toEqual({ kind: 'band', thickness: 1, width: 22, price: 0.5 });
    const saved = JSON.parse(documentToText(s.doc));
    saved.scene.materials[abs].stock.width = -1;
    expect(documentFromText(JSON.stringify(saved))).toBeNull();
  });
});

describe('banded parts in the cut list', () => {
  test('each edge has its band; the part keeps its material; cut size and totals follow', () => {
    const { s, melamine, abs, p } = shelf();
    band(s, p, ['length1', 'width2'], abs);
    const row = cutList(s.doc.scene, OPTIONS).rows[0]!;
    expect(row.bands).toEqual({ length1: abs, length2: null, width1: null, width2: abs });
    expect(row.materialId).toBe(melamine);
    expect(row.warnings).toEqual([]);
    expect([row.length, row.width, row.cutLength, row.cutWidth]).toEqual([600, 300, 599, 299]);
    // A length edge is the part's length, a width edge its width: 0.9 m, 1.035 m with 15% waste, 0.52 at 0.50 a meter.
    const [total] = cutList(s.doc.scene, OPTIONS).bands;
    expect(total!.materialId).toBe(abs);
    expect(total!.length).toBeCloseTo(900, 9);
    expect(total!.withWaste).toBeCloseTo(1035, 9);
    expect(total!.cost).toBeCloseTo(0.5175, 9);
    // Banding all four edges takes a millimeter off each side.
    band(s, p, ['length2', 'width1'], abs);
    const all = cutList(s.doc.scene, OPTIONS).rows[0]!;
    expect([all.cutLength, all.cutWidth]).toEqual([598, 298]);
    expect(cutList(s.doc.scene, OPTIONS).bands[0]!.length).toBeCloseTo(1800, 9);
    // Taking a band off leaves the edge as it was.
    band(s, p, ['length2', 'width1', 'width2'], null);
    expect(cutList(s.doc.scene, OPTIONS).rows[0]!.bands).toEqual({ length1: abs, length2: null, width1: null, width2: null });
  });

  test('component copies share the banding; a band stays on its edge when the part is resized, turned or mirrored', () => {
    const { s, abs, p } = shelf();
    band(s, p, ['width2'], abs);
    const copy = ok(s.execute('core.copyInstances', { instanceIds: [p.instanceId], translation: [0, 0, 1000] })).instanceIds[0]!;
    ok(s.execute('core.flip', { instanceIds: [copy], axis: 'red' }));
    const rows = cutList(s.doc.scene, OPTIONS).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quantity).toBe(2);
    expect(cutList(s.doc.scene, OPTIONS).bands[0]!.length).toBeCloseTo(600, 9);
    // Push the banded end out by 100: the part is 700 long and the band is still on that end.
    const [end] = edgeFaces(s, p.instanceId, p.definitionId, 'width2');
    ok(s.execute('core.pushPull', { definitionId: p.definitionId, faceId: end!, distance: 100 }));
    const resized = cutList(s.doc.scene, OPTIONS).rows[0]!;
    expect([resized.length, resized.bands.width2]).toEqual([700, abs]);
    // Pulled out past its width the other way, the banded end becomes a length edge.
    const [side] = edgeFaces(s, p.instanceId, p.definitionId, 'length2');
    ok(s.execute('core.pushPull', { definitionId: p.definitionId, faceId: side!, distance: 600 }));
    const turned = cutList(s.doc.scene, OPTIONS).rows[0]!;
    expect([turned.length, turned.width]).toEqual([900, 700]);
    expect(turned.bands).toEqual({ length1: null, length2: abs, width1: null, width2: null });
  });

  test('edge band is never what a part is made of', () => {
    const s = createSession();
    const abs = ok(s.execute('core.addMaterial', { starter: 'whiteAbsBand' })).materialId;
    const p = part(s, 0, 600, 300, 18, 'Shelf');
    band(s, p, ['length1'], abs);
    expect(cutList(s.doc.scene, OPTIONS).rows[0]!.materialId).toBeNull();
    ok(s.execute('core.paint', { instanceIds: [p.instanceId], materialId: abs }));
    expect(cutList(s.doc.scene, OPTIONS).rows[0]!.warnings).toContain('noMaterial');
  });

  test('a banded copy of a group is a row of its own', () => {
    const s = createSession();
    const abs = ok(s.execute('core.addMaterial', { starter: 'whiteAbsBand' })).materialId;
    const faces = () => listFaces(definitionModel(s.doc)!).map((f) => f.id);
    const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 600, depth: 300 }));
    ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: 18 }));
    const a = ok(s.execute('core.makeGroup', { faceIds: faces() }));
    const copy = ok(s.execute('core.copyInstances', { instanceIds: [a.instanceId], translation: [0, 0, 1000] })).instanceIds[0]!;
    expect(cutList(s.doc.scene, OPTIONS).rows.map((x) => x.quantity)).toEqual([2]);
    band(s, a, ['length1'], abs);
    const rows = cutList(s.doc.scene, OPTIONS).rows;
    expect(rows.map((x) => [x.quantity, x.bands.length1])).toEqual(expect.arrayContaining([[1, abs], [1, null]]));
    expect(rows.find((x) => x.bands.length1 === null)!.paths).toEqual([[copy]]);
  });
});

describe('cut size', () => {
  test('off by default and saved in the file; when on, the diagrams lay parts out at it', () => {
    const { s, abs, p } = shelf();
    band(s, p, ['length1', 'length2', 'width1', 'width2'], abs);
    expect(cutListSettings(s.doc).cutSize).toBe(false);
    const sheet = (cut: boolean) => cutList(s.doc.scene, { ...OPTIONS, cutSize: cut }).totals[0]!.sheetLayout!.sheets[0]!.pieces[0]!;
    expect([sheet(false).length, sheet(false).width]).toEqual([600, 300]);
    expect([sheet(true).length, sheet(true).width]).toEqual([598, 298]);
    ok(s.execute('core.setCutListSettings', { cutSize: true }));
    expect(documentFromText(documentToText(s.doc))!.cutList!.cutSize).toBe(true);
    // Files from before keep the default; a cut size that is not true or false makes the file invalid.
    const saved = JSON.parse(documentToText(s.doc));
    delete saved.cutList.cutSize;
    expect(documentFromText(JSON.stringify(saved))!.cutList!.cutSize).toBe(false);
    saved.cutList.cutSize = 'yes';
    expect(documentFromText(JSON.stringify(saved))).toBeNull();
  });

  test('the CSV names the band on each edge, and gives the cut size when asked', () => {
    const { s, abs, p } = shelf();
    ok(s.execute('core.setDisplayUnits', { unit: 'mm', precision: 0 }));
    band(s, p, ['length1', 'width2'], abs);
    const list = cutList(s.doc.scene, OPTIONS);
    expect(toCsv(list, s.doc.scene, s.doc.units).split('\r\n')[1]).toBe('1,White melamine,Shelf,1,600,300,18,,White ABS edge band,,,White ABS edge band,');
    const cut = toCsv(list, s.doc.scene, s.doc.units, { cutSize: true }).split('\r\n');
    expect(cut[0]).toContain('Thickness (mm),Cut length (mm),Cut width (mm),Grain');
    expect(cut[1]).toBe('1,White melamine,Shelf,1,600,300,18,599,299,,White ABS edge band,,,White ABS edge band,');
  });
});
