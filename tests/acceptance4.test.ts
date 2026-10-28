import { validateBytes } from 'gltf-validator';
import { describe, expect, test } from 'vitest';
import { createSession, definitionModel, documentFromText, documentToText, serializeDocument, type CommandSession } from '../src/commands';
import { exportGlb, exportStl, worldTriangles } from '../src/export';
import { checkModel, faceArea, listEdges, listFaces, serialize, solidVolume } from '../src/kernel';
import { applyPoint, definitionBounds, determinant, findInstance, instanceCount, placedInstances, worldAnnotations, worldGuides, type Scene } from '../src/scene';

/*
 * Milestone 4 acceptance: the cabinet again, with the tools milestone 4 adds,
 * through commands only. Guides mark the shelf and the divider and the parts
 * are drawn on them; the top panel has rounded corners; the two doors are one
 * component, the right one flipped so its handle sits by the middle; a
 * dimension from the carcass to the shelf follows the shelf when it moves.
 * Then save, reopen and export.
 */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

const root = (s: CommandSession) => definitionModel(s.doc)!;

/** A box in the root: a rectangle in the horizontal plane at height y, pushed up by h. Returns its faces. */
function box(s: CommandSession, x: number, y: number, z: number, w: number, d: number, h: number): string[] {
  const before = new Set(listFaces(root(s)).map((f) => f.id));
  const r = ok(s.execute('core.drawRectangle', { faceId: null, normal: [0, 1, 0], corner: [x, y, z], width: w, depth: d }));
  ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: h }));
  return listFaces(root(s))
    .map((f) => f.id)
    .filter((f) => !before.has(f));
}

/** A fan of `segments` triangles over an arc of radius r through angle a: what a drawn arc encloses with its center. */
const fan = (r: number, a: number, segments: number) => 0.5 * r * r * Math.sin(a / segments) * segments;
const R = 50;
const TOP_AREA = 840 * 540 - 4 * (R * R - fan(R, Math.PI / 2, 12));

function buildCabinet() {
  const s = createSession();
  s.execute('core.setDisplayUnits', { unit: 'mm', precision: 0 });

  // Carcass: an 800 x 500 x 720 box, open at the front, with 18 mm panels (as in milestone 3).
  box(s, 0, 0, 0, 800, 500, 720);
  const front = listFaces(root(s)).find((f) => f.normal[2] === 1)!;
  ok(s.execute('core.offset', { faceId: front.id, distance: 18 }));
  const opening = listFaces(root(s)).find((f) => f.normal[2] === 1 && f.holes.length === 0)!.id;
  ok(s.execute('core.pushPull', { faceId: opening, distance: -482 }));
  const carcass = ok(s.execute('core.makeGroup', { faceIds: listFaces(root(s)).map((f) => f.id) }));

  // Guides: the shelf 342 mm above the bottom panel, the divider 382 mm in from the left side.
  ok(s.execute('core.addGuideOffset', { point: [18, 18, 18], direction: [1, 0, 0], side: [0, 1, 0], distance: 342 }));
  ok(s.execute('core.addGuideOffset', { point: [18, 18, 18], direction: [0, 1, 0], side: [1, 0, 0], distance: 382 }));
  const guides = worldGuides(s.doc.scene).map((g) => g.guide);
  const shelfY = guides.find((g) => g.kind === 'line' && g.direction[0] === 1)!.point[1];
  const dividerX = guides.find((g) => g.kind === 'line' && g.direction[1] === 1)!.point[0];

  // The shelf on its guide, and the divider centered on its guide below it.
  const shelf = ok(s.execute('core.makeGroup', { faceIds: box(s, 18, shelfY, 18, 764, 482, 18) }));
  const divider = ok(s.execute('core.makeGroup', { faceIds: box(s, dividerX - 9, 18, 18, 18, 482, shelfY - 18) }));

  // The top: 840 x 540 with 20 mm overhangs, its corners rounded by 50 mm arcs, then 18 mm thick.
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
  const panel = listFaces(root(s)).find((f) => f.outer.every((p) => p[1] === 720))!;
  ok(s.execute('core.pushPull', { faceId: panel.id, distance: 18 }));
  const top = ok(s.execute('core.makeGroup', { faceIds: listFaces(root(s)).map((f) => f.id) }));

  // Doors: one component with a handle near its right edge; a copy flipped along its own red.
  const door = ok(s.execute('core.makeComponent', { faceIds: box(s, 0, 0, 500, 398, 18, 720), name: 'Door' }));
  const doorModel = () => definitionModel(s.doc, door.definitionId)!;
  // The door's own coordinates: the component's geometry starts at its placement.
  const local = (p: [number, number, number]) => applyPoint({ m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: findInstance(s.doc.scene, door.instanceId)!.instance.transform.translation.map((v) => -v) as [number, number, number] }, p);
  // The handle: a 12 mm circle on the front, 38 mm in from the right edge, halfway up.
  const doorFront = listFaces(doorModel()).find((f) => f.normal[2] === 1)!;
  ok(s.execute('core.drawCircle', { definitionId: door.definitionId, faceId: doorFront.id, center: [...local([360, 360, 518])] as [number, number, number], radius: 12, direction: null, segments: 12 }));
  const copy = ok(s.execute('core.moveCopies', { instanceIds: [door.instanceId], direction: [1, 0, 0], distance: 400, copies: 1, divide: false }));
  const right = copy.instanceIds[0]!;
  ok(s.execute('core.flip', { instanceIds: [right], axis: 'red' }));

  // A dimension from the carcass's inner back corner to the shelf's top back corner.
  const dim = ok(s.execute('core.addDimension', { start: [18, 18, 18], end: [18, shelfY + 18, 18], offset: [0, 0, -60] }));
  return { s, carcass, shelf, divider, top, door, right, dim, shelfY, dividerX };
}

