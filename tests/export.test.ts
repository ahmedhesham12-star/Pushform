import { validateBytes } from 'gltf-validator';
import { parseSkp } from 'openskp';
import { describe, expect, test } from 'vitest';
import { createSession, definitionModel, type CommandSession } from '../src/commands';
import { exportGlb, exportSkp, exportStl, worldTriangles } from '../src/export';
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

describe('GLB export with materials (milestone 5)', () => {
  /** A 1 x 1 PNG (red), so the validator can read a real image. */
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

  function painted() {
    const { s, c } = scene();
    const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    const navy = ok(s.execute('core.addMaterial', { starter: 'paintedNavy' })).materialId;
    ok(s.execute('core.setMaterialTexture', { materialId: oak, texture: { data: PNG, mime: 'image/png', width: 400, height: 200 } }));
    // The loose box's top in oak; the drawer copies: one navy, one as drawn; the second one mirrored.
    const top = listFaces(definitionModel(s.doc)!).find((f) => f.normal[1] === 1 && f.outer.every((p) => p[0] <= 1000))!.id;
    ok(s.execute('core.paint', { faceIds: [top], materialId: oak }));
    ok(s.execute('core.paint', { instanceIds: [c.instanceId], materialId: navy }));
    const copy = [...s.doc.scene.definitions.get(s.doc.scene.rootId)!.instances.keys()].find((i) => i !== c.instanceId)!;
    ok(s.execute('core.flip', { instanceIds: [copy], axis: 'red' }));
    return { s, oak, navy };
  }

  test('passes the Khronos validator: colors, an embedded texture, a mirrored copy', async () => {
    const { s } = painted();
    const report = await validateBytes(exportGlb(s.doc.scene, 'Painted'));
    expect(report.issues.messages.filter((m) => m.severity <= 1)).toEqual([]);
    expect(report.issues.numErrors).toBe(0);
    expect(report.issues.numWarnings).toBe(0);
  });

  test('one primitive per material; a textured one has its image and texture coordinates in tiles', () => {
    const { s } = painted();
    const json = readGlb(exportGlb(s.doc.scene));
    expect(json.materials.map((m: { name: string }) => m.name).sort()).toEqual(['Default', 'Oak', 'Painted navy']);
    const oak = json.materials.find((m: { name: string }) => m.name === 'Oak');
    expect(oak.pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0 });
    expect(json.images).toEqual([{ bufferView: expect.any(Number), mimeType: 'image/png' }]);
    expect(json.samplers).toEqual([{ wrapS: 10497, wrapT: 10497 }]);
    const navy = json.materials.find((m: { name: string }) => m.name === 'Painted navy');
    // #2f3e57 in linear light.
    expect(navy.pbrMetallicRoughness.baseColorFactor.map((v: number) => Math.round(v * 1000) / 1000)).toEqual([0.028, 0.048, 0.095, 1]);
    const root = json.nodes[json.scenes[0].nodes[0]];
    const box = json.meshes[root.mesh];
    expect(box.primitives).toHaveLength(2);
    const textured = box.primitives.find((p: { material: number }) => json.materials[p.material].name === 'Oak');
    const uv = json.accessors[textured.attributes.TEXCOORD_0];
    // The top: two triangles, a coordinate pair for each corner.
    expect([uv.type, uv.count]).toEqual(['VEC2', 6]);
    expect(box.primitives.find((p: { material: number }) => p !== textured).attributes.TEXCOORD_0).toBeUndefined();
    // Every buffer view starts on a 4-byte boundary.
    for (const v of json.bufferViews) expect(v.byteOffset % 4).toBe(0);
  });

  test('a component copy with its own material gets a mesh of its own; the plain copy keeps the plain one', () => {
    const { s } = painted();
    const json = readGlb(exportGlb(s.doc.scene));
    const root = json.nodes[json.scenes[0].nodes[0]];
    const [a, b] = root.children.map((i: number) => json.nodes[i]);
    expect(a.mesh).not.toBe(b.mesh);
    const names = (n: { mesh: number }) => json.meshes[n.mesh].primitives.map((p: { material: number }) => json.materials[p.material].name);
    expect([names(a), names(b)].sort()).toEqual([['Default'], ['Painted navy']]);
    // The knob inside the navy copy shows navy too; the other knob the default.
    const knobs = [a, b].map((n: { children: number[] }) => names(json.nodes[n.children[0]!]));
    expect(knobs.sort()).toEqual([['Default'], ['Painted navy']]);
  });

  test('STL ignores materials: the same triangles as before painting', () => {
    const plain = scene();
    const { s } = painted();
    // The flip mirrors the copy in place; the triangle count is unchanged.
    expect(exportStl(s.doc.scene).byteLength).toBe(exportStl(plain.s.doc.scene).byteLength);
  });
});

