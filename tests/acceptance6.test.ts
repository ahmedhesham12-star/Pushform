import { describe, expect, test } from 'vitest';
import { cutList, partAxes, partEdges, partLabels, toCsv, type CutList, type CutListOptions } from '../src/cutlist';
import { listFaces } from '../src/kernel';
import { pathTransform } from '../src/scene';
import { buildCabinet, ok } from './helpers/cabinet';

/*
 * Milestone 6 acceptance, checkpoint (c): the milestone 5 reference cabinet
 * with white ABS 1 x 22 mm band (0.50 per meter) on the front edges of the
 * sides and bottom and on all four edges of the fronts. Expected (approved
 * with the plan): 8.336 m of band, 9.586 m with 15% waste, cost 4.79; the
 * diagrams with melamine on 1 sheet, birch ply 2, MDF 1 and oak 1 board; 23
 * labels. The hardware figures come with checkpoint (d).
 */

function bandedCabinet() {
  const c = buildCabinet();
  const { s } = c;
  const abs = ok(s.execute('core.addMaterial', { starter: 'whiteAbsBand' })).materialId;
  ok(s.execute('core.setMaterialStock', { materialId: abs, stock: { kind: 'band', thickness: 1, width: 22, price: 0.5 } }));
  // The sides and the bottom: the face toward the fronts (+z) in their definitions.
  for (const definitionId of [c.side.definitionId, c.bottom.definitionId]) {
    const model = s.doc.scene.definitions.get(definitionId)!.model;
    const front = listFaces(model).filter((f) => f.normal[2] > 0.99);
    expect(front).toHaveLength(1);
    ok(s.execute('core.paint', { definitionId, faceIds: front.map((f) => f.id), materialId: abs }));
  }
  // The fronts: all four edges, as Entity Info bands them.
  const def = s.doc.scene.definitions.get(c.front.definitionId)!;
  const edges = partEdges(s.doc.scene, def.model, partAxes(def.model, null, pathTransform(s.doc.scene, [c.front.instanceId]))!);
  const faceIds = [edges.length1, edges.length2, edges.width1, edges.width2].flatMap((e) => [...e.faceIds]);
  expect(faceIds).toHaveLength(4);
  ok(s.execute('core.paint', { definitionId: c.front.definitionId, faceIds, materialId: abs }));
  return { ...c, abs };
}

const OPTIONS: CutListOptions = { waste: 0.15, includeHidden: true };
const name = (list: CutList, n: string) => list.rows.find((r) => r.name === n)!;

describe('milestone 6 acceptance: edge banding and labels on the reference cabinet', () => {
  const c = bandedCabinet();
  const list = cutList(c.s.doc.scene, OPTIONS);

  test('the bands on each part, and the parts keep their materials', () => {
    const banded = (n: string) => Object.values(name(list, n).bands).filter((b) => b === c.abs).length;
    expect([banded('Side'), banded('Bottom'), banded('Front'), banded('Back'), banded('Top'), banded('Drawer side')]).toEqual([1, 1, 4, 0, 0, 0]);
    // The front edge of a side runs along its 720 mm length, the bottom's along its 764 mm.
    expect(name(list, 'Side').bands.length2).toBe(c.abs);
    expect(name(list, 'Bottom').bands.length2).toBe(c.abs);
    expect(name(list, 'Side').materialId).toBe(c.materials.melamine);
    expect(name(list, 'Front').materialId).toBe(c.materials.mdf);
    expect(list.rows.every((r) => r.warnings.length === 0)).toBe(true);
  });

  test('8.336 m of band, 9.586 m with 15% waste, cost 4.79', () => {
    expect(list.bands).toHaveLength(1);
    const [band] = list.bands;
    expect(band!.length / 1000).toBeCloseTo(8.336, 9);
    expect(band!.withWaste / 1000).toBeCloseTo(9.5864, 9);
    expect(Math.round(band!.cost! * 100) / 100).toBe(4.79);
  });

  test('the diagrams: melamine 1 sheet, birch ply 2, MDF 1, oak 1 board; banding moves nothing at the finished size', () => {
    const totals = new Map(list.totals.map((x) => [x.materialId, x]));
    expect(totals.get(c.materials.melamine)!.sheetLayout!.sheets).toHaveLength(1);
    expect(totals.get(c.materials.ply)!.sheetLayout!.sheets).toHaveLength(2);
    expect(totals.get(c.materials.mdf)!.sheetLayout!.sheets).toHaveLength(1);
    expect(totals.get(c.materials.oak)!.boardLayout!.boards).toHaveLength(1);
    // At the cut size the fronts are 794 x 224, and the counts hold.
    const cut = cutList(c.s.doc.scene, { ...OPTIONS, cutSize: true });
    expect([name(cut, 'Front').cutLength, name(cut, 'Front').cutWidth]).toEqual([794, 224]);
    const pieces = cut.totals.find((x) => x.materialId === c.materials.mdf)!.sheetLayout!.sheets.flatMap((sh) => sh.pieces);
    expect(pieces.map((p) => [p.length, p.width])).toEqual([
      [794, 224],
      [794, 224],
      [794, 224],
    ]);
    expect(cut.totals.find((x) => x.materialId === c.materials.mdf)!.sheetLayout!.sheets).toHaveLength(1);
  });

  test('23 labels: one per part, each with its copy and assembly', () => {
    const labels = partLabels(c.s.doc.scene, list);
    expect(labels).toHaveLength(23);
    const drawerSides = labels.filter((l) => l.name === 'Drawer side');
    expect(drawerSides.map((l) => `${l.copy} of ${l.count}`)).toEqual(['1 of 6', '2 of 6', '3 of 6', '4 of 6', '5 of 6', '6 of 6']);
    expect(new Set(drawerSides.map((l) => l.assembly))).toEqual(new Set(['Drawer']));
    // The carcass is a group, not a component: its parts have no assembly.
    expect(labels.find((l) => l.name === 'Side')!.assembly).toBeNull();
    expect(labels.filter((l) => l.name === 'Front').every((l) => Object.values(l.bands).every((b) => b === c.abs))).toBe(true);
  });

  test('the CSV names the band on each banded edge', () => {
    const csv = toCsv(list, c.s.doc.scene, c.s.doc.units).split('\r\n');
    const front = csv.find((l) => l.includes(',Front,'))!;
    expect(front.split('White ABS edge band')).toHaveLength(5);
  });
});
