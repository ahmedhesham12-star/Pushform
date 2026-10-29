import { describe, expect, test } from 'vitest';
import type { MeshLambertMaterial } from 'three';
import { createSession, definitionModel, type CommandSession } from '../src/commands';
import { createModel, drawRectangle, faceTextureFrame, faceMeshes, listFaces } from '../src/kernel';
import { InstancesView } from '../src/viewport/instancesView';
import { BACK_COLOR, faceUVs, FACE_COLOR, MaterialLibrary } from '../src/viewport/materials';

/* Materials in the viewport (milestone 5, step 5): which material each face side shows, and texture coordinates. */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

/** A box grouped in the root; returns the group and its faces. */
function boxGroup(s: CommandSession, x: number) {
  const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [x, 0, 0], width: 100, depth: 100 }));
  ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: 100 }));
  const g = ok(s.execute('core.makeGroup', { faceIds: listFaces(definitionModel(s.doc)!).map((f) => f.id) }));
  return { ...g, faces: listFaces(definitionModel(s.doc, g.definitionId)!).map((f) => f.id) };
}

/** The colors of a placement's front and back meshes, one per draw group, with how many triangles each covers. */
function looks(view: InstancesView, instanceId: string) {
  const out: Record<'front' | 'back', [number, number, boolean][]> = { front: [], back: [] };
  for (const [i, m] of view.pickables.filter((x) => x.userData.placement.path.at(-1) === instanceId).entries()) {
    const materials = m.material as MeshLambertMaterial[];
    out[i === 0 ? 'front' : 'back'] = m.geometry.groups.map((g) => [materials[g.materialIndex!]!.color.getHex(), g.count / 3, materials[g.materialIndex!]!.transparent]);
  }
  return out;
}

describe('materials on instances', () => {
  test('painted faces show their material; unpainted ones the instance material, else the usual front and back', () => {
    const s = createSession();
    const red = ok(s.execute('core.addMaterial', { color: '#cc0000' })).materialId;
    const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    const a = boxGroup(s, 0);
    ok(s.execute('core.paint', { definitionId: a.definitionId, faceIds: [a.faces[0]!], materialId: red }));
    const view = new InstancesView(new MaterialLibrary());
    view.build(s.doc.scene, []);
    // One face (2 triangles) red, five unpainted; behind, all unpainted.
    expect(looks(view, a.instanceId).front).toEqual([
      [0xcc0000, 2, false],
      [FACE_COLOR, 10, false],
    ]);
    expect(looks(view, a.instanceId).back).toEqual([[BACK_COLOR, 12, false]]);
    ok(s.execute('core.paint', { instanceIds: [a.instanceId], materialId: oak }));
    view.build(s.doc.scene, []);
    expect(looks(view, a.instanceId).front).toEqual([
      [0xcc0000, 2, false],
      [0xc8a165, 10, false],
    ]);
    expect(looks(view, a.instanceId).back).toEqual([[0xc8a165, 12, false]]);
    // Outside the open context, faded.
    const b = boxGroup(s, 500);
    view.build(s.doc.scene, [b.instanceId]);
    expect(looks(view, a.instanceId).front.map((x) => x[2])).toEqual([true, true]);
  });

  test('a textured material shows its image untinted, tiled at its size in mm', () => {
    const library = new MaterialLibrary();
    const texture = { data: 'iVBORw0KGgo=', mime: 'image/png' as const, width: 400, height: 200 };
    const m = library.get({ name: 'Oak', color: '#c8a165', texture }, 'front', false);
    expect(m.color.getHex()).toBe(0xffffff);
    expect(m.map).not.toBeNull();
    expect([m.map!.repeat.x, m.map!.repeat.y]).toEqual([1 / 400, 1 / 200]);
    expect(library.get({ name: 'Oak', color: '#c8a165', texture }, 'front', false)).toBe(m);
    expect(library.get({ name: 'Oak', color: '#c8a165' }, 'front', false).map).toBeNull();
  });
});

describe('texture coordinates', () => {
  test('run along the longest edge of each face, in mm from its start', () => {
    // A 600 x 200 rectangle on the ground: the long edge runs along red.
    const r = drawRectangle(createModel(), { faceId: null, corner: [0, 0, 0], width: 600, depth: 200 });
    if (!r.ok) throw new Error(r.error);
    const f = r.faceIds[0]!;
    const frame = faceTextureFrame(r.model, f)!;
    expect(Math.abs(frame.u[0])).toBeCloseTo(1, 12);
    const uvs = faceUVs(r.model, faceMeshes(r.model).find((m) => m.faceId === f)!);
    const us = uvs.filter((_, i) => i % 2 === 0).map((u) => Math.round(Math.abs(u)));
    const vs = uvs.filter((_, i) => i % 2 === 1).map((v) => Math.round(Math.abs(v)));
    expect(Math.max(...us)).toBe(600);
    expect(Math.max(...vs)).toBe(200);
    // Turned 30 degrees, the long edge still sets u.
    const turned = drawRectangle(createModel(), { faceId: null, corner: [0, 0, 0], width: 600, depth: 200, axis: [Math.cos(Math.PI / 6), 0, Math.sin(Math.PI / 6)] });
    if (!turned.ok) throw new Error(turned.error);
    const u = faceTextureFrame(turned.model, turned.faceIds[0]!)!.u;
    expect(Math.abs(u[0] * Math.cos(Math.PI / 6) + u[2] * Math.sin(Math.PI / 6))).toBeCloseTo(1, 6);
  });
});
