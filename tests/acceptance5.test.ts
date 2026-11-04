import { validateBytes } from 'gltf-validator';
import { describe, expect, test } from 'vitest';
import { createSession, documentFromText, documentToText, serializeDocument, type CommandSession } from '../src/commands';
import { cutList, toCsv, type CutList } from '../src/cutlist';
import { exportGlb } from '../src/export';
import { checkModel } from '../src/kernel';
import { determinant, findInstance } from '../src/scene';
import { buildCabinet, ok } from './helpers/cabinet';

/*
 * Milestone 5 acceptance: the reference cabinet, painted, gives the expected
 * cut list (the rows, quantities and totals approved with the plan). An 800 x
 * 500 x 720 mm carcass of 18 mm white melamine (two sides from one component,
 * the right one flipped; a back; a bottom), an 18 mm oak top with 50 mm
 * rounded corners, three drawers (one component) with 12 mm birch ply boxes,
 * and three 18 mm white MDF fronts on a Fronts tag. Through commands only
 * (tests/helpers/cabinet.ts).
 */

const instancesOf = (s: CommandSession, definitionId: string) =>
  [...s.doc.scene.definitions.values()].flatMap((d) => [...d.instances.values()].filter((i) => i.definitionId === definitionId).map((i) => ({ parent: d, id: i.id })));

const list = (s: CommandSession, includeHidden = true): CutList => cutList(s.doc.scene, { waste: 0.15, includeHidden });
const name = (s: CommandSession, id: string | null) => (id ? s.doc.scene.materials.get(id)!.name : null);

describe('milestone 5 acceptance: the reference cabinet cut list', () => {
  const c = buildCabinet();

  test('every model is valid; the right side is the left one mirrored; the drawer is placed three times', () => {
    for (const d of c.s.doc.scene.definitions.values()) expect(checkModel(d.model), d.id).toEqual([]);
    expect(determinant(findInstance(c.s.doc.scene, c.right)!.instance.transform)).toBeCloseTo(-1, 12);
    expect(instancesOf(c.s, c.drawer.definitionId)).toHaveLength(3);
  });

  test('the rows, quantities and sizes', () => {
    const rows = list(c.s).rows.map((r) => [name(c.s, r.materialId), r.name, r.quantity, r.length, r.width, r.thickness]);
    expect(rows).toEqual([
      ['Birch ply', 'Drawer bottom', 3, 716, 426, 12],
      ['Birch ply', 'Drawer front/back', 6, 716, 180, 12],
      ['Birch ply', 'Drawer side', 6, 450, 180, 12],
      ['Oak', 'Top', 1, 840, 540, 18],
      ['White MDF', 'Front', 3, 796, 226, 18],
      ['White melamine', 'Back', 1, 764, 720, 18],
      ['White melamine', 'Bottom', 1, 764, 482, 18],
      ['White melamine', 'Side', 2, 720, 500, 18],
    ]);
    expect(list(c.s).rows.every((r) => r.warnings.length === 0)).toBe(true);
    expect(list(c.s).rows.find((r) => r.name === 'Top')!.grain).toBe('red');
  });

  // Milestone 6 counts sheets by their layout, not by area with waste; the counts are the same.
  test('totals at 15% waste: sheets, board volume and cost', () => {
    const totals = new Map(list(c.s).totals.map((t) => [name(c.s, t.materialId), t]));
    const m = totals.get('White melamine')!;
    expect(m.area * 1.15 / 1e6).toBeCloseTo(1.884, 3);
    expect(m.sheetLayout!.sheets).toHaveLength(1);
    const p = totals.get('Birch ply')!;
    expect(p.area * 1.15 / 1e6).toBeCloseTo(2.5, 3);
    expect(p.sheetLayout!.sheets).toHaveLength(2);
    const f = totals.get('White MDF')!;
    expect(f.area * 1.15 / 1e6).toBeCloseTo(0.621, 3);
    expect(f.sheetLayout!.sheets).toHaveLength(1);
    for (const x of [m, p, f]) expect(x.sheetLayout!.tooLarge).toEqual([]);
    const o = totals.get('Oak')!;
    expect(o.boardLayout!.boards).toHaveLength(1);
    expect(o.boardVolume! / 1e9).toBeCloseTo(0.00939, 5);
    expect(o.cost).toBeCloseTo(0.0093895 * 1500, 2);
    expect([m.cost, p.cost, f.cost]).toEqual([45, 160, 38]);
  });

  test('hiding the Fronts tag leaves the fronts out of the list unless hidden parts are included', () => {
    const s = createSession(c.s.doc);
    ok(s.execute('core.setTagVisible', { tagId: c.tag, visible: false }));
    const hidden = list(s, false);
    expect(hidden.rows.some((r) => r.name === 'Front')).toBe(false);
    expect(hidden.hiddenLeftOut).toBe(3);
    expect(list(s, true).rows.find((r) => r.name === 'Front')!.quantity).toBe(3);
  });

  test('CSV, save and reopen, and GLB with materials', async () => {
    const csv = toCsv(list(c.s), c.s.doc.scene, c.s.doc.units).split('\r\n');
    expect(csv[0]).toBe('﻿No.,Material,Part,Quantity,Length (mm),Width (mm),Thickness (mm),Grain,Length edge 1,Length edge 2,Width edge 1,Width edge 2,Warnings');
    expect(csv.slice(1, 5)).toEqual(['1,Birch ply,Drawer bottom,3,716,426,12,,,,,,', '2,Birch ply,Drawer front/back,6,716,180,12,,,,,,', '3,Birch ply,Drawer side,6,450,180,12,,,,,,', '4,Oak,Top,1,840,540,18,Along red,,,,,']);
    const reopened = documentFromText(documentToText(c.s.doc))!;
    expect(serializeDocument(reopened)).toEqual(serializeDocument(c.s.doc));
    expect(cutList(reopened.scene, { waste: 0.15, includeHidden: true })).toEqual(list(c.s));
    const report = await validateBytes(exportGlb(c.s.doc.scene, 'Cabinet'));
    expect(report.issues.numErrors).toBe(0);
    expect(report.issues.numWarnings).toBe(0);
  });
});