/** Where each door's handle is: the circle's center, placed in the world. */
function handles(scene: Scene, doorDefinition: string) {
  const def = scene.definitions.get(doorDefinition)!;
  const circle = Object.values(serialize(def.model).curves).find((c) => c.kind === 'circle')!;
  return placedInstances(scene)
    .filter((p) => p.instance.definitionId === doorDefinition)
    .map((p) => applyPoint(p.world, circle.center as [number, number, number]).map((v) => Math.round(v * 1000) / 1000));
}

describe('milestone 4 acceptance: the cabinet with guides, a rounded top and mirrored doors', () => {
  const c = buildCabinet();

  test('the shelf and divider sit on their guides', () => {
    const scene = c.s.doc.scene;
    expect([c.shelfY, c.dividerX]).toEqual([360, 400]);
    expect(definitionBounds(scene, scene.rootId)).toBeTruthy();
    const box = (id: string) => {
      const p = placedInstances(scene).find((x) => x.instance.id === id)!;
      const b = definitionBounds(scene, p.instance.definitionId)!;
      return [applyPoint(p.world, b.min), applyPoint(p.world, b.max)];
    };
    expect(box(c.shelf.instanceId)).toEqual([
      [18, 360, 18],
      [782, 378, 500],
    ]);
    expect(box(c.divider.instanceId)).toEqual([
      [391, 18, 18],
      [409, 360, 500],
    ]);
  });

  test('the top is one solid with four rounded corners', () => {
    const def = c.s.doc.scene.definitions.get(c.top.definitionId)!;
    expect(checkModel(def.model)).toEqual([]);
    expect(Object.values(serialize(def.model).curves).filter((x) => x.kind === 'arc' && x.radius === R).length).toBe(8);
    expect(solidVolume(def.model)).toBeCloseTo(TOP_AREA * 18, 1);
    const bottom = listFaces(def.model).find((f) => f.normal[1] === -1)!;
    expect(faceArea(def.model, bottom.id)).toBeCloseTo(TOP_AREA, 3);
  });

  test('the doors are one component; the right one is mirrored, its handle by the middle', () => {
    const scene = c.s.doc.scene;
    expect(instanceCount(scene, c.door.definitionId)).toBe(2);
    const right = findInstance(scene, c.right)!.instance.transform;
    expect(determinant(right)).toBeCloseTo(-1, 12);
    expect(handles(scene, c.door.definitionId).sort((a, b) => a[0]! - b[0]!)).toEqual([
      [360, 360, 518],
      [438, 360, 518],
    ]);
    for (const d of scene.definitions.values()) expect(checkModel(d.model), d.id).toEqual([]);
  });

  test('the dimension follows the shelf when it moves', () => {
    const s = createSession(c.s.doc);
    const length = () => worldAnnotations(s.doc.scene).find((a) => a.annotationId === c.dim.annotationId)!.length;
    expect(length()).toBe(360);
    ok(s.execute('core.move', { instanceIds: [c.shelf.instanceId], direction: [0, 1, 0], distance: 40 }));
    expect(length()).toBe(400);
    s.undo();
    expect(length()).toBe(360);
  });

  test('save and reopen give back the same cabinet; STL and GLB export it, mirrored door included', async () => {
    const text = documentToText(c.s.doc);
    const reopened = documentFromText(text)!;
    expect(serializeDocument(reopened)).toEqual(serializeDocument(c.s.doc));
    expect(handles(reopened.scene, c.door.definitionId)).toEqual(handles(c.s.doc.scene, c.door.definitionId));
    const scene = c.s.doc.scene;
    expect(exportStl(scene).byteLength).toBe(84 + 50 * worldTriangles(scene).length);
    const report = await validateBytes(exportGlb(scene, 'Cabinet'));
    expect(report.issues.numErrors).toBe(0);
    expect(report.issues.numWarnings).toBe(0);
  });
});
