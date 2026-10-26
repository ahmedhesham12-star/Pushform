import { validateBytes } from 'gltf-validator';
import { describe, expect, test } from 'vitest';
import { createSession, definitionModel, type CommandSession } from '../src/commands';
import { exportGlb, exportStl, worldTriangles } from '../src/export';
import { faceMeshes, listFaces } from '../src/kernel';

/* Model sizes in mm; STL in mm, Z up; GLB in meters, Y up. */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

function box(s: CommandSession, x: number, z: number, w: number, d: number, h: number): string[] {
  const before = new Set(listFaces(definitionModel(s.doc)!).map((f) => f.id));
  const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [x, 0, z], width: w, depth: d }));
  ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: h }));
  return listFaces(definitionModel(s.doc)!)
    .map((f) => f.id)
    .filter((f) => !before.has(f));
}

/** A loose box, a component placed twice (the copy turned a quarter), and a group nested in the component. */
function scene() {
  const s = createSession();
  box(s, 0, 0, 1000, 500, 300);
  const knob = ok(s.execute('core.makeGroup', { faceIds: box(s, 2000, 0, 50, 50, 50) }));
  const c = ok(s.execute('core.makeComponent', { faceIds: box(s, 2000, 1000, 400, 400, 200), instanceIds: [knob.instanceId], name: 'Drawer' }));
  const copy = ok(s.execute('core.moveCopies', { instanceIds: [c.instanceId], direction: [1, 0, 0], distance: 1000, copies: 1, divide: false }));
  ok(s.execute('core.rotate', { instanceIds: copy.instanceIds, center: [3000, 0, 1000], axis: [0, 1, 0], angle: 90 }));
  return { s, c };
}

const trianglesOf = (s: CommandSession, id?: string) =>
  faceMeshes(definitionModel(s.doc, id)!).reduce((n, m) => n + m.positions.length / 9, 0);

function readStl(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  const tris: { normal: number[]; points: number[][] }[] = [];
  for (let i = 0; i < count; i++) {
    const at = 84 + i * 50;
    const f = (k: number) => view.getFloat32(at + k * 4, true);
    tris.push({ normal: [f(0), f(1), f(2)], points: [[f(3), f(4), f(5)], [f(6), f(7), f(8)], [f(9), f(10), f(11)]] });
  }
  return { header: String.fromCharCode(...bytes.slice(0, 80)).replace(/\0+$/, ''), count, tris };
}

function readGlb(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(8, true)).toBe(bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jsonLength)));
}

describe('STL export', () => {
  test('every triangle of every placement, in a binary file of the right size', () => {
    const { s, c } = scene();
    const stl = exportStl(s.doc.scene);
    const r = readStl(stl);
    // Loose box, plus each of two drawers with its nested knob.
    const expected = trianglesOf(s) + 2 * (trianglesOf(s, c.definitionId) + 12);
    expect(r.count).toBe(expected);
    expect(stl.byteLength).toBe(84 + 50 * expected);
    expect(r.header.startsWith('solid')).toBe(false);
  });

  test('millimeters with Z up: the loose box stands on the bed', () => {
    const s = createSession();
    box(s, 0, 0, 1000, 500, 300);
    const r = readStl(exportStl(s.doc.scene));
    const all = r.tris.flatMap((t) => t.points);
    const range = (k: number) => [Math.min(...all.map((p) => p[k]!)), Math.max(...all.map((p) => p[k]!))];
    // x stays, z (depth) becomes -y, height becomes z.
    expect(range(0)).toEqual([0, 1000]);
    expect(range(1)).toEqual([-500, 0]);
    expect(range(2)).toEqual([0, 300]);
    // The top faces up (+Z) and the facets are wound with their normals.
    const top = r.tris.filter((t) => t.points.every((p) => p[2] === 300));
    expect(top).toHaveLength(2);
    for (const t of top) expect(t.normal.map((v) => Math.round(v))).toEqual([0, 0, 1]);
  });

  test('instances are placed with their transforms', () => {
    const { s } = scene();
    const tris = worldTriangles(s.doc.scene);
    const xs = tris.flatMap((t) => t.map((p) => p[0]));
    const zs = tris.flatMap((t) => t.map((p) => p[2]));
    // The turned copy reaches from x = 3000 to 3400 and from z = 600 to 1000 (turned about its corner).
    expect(Math.max(...xs)).toBeCloseTo(3400, 6);
    expect(Math.min(...zs)).toBeCloseTo(0, 6);
    expect(zs.some((z) => Math.abs(z - 600) < 1e-6)).toBe(true);
  });
});

describe('GLB export', () => {
  test('passes the Khronos glTF validator with no errors or warnings', async () => {
    const { s } = scene();
    const report = await validateBytes(exportGlb(s.doc.scene, 'Test'));
    expect(report.issues.messages.filter((m) => m.severity <= 1)).toEqual([]);
    expect(report.issues.numErrors).toBe(0);
    expect(report.issues.numWarnings).toBe(0);
  });

  test('an empty model is a valid file too', async () => {
    const report = await validateBytes(exportGlb(createSession().doc.scene));
    expect(report.issues.numErrors).toBe(0);
  });

  test('nodes follow the scene; component copies share one mesh; meters', () => {
    const { s, c } = scene();
    const json = readGlb(exportGlb(s.doc.scene, 'Cabinet'));
    const root = json.nodes[json.scenes[0].nodes[0]];
    expect(root.name).toBe('Cabinet');
    // The root's own box, two drawers (each with a knob): 1 + 2 + 2 nodes, and 3 meshes (box, drawer, knob).
    expect(json.nodes).toHaveLength(5);
    expect(json.meshes).toHaveLength(3);
    const drawers = root.children.map((i: number) => json.nodes[i]);
    expect(drawers.map((n: { name: string }) => n.name)).toEqual(['Drawer', 'Drawer']);
    expect(drawers[0].mesh).toBe(drawers[1].mesh);
    // Translations in meters; the copy carries its quarter turn.
    // The drawer box with its knob starts at (2000, 0, 0): its origin.
    expect(drawers[0].translation).toEqual([2, 0, 0]);
    expect(drawers[1].rotation.map((v: number) => Math.round(v * 1e6) / 1e6)).toEqual([0, Math.SQRT1_2, 0, Math.SQRT1_2].map((v) => Math.round(v * 1e6) / 1e6));
    // The loose box is 1 m wide in the file.
    const pos = json.accessors[json.meshes[root.mesh].primitives[0].attributes.POSITION];
    expect(pos.max[0]).toBeCloseTo(1, 6);
    expect(pos.min[0]).toBeCloseTo(0, 6);
    expect(c.definitionId).toBeDefined();
  });
});
