import { describe, expect, test } from 'vitest';
import { createSession } from '../src/commands';
import { exportGlb, exportStl } from '../src/export';
import { formatOf, importMesh, importSize, MESH_COLOR, readImport, type ImportedFile } from '../src/import';
import { listFaces } from '../src/kernel';
import { triangleCount } from '../src/scene';
import { buildCabinet, ok } from './helpers/cabinet';

const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** A 450 x 45 x 12.7 mm slide-like box in the model, 100 mm off the origin. */
function slide() {
  const s = createSession();
  const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [100, 0, 0], width: 450, depth: 12.7 }));
  ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: 45 }));
  return s;
}

async function read(format: 'stl' | 'obj' | 'glb', bytes: ArrayBuffer): Promise<ImportedFile> {
  const r = await readImport(format, bytes);
  if ('error' in r) throw new Error(r.error);
  return r;
}

describe('importing', () => {
  test('formats by extension', () => {
    expect([formatOf('Slide.STL'), formatOf('a.b.obj'), formatOf('hinge.glb'), formatOf('x.gltf'), formatOf('stl')]).toEqual(['stl', 'obj', 'glb', null, null]);
  });

  test('our STL comes back the same size, Z up and in mm, its origin at its lowest corner', async () => {
    const file = await read('stl', buffer(exportStl(slide().doc.scene)));
    expect(file).toMatchObject({ format: 'stl', unit: null, zUp: true, triangles: 12 });
    const size = importSize(file, 'mm', true);
    expect(size.map((v) => Math.round(v * 1000) / 1000)).toEqual([450, 45, 12.7]);
    const mesh = importMesh(file, 'mm', true)!;
    expect(mesh.bounds.min).toEqual([0, 0, 0]);
    expect([...mesh.bounds.max].map((v) => Math.round(v * 1000) / 1000)).toEqual([450, 45, 12.7]);
    expect(mesh.parts).toEqual([{ triangles: 12, color: MESH_COLOR }]);
    // Read Y up instead, it lies on its side; in inches, 25.4 times larger.
    expect(importSize(file, 'mm', false).map((v) => Math.round(v * 1000) / 1000)).toEqual([450, 12.7, 45]);
    expect(Math.round(importSize(file, 'in', true)[0])).toBe(11430);
  });

  test('our GLB comes back in meters, Y up, in its colors, one part per mesh', async () => {
    const s = slide();
    const walnut = ok(s.execute('core.addMaterial', { starter: 'walnut' })).materialId;
    const root = s.doc.scene.definitions.get(s.doc.scene.rootId)!;
    ok(s.execute('core.paint', { faceIds: [listFaces(root.model)[0]!.id], materialId: walnut }));
    const file = await read('glb', buffer(exportGlb(s.doc.scene)));
    expect(file).toMatchObject({ unit: 'm', zUp: false, triangles: 12 });
    expect(file.parts.map((p) => p.color).sort()).toEqual(['#6b4a33', '#f3f2ee'].sort());
    const mesh = importMesh(file, 'm', false)!;
    expect([...mesh.bounds.max].map((v) => Math.round(v * 1000) / 1000)).toEqual([450, 45, 12.7]);
  });

  test('a whole cabinet as GLB: every placement, turned and nested', async () => {
    const { s } = buildCabinet();
    const file = await read('glb', buffer(exportGlb(s.doc.scene)));
    const mesh = importMesh(file, 'm', false)!;
    expect(triangleCount(mesh)).toBeGreaterThan(100);
  });

  test('an OBJ with two objects and quads', async () => {
    const text = ['o A', 'v 0 0 0', 'v 10 0 0', 'v 10 10 0', 'v 0 10 0', 'f 1 2 3 4', 'o B', 'v 0 0 5', 'v 10 0 5', 'v 10 10 5', 'f 5 6 7'].join('\n');
    const file = await read('obj', buffer(new TextEncoder().encode(text)));
    expect(file.parts.map((p) => p.positions.length / 9)).toEqual([2, 1]);
    // Z up: the quad in the XY plane lies flat; the triangle is 5 above it.
    expect(importSize(file, 'mm', true).map((v) => Math.round(v * 1000) / 1000)).toEqual([10, 5, 10]);
  });

  test('nothing in the file, or not a file of its kind', async () => {
    expect(await readImport('obj', buffer(new TextEncoder().encode('# nothing')))).toEqual({ error: 'empty' });
    expect(await readImport('glb', buffer(new TextEncoder().encode('not a glb')))).toEqual({ error: 'unreadable' });
  });
});
