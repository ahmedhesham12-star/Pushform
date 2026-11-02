import { validateBytes } from 'gltf-validator';
import { describe, expect, test } from 'vitest';
import { createSession, definitionModel, documentFromText, documentToText, serializeDocument, type CommandSession } from '../src/commands';
import { cutList, toCsv, type CutList } from '../src/cutlist';
import { exportGlb } from '../src/export';
import { checkModel, listEdges, listFaces } from '../src/kernel';
import { determinant, findInstance } from '../src/scene';

/*
 * Milestone 5 acceptance: the reference cabinet, painted, gives the expected
 * cut list (the rows, quantities and totals approved with the plan). An 800 x
 * 500 x 720 mm carcass of 18 mm white melamine (two sides from one component,
 * the right one flipped; a back; a bottom), an 18 mm oak top with 50 mm
 * rounded corners, three drawers (one component) with 12 mm birch ply boxes,
 * and three 18 mm white MDF fronts on a Fronts tag. Through commands only.
 */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

const root = (s: CommandSession) => definitionModel(s.doc)!;

/** A box in the root: a rectangle in the horizontal plane at height y, pushed up by h; made a named component. */
function part(s: CommandSession, name: string, x: number, y: number, z: number, w: number, d: number, h: number) {
  const before = new Set(listFaces(root(s)).map((f) => f.id));
  const r = ok(s.execute('core.drawRectangle', { faceId: null, normal: [0, 1, 0], corner: [x, y, z], width: w, depth: d }));
  ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: h }));
  const faceIds = listFaces(root(s))
    .map((f) => f.id)
    .filter((f) => !before.has(f));
  return ok(s.execute('core.makeComponent', { faceIds, name }));
}

const instancesOf = (s: CommandSession, definitionId: string) =>
  [...s.doc.scene.definitions.values()].flatMap((d) => [...d.instances.values()].filter((i) => i.definitionId === definitionId).map((i) => ({ parent: d, id: i.id })));

