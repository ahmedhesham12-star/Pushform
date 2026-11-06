import { validateBytes } from 'gltf-validator';
import { describe, expect, test } from 'vitest';
import { createSession, documentFromText, documentToText, type CommandSession } from '../src/commands';
import { cutList } from '../src/cutlist';
import { exportGlb, worldTriangles } from '../src/export';
import {
  buildMesh,
  definitionBounds,
  fromBase64,
  loadMesh,
  MESH_EDGE,
  saveMesh,
  shownBounds,
  SNAP_EDGE_LIMIT,
  snapsToEdges,
  toBase64,
  triangleCount,
  worldEdges,
  worldSnapPoints,
  type MeshData,
} from '../src/scene';
import { ok } from './helpers/cabinet';

/** The 12 triangles of a w x h x d box with its low corner at the origin, as a soup, wound outwards. */
function boxSoup(w: number, h: number, d: number): number[] {
  const c = (i: number) => [i & 1 ? w : 0, i & 2 ? h : 0, i & 4 ? d : 0];
  // Each side as a quad of corner indices, counter-clockwise seen from outside.
  const quads = [
    [0, 4, 6, 2],
    [1, 3, 7, 5],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 2, 3, 1],
    [4, 5, 7, 6],
  ];
  return quads.flatMap(([a, b, e, f]) => [...c(a!), ...c(b!), ...c(e!), ...c(a!), ...c(e!), ...c(f!)]);
}

const box = (w = 40, h = 20, d = 10): MeshData => buildMesh([{ positions: boxSoup(w, h, d), color: '#808080' }])!;

function placed(s: CommandSession, mesh: MeshData, position: [number, number, number] = [0, 0, 0]) {
  return ok(s.execute('core.insertMesh', { name: 'Slide', mesh: saveMesh(mesh), position }));
}

describe('building a mesh', () => {
  test('welds corners, keeps the box sides as feature edges and drops the face diagonals', () => {
    const m = box();
    expect(m.positions.length / 3).toBe(8);
    expect(triangleCount(m)).toBe(12);
    // 12 box edges; the 6 diagonals lie between coplanar triangles.
    expect(m.edges.length / 2).toBe(12);
    expect(m.bounds).toEqual({ min: [0, 0, 0], max: [40, 20, 10] });
  });

  test('corners within 0.001 mm weld; triangles with no area are dropped; a lone triangle is all boundary', () => {
    const m = buildMesh([
      { positions: [0, 0, 0, 10, 0, 0, 0, 10, 0], color: '#FF0000' },
      { positions: [0, 0, 0.0004, 10, 0, 0, 20, 0, 0], color: '#00ff00' },
    ])!;
    expect(m.positions.length / 3).toBe(3);
    expect(m.parts).toEqual([{ triangles: 1, color: '#ff0000' }]);
    expect(m.edges.length / 2).toBe(3);
    expect(buildMesh([{ positions: [0, 0, 0, 1, 1, 1, 2, 2, 2], color: '#000000' }])).toBeNull();
  });

  test('an edge where faces turn 30 degrees or less is smooth; sharper is a feature edge', () => {
    const fold = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      // Two triangles on the x axis; the second turned up by `deg` about it.
      const m = buildMesh([{ positions: [0, 0, 0, 10, 0, 0, 5, 0, -10, 0, 0, 0, 5, 10 * Math.sin(a), 10 * Math.cos(a), 10, 0, 0], color: '#000000' }])!;
      return m.edges.length / 2;
    };
    expect(fold(20)).toBe(4);
    expect(fold(45)).toBe(5);
  });

  test('the file form round-trips, and broken data is refused', () => {
    const m = box();
    const back = loadMesh(JSON.parse(JSON.stringify(saveMesh(m))))!;
    expect([...back.positions]).toEqual([...m.positions]);
    expect([...back.triangles]).toEqual([...m.triangles]);
    expect([...back.edges]).toEqual([...m.edges]);
    expect(back.parts).toEqual(m.parts);
    const saved = saveMesh(m);
    expect(loadMesh({ ...saved, parts: [{ triangles: 11, color: '#808080' }] })).toBeNull();
    expect(loadMesh({ ...saved, parts: [{ triangles: 12, color: 'grey' }] })).toBeNull();
    const bad = new Uint32Array([0, 1, 99]);
    expect(loadMesh({ ...saved, triangles: toBase64(new Uint8Array(bad.buffer)), parts: [{ triangles: 1, color: '#808080' }] })).toBeNull();
    expect(loadMesh({ ...saved, positions: toBase64(new Uint8Array(new Float32Array([0, 0, NaN]).buffer)) })).toBeNull();
  });

  test('base64 matches the usual encoding for every padding length', () => {
    for (const text of ['', 'a', 'ab', 'abc', 'abcd', 'Pushform reference mesh']) {
      const bytes = new TextEncoder().encode(text);
      const encoded = toBase64(bytes);
      expect(encoded).toBe(Buffer.from(text).toString('base64'));
      expect(new TextDecoder().decode(fromBase64(encoded))).toBe(text);
    }
  });
});