describe('SKP export', () => {
  /** A 1 x 1 PNG, so the writer has a real image to embed. */
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

  const parse = (bytes: Uint8Array) => parseSkp(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

  test('components, nested groups and millimeters survive as a v17 file', async () => {
    const { s, c } = scene();
    const copy = [...s.doc.scene.definitions.get(s.doc.scene.rootId)!.instances.keys()].find((i) => i !== c.instanceId)!;
    ok(s.execute('core.flip', { instanceIds: [copy], axis: 'red' }));
    const model = parse(await exportSkp(s.doc.scene));
    expect(model.version).toMatch(/^\{17\./);
    expect(model.root.faces).toHaveLength(6);
    expect(model.root.instances).toHaveLength(2);
    expect(model.definitions.size).toBe(2);
    const drawer = [...model.definitions.values()].find((d) => d.name === 'Drawer')!;
    const knob = [...model.definitions.values()].find((d) => d.isGroup)!;
    expect(drawer.faces).toHaveLength(6);
    expect(drawer.instances).toHaveLength(1);
    expect(knob.faces).toHaveLength(6);
    expect(knob.instances).toHaveLength(0);
    // The loose box is 1000 x 500 x 300 mm: inches, Z up, depth into -Y.
    const xs = model.root.vertices.map((v) => v.x);
    const ys = model.root.vertices.map((v) => v.y);
    const zs = model.root.vertices.map((v) => v.z);
    expect(Math.max(...xs)).toBeCloseTo(1000 / 25.4, 5);
    expect(Math.min(...ys)).toBeCloseTo(-500 / 25.4, 5);
    expect(Math.max(...zs)).toBeCloseTo(300 / 25.4, 5);
    // A mirrored copy keeps its mirror in the 3x3 matrix.
    const det = (m: number[]) => m[0]! * (m[4]! * m[8]! - m[7]! * m[5]!) - m[3]! * (m[1]! * m[8]! - m[7]! * m[2]!) + m[6]! * (m[1]! * m[5]! - m[4]! * m[2]!);
    expect(model.root.instances.some((i) => det(i.matrix) < 0)).toBe(true);
  });

  test('the writer refuses a model with no geometry, so the menu stays disabled', async () => {
    await expect(exportSkp(createSession().doc.scene)).rejects.toThrow(/no geometry/);
  });

  test('face paint, a texture and a tag are written', async () => {
    const s = createSession();
    const faces = box(s, 0, 0, 1000, 500, 300);
    const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    const navy = ok(s.execute('core.addMaterial', { starter: 'paintedNavy' })).materialId;
    ok(s.execute('core.setMaterialTexture', { materialId: oak, texture: { data: PNG, mime: 'image/png', width: 400, height: 200 } }));
    ok(s.execute('core.paint', { faceIds: [faces[0]!], materialId: oak }));
    ok(s.execute('core.paint', { faceIds: [faces[1]!], sides: ['back'], materialId: navy }));
    const group = ok(s.execute('core.makeGroup', { faceIds: faces }));
    const tag = ok(s.execute('core.addTag', { name: 'Case', color: '#4f81bd' })).tagId;
    ok(s.execute('core.setTag', { instanceIds: [group.instanceId], tagId: tag }));
    const model = parse(await exportSkp(s.doc.scene));
    const nameOf = (id: number | null) => (id === null ? null : model.materialsById.get(id)?.name ?? null);
    const groupDef = [...model.definitions.values()].find((d) => d.isGroup)!;
    expect(groupDef.faces.some((f) => nameOf(f.materialId) === 'Oak')).toBe(true);
    expect(groupDef.faces.some((f) => nameOf(f.backMaterialId) === 'Painted navy')).toBe(true);
    const placed = model.root.instances.find((i) => i.layer === 'Case');
    expect(placed).toBeDefined();
    expect(model.materials.find((m) => m.name === 'Oak')!.texture).not.toBeNull();
  });

  test('a loose edge is kept', async () => {
    const s = createSession();
    ok(s.execute('core.drawLine', { start: [0, 0, 0], direction: [1, 0, 0], length: 1000 }));
    const model = parse(await exportSkp(s.doc.scene));
    expect(model.root.edges).toHaveLength(1);
  });
});