function buildCabinet() {
  const s = createSession();
  ok(s.execute('core.setDisplayUnits', { unit: 'mm', precision: 0 }));
  const material = (starter: 'whiteMelamine' | 'oak' | 'birchPly' | 'whiteMdf', price: number) => {
    const id = ok(s.execute('core.addMaterial', { starter })).materialId;
    const stock = s.doc.scene.materials.get(id)!.stock!;
    ok(s.execute('core.setMaterialStock', { materialId: id, stock: { ...stock, price } }));
    return id;
  };
  const melamine = material('whiteMelamine', 45);
  const oak = material('oak', 1500);
  const ply = material('birchPly', 80);
  const mdf = material('whiteMdf', 38);

  // Carcass: sides (one component, the right one flipped), back and bottom, in an assembly painted melamine.
  const side = part(s, 'Side', 0, 0, 0, 18, 500, 720);
  const right = ok(s.execute('core.copyInstances', { instanceIds: [side.instanceId], translation: [782, 0, 0] })).instanceIds[0]!;
  ok(s.execute('core.flip', { instanceIds: [right], axis: 'red' }));
  const back = part(s, 'Back', 18, 0, 0, 764, 18, 720);
  const bottom = part(s, 'Bottom', 18, 0, 18, 764, 482, 18);
  const carcass = ok(s.execute('core.makeGroup', { instanceIds: [side.instanceId, right, back.instanceId, bottom.instanceId] }));
  ok(s.execute('core.renameInstance', { instanceId: carcass.instanceId, name: 'Carcass' }));
  ok(s.execute('core.paint', { instanceIds: [carcass.instanceId], materialId: melamine }));

  // Top: 840 x 540 with its corners rounded by 50 mm arcs, 18 mm oak, grain along red.
  const R = 50;
  ok(s.execute('core.drawRectangle', { faceId: null, normal: [0, 1, 0], corner: [-20, 720, -20], width: 840, depth: 540 }));
  for (const [x, z] of [
    [-20, -20],
    [820, -20],
    [820, 520],
    [-20, 520],
  ] as const) {
    const sx = x < 0 ? 1 : -1;
    const sz = z < 0 ? 1 : -1;
    const center: [number, number, number] = [x + sx * R, 720, z + sz * R];
    const start: [number, number, number] = [center[0], 720, z];
    const end: [number, number, number] = [x, 720, center[2]];
    const turn = (start[2] - center[2]) * (end[0] - center[0]) - (start[0] - center[0]) * (end[2] - center[2]);
    const face = listFaces(root(s)).find((f) => f.outer.some((p) => p[0] === x && p[2] === z))!.id;
    ok(s.execute('core.drawArcCenter', { faceId: face, center, start, angle: turn > 0 ? 90 : -90, segments: 12 }));
  }
  const corners = listEdges(root(s)).filter((e) => !e.curve && e.a[1] === 720 && Math.abs(Math.hypot(e.a[0] - e.b[0], e.a[2] - e.b[2]) - R) < 1e-6);
  ok(s.execute('core.erase', { faceIds: [], edgeIds: corners.map((e) => e.id) }));
  ok(s.execute('core.pushPull', { faceId: listFaces(root(s))[0]!.id, distance: 18 }));
  const top = ok(s.execute('core.makeComponent', { faceIds: listFaces(root(s)).map((f) => f.id), name: 'Top' }));
  ok(s.execute('core.paint', { definitionId: top.definitionId, faceIds: listFaces(definitionModel(s.doc, top.definitionId)!).map((f) => f.id), materialId: oak }));
  ok(s.execute('core.setGrain', { definitionId: top.definitionId, grain: 'red' }));

  // A drawer: a 740 x 450 x 180 box of 12 mm birch ply, made a component and placed three times.
  const y = 30;
  const dSide = part(s, 'Drawer side', 30, y, 30, 12, 450, 180);
  const dSide2 = ok(s.execute('core.copyInstances', { instanceIds: [dSide.instanceId], translation: [728, 0, 0] })).instanceIds[0]!;
  const dEnd = part(s, 'Drawer front/back', 42, y, 30, 716, 12, 180);
  const dEnd2 = ok(s.execute('core.copyInstances', { instanceIds: [dEnd.instanceId], translation: [0, 0, 438] })).instanceIds[0]!;
  const dBottom = part(s, 'Drawer bottom', 42, y, 42, 716, 426, 12);
  const boxParts = [dSide.instanceId, dSide2, dEnd.instanceId, dEnd2, dBottom.instanceId];
  ok(s.execute('core.paint', { instanceIds: boxParts, materialId: ply }));
  const drawer = ok(s.execute('core.makeComponent', { instanceIds: boxParts, name: 'Drawer' }));
  for (const dy of [230, 460]) ok(s.execute('core.copyInstances', { instanceIds: [drawer.instanceId], translation: [0, dy, 0] }));

  // Fronts: three 796 x 226 x 18 white MDF panels, on a Fronts tag.
  const front = part(s, 'Front', 2, 20, 500, 796, 18, 226);
  const fronts = [front.instanceId, ...[234, 468].map((dy) => ok(s.execute('core.copyInstances', { instanceIds: [front.instanceId], translation: [0, dy, 0] })).instanceIds[0]!)];
  ok(s.execute('core.paint', { instanceIds: fronts, materialId: mdf }));
  const tag = ok(s.execute('core.addTag', { name: 'Fronts' })).tagId;
  ok(s.execute('core.setTag', { instanceIds: fronts, tagId: tag }));
  return { s, materials: { melamine, oak, ply, mdf }, right, side, drawer, tag };
}

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

  test('totals at 15% waste: sheets, board volume and cost', () => {
    const totals = new Map(list(c.s).totals.map((t) => [name(c.s, t.materialId), t]));
    const m = totals.get('White melamine')!;
    expect(m.area * 1.15 / 1e6).toBeCloseTo(1.884, 3);
    expect([m.sheets!.exact, m.sheets!.count]).toEqual([expect.closeTo(0.633, 3), 1]);
    const p = totals.get('Birch ply')!;
    expect(p.area * 1.15 / 1e6).toBeCloseTo(2.5, 3);
    expect([p.sheets!.exact, p.sheets!.count]).toEqual([expect.closeTo(1.075, 3), 2]);
    const f = totals.get('White MDF')!;
    expect(f.area * 1.15 / 1e6).toBeCloseTo(0.621, 3);
    expect([f.sheets!.exact, f.sheets!.count]).toEqual([expect.closeTo(0.208, 3), 1]);
    const o = totals.get('Oak')!;
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
    expect(csv[0]).toBe('﻿Material,Part,Quantity,Length (mm),Width (mm),Thickness (mm),Grain,Warnings');
    expect(csv.slice(1, 5)).toEqual(['Birch ply,Drawer bottom,3,716,426,12,,', 'Birch ply,Drawer front/back,6,716,180,12,,', 'Birch ply,Drawer side,6,450,180,12,,', 'Oak,Top,1,840,540,18,Along red,']);
    const reopened = documentFromText(documentToText(c.s.doc))!;
    expect(serializeDocument(reopened)).toEqual(serializeDocument(c.s.doc));
    expect(cutList(reopened.scene, { waste: 0.15, includeHidden: true })).toEqual(list(c.s));
    const report = await validateBytes(exportGlb(c.s.doc.scene, 'Cabinet'));
    expect(report.issues.numErrors).toBe(0);
    expect(report.issues.numWarnings).toBe(0);
  });
});