describe('reference meshes in the scene', () => {
  test('placed like a component: bounds, snap points and feature edges in world coordinates', () => {
    const s = createSession();
    const { definitionId, instanceId } = placed(s, box(), [100, 0, 0]);
    const def = s.doc.scene.definitions.get(definitionId)!;
    expect(def.kind).toBe('mesh');
    expect(definitionBounds(s.doc.scene, definitionId)).toEqual({ min: [0, 0, 0], max: [40, 20, 10] });
    expect(shownBounds(s.doc.scene)).toEqual({ min: [100, 0, 0], max: [140, 20, 10] });
    const snaps = worldSnapPoints(s.doc.scene).filter((p) => p.path[0] === instanceId);
    expect(snaps.filter((p) => p.kind === 'end')).toHaveLength(8);
    expect(snaps.filter((p) => p.kind === 'mid')).toHaveLength(12);
    expect(snaps.every((p) => p.vertex === undefined)).toBe(true);
    const edges = worldEdges(s.doc.scene).filter((e) => e.path[0] === instanceId);
    expect(edges).toHaveLength(12);
    expect(edges.every((e) => e.edgeId.startsWith(MESH_EDGE) && e.a[0] >= 100)).toBe(true);
  });

  test('a mesh with more feature edges than the limit draws them but is not snapped to by them', () => {
    // 7,000 loose triangles: 21,000 boundary edges.
    const soup: number[] = [];
    for (let t = 0; t < 7000; t++) soup.push(t * 3, 0, 0, t * 3 + 1, 0, 0, t * 3, 1, 0);
    const mesh = buildMesh([{ positions: soup, color: '#808080' }])!;
    expect(mesh.edges.length / 2).toBeGreaterThan(SNAP_EDGE_LIMIT);
    expect(snapsToEdges(mesh)).toBe(false);
    const s = createSession();
    placed(s, mesh);
    expect(worldSnapPoints(s.doc.scene)).toHaveLength(0);
    expect(worldEdges(s.doc.scene)).toHaveLength(0);
    expect(snapsToEdges(box())).toBe(true);
  });

  test('cannot be edited or exploded; copies share the mesh', () => {
    const s = createSession();
    const { definitionId, instanceId } = placed(s, box());
    const draw = s.execute('core.drawRectangle', { definitionId, faceId: null, corner: [0, 0, 0], width: 10, depth: 10 });
    expect(!draw.ok && draw.error.code).toBe('meshNotEditable');
    const explode = s.execute('core.explode', { instanceIds: [instanceId] });
    expect(!explode.ok && explode.error.code).toBe('meshNotEditable');
    const copy = ok(s.execute('core.copyInstances', { instanceIds: [instanceId], translation: [100, 0, 0] }));
    const root = s.doc.scene.definitions.get(s.doc.scene.rootId)!;
    expect(root.instances.get(copy.instanceIds[0]!)!.definitionId).toBe(definitionId);
    // Make Unique gives the copy its own definition, with the same (immutable) mesh.
    const unique = ok(s.execute('core.makeUnique', { instanceIds: [copy.instanceIds[0]!] }));
    const own = s.doc.scene.definitions.get(unique.definitionIds[0]!)!;
    expect(own.kind).toBe('mesh');
    expect(own.mesh).toBe(s.doc.scene.definitions.get(definitionId)!.mesh);
  });

  test('a bad mesh is refused', () => {
    const s = createSession();
    const r = s.execute('core.insertMesh', { name: 'x', mesh: { ...saveMesh(box()), positions: 'AAAA' }, position: [0, 0, 0] });
    expect(!r.ok && r.error.code).toBe('invalidMesh');
  });

  test('saved and opened again; not listed in the cut list', () => {
    const s = createSession();
    const { definitionId } = placed(s, box(), [5, 0, 0]);
    ok(s.execute('core.makeGroup', { instanceIds: [...s.doc.scene.definitions.get(s.doc.scene.rootId)!.instances.keys()] }));
    const doc = documentFromText(documentToText(s.doc))!;
    const def = doc.scene.definitions.get(definitionId)!;
    expect(def.kind).toBe('mesh');
    expect(triangleCount(def.mesh!)).toBe(12);
    expect(documentToText(doc)).toBe(documentToText(s.doc));
    expect(cutList(doc.scene, { waste: 0, includeHidden: true }).rows).toHaveLength(0);
  });

  test('a mesh kind without its mesh, or a mesh on another kind, does not open', () => {
    const s = createSession();
    const { definitionId } = placed(s, box());
    const data = JSON.parse(documentToText(s.doc));
    const raw = data.scene.definitions[definitionId];
    const without = structuredClone(data);
    delete without.scene.definitions[definitionId].mesh;
    expect(documentFromText(JSON.stringify(without))).toBeNull();
    const onGroup = structuredClone(data);
    onGroup.scene.definitions[definitionId].kind = 'group';
    expect(documentFromText(JSON.stringify(onGroup))).toBeNull();
    expect(raw.mesh.parts).toEqual([{ triangles: 12, color: '#808080' }]);
  });

  test('exported: STL triangles in world coordinates, mirrored ones turned around; a valid GLB in its colors or the instance paint', async () => {
    const s = createSession();
    const { instanceId } = placed(s, box(), [100, 0, 0]);
    expect(worldTriangles(s.doc.scene)).toHaveLength(12);
    expect(worldTriangles(s.doc.scene).flat().every((p) => p[0] >= 100 && p[0] <= 140)).toBe(true);
    ok(s.execute('core.flip', { instanceIds: [instanceId], axis: 'red' }));
    const [a, b, c] = worldTriangles(s.doc.scene)[0]!;
    // Still wound outwards after the mirror: the normal points away from the box center.
    const n = [(b![1] - a![1]) * (c![2] - a![2]) - (b![2] - a![2]) * (c![1] - a![1]), (b![2] - a![2]) * (c![0] - a![0]) - (b![0] - a![0]) * (c![2] - a![2]), (b![0] - a![0]) * (c![1] - a![1]) - (b![1] - a![1]) * (c![0] - a![0])];
    const center = [120, 10, 5];
    const toCenter = [center[0]! - a![0], center[1]! - a![1], center[2]! - a![2]];
    expect(n[0]! * toCenter[0]! + n[1]! * toCenter[1]! + n[2]! * toCenter[2]!).toBeLessThan(0);
    const plain = await validateBytes(exportGlb(s.doc.scene));
    expect(plain.issues.numErrors).toBe(0);
    const walnut = ok(s.execute('core.addMaterial', { starter: 'walnut' })).materialId;
    ok(s.execute('core.paint', { instanceIds: [instanceId], materialId: walnut }));
    const painted = await validateBytes(exportGlb(s.doc.scene));
    expect(painted.issues.numErrors).toBe(0);
  });
});
