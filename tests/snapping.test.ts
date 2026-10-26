import { Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { createSession, definitionModel, type CommandSession } from '../src/commands';
import { bounds, listFaces, snapPoints, type Point3 } from '../src/kernel';
import {
  applyPoint,
  compose,
  contextRelation,
  findInstance,
  pathDefinition,
  pathTransform,
  putInstance,
  rotationAbout,
  translation,
  worldEdges,
  worldSnapPoints,
  type Transform,
} from '../src/scene';
import { Frame } from '../src/viewport/frame';

/*
 * Inference across instances and contexts: endpoints, midpoints and edges of
 * every placement are snap targets in world coordinates, including geometry
 * outside the open editing context, and a snapped world point lands at the
 * same place when a tool converts it into the context's local coordinates.
 */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

function box(s: CommandSession, x: number, z: number, w: number, d: number, h: number): string[] {
  const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [x, 0, z], width: w, depth: d }));
  ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: h }));
  return listFaces(definitionModel(s.doc)!).map((f) => f.id);
}

/** A component (a 400 x 200 x 300 box) with two instances, the second one turned a quarter and moved. */
function twoInstances() {
  const s = createSession();
  const c = ok(s.execute('core.makeComponent', { faceIds: box(s, 0, 0, 400, 300, 200) }));
  const copy = ok(s.execute('core.copyInstances', { instanceIds: [c.instanceId], translation: [0, 0, 0] }));
  const b = copy.instanceIds[0]!;
  const turned: Transform = compose(translation([1000, 0, 500]), rotationAbout([0, 0, 0], [0, 1, 0], Math.PI / 2));
  s.load({ ...s.doc, scene: putInstance(s.doc.scene, s.doc.scene.rootId, { ...findInstance(s.doc.scene, b)!.instance, transform: turned }) });
  return { s, a: c.instanceId, b, definitionId: c.definitionId, turned };
}

const near = (p: readonly number[], q: readonly number[]) => p.every((v, i) => Math.abs(v - q[i]!) < 1e-6);

describe('snap targets across instances', () => {
  test('another instance of the component being edited offers its corners in world coordinates', () => {
    const { s, a, b, definitionId, turned } = twoInstances();
    const context = [a];
    const snaps = worldSnapPoints(s.doc.scene);
    const local = snapPoints(definitionModel(s.doc, definitionId)!);
    for (const p of local) {
      const world = applyPoint(turned, p.point);
      const hit = snaps.find((x) => x.path[0] === b && near(x.point, world));
      expect(hit, `corner ${p.point} of the turned copy`).toBeDefined();
      // The other copy is outside the open context: faded, but a snap target.
      expect(contextRelation(hit!.path, context)).toBe('outside');
    }
    expect(snaps.filter((x) => contextRelation(x.path, context) === 'context')).toHaveLength(local.length);
  });

  test('faded geometry outside the context is a snap target: loose geometry of the root', () => {
    const { s, a } = twoInstances();
    box(s, 3000, 0, 100, 100, 100);
    const snaps = worldSnapPoints(s.doc.scene);
    const rootCorner = snaps.find((x) => x.path.length === 0 && near(x.point, [3100, 100, 100]));
    expect(rootCorner).toBeDefined();
    expect(contextRelation(rootCorner!.path, [a])).toBe('outside');
  });

  test('edges of every placement are inference targets with their path', () => {
    const { s, a, b } = twoInstances();
    const edges = worldEdges(s.doc.scene);
    expect(edges.filter((e) => e.path[0] === a)).toHaveLength(12);
    expect(edges.filter((e) => e.path[0] === b)).toHaveLength(12);
    // The turned copy's long edge along local X runs along world -Z.
    const long = edges.find((e) => e.path[0] === b && near(e.a, [1000, 0, 500]) && near(e.b, [1000, 0, 100]));
    const reversed = edges.find((e) => e.path[0] === b && near(e.b, [1000, 0, 500]) && near(e.a, [1000, 0, 100]));
    expect(long ?? reversed).toBeDefined();
  });

  test('nested instances are inside the context; their parents are outside', () => {
    expect(contextRelation([], [])).toBe('context');
    expect(contextRelation(['i2'], [])).toBe('inside');
    expect(contextRelation(['i2', 'i5'], ['i2'])).toBe('inside');
    expect(contextRelation([], ['i2'])).toBe('outside');
    expect(contextRelation(['i3'], ['i2'])).toBe('outside');
    expect(contextRelation(['i2'], ['i2'])).toBe('context');
  });
});

describe('drawing at a snapped point inside a context', () => {
  test('a line drawn inside one copy, from its corner to the other copy, ends exactly on the other copy', () => {
    const { s, a, b, definitionId } = twoInstances();
    // Move the first copy so its frame is not the world's.
    const ia = findInstance(s.doc.scene, a)!.instance;
    s.load({ ...s.doc, scene: putInstance(s.doc.scene, s.doc.scene.rootId, { ...ia, transform: translation([0, 0, 1500]) }) });
    const context = [a];
    const frame = new Frame(pathDefinition(s.doc.scene, context)!.id, pathTransform(s.doc.scene, context));
    const snaps = worldSnapPoints(s.doc.scene);
    // A corner of the other (turned) copy, picked as the viewport would: a world point.
    const target = snaps.find((x) => x.path[0] === b && x.kind === 'end' && x.point[1] === 200)!;
    const startWorld = new Vector3(400, 200, 1500 + 300);
    const start = frame.toLocal(startWorld);
    const end = frame.toLocal(new Vector3(...target.point));
    const dir: Point3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
    ok(s.execute('core.drawLine', { definitionId: frame.definitionId, start, direction: [...dir], length: Math.hypot(...dir) }));
    // The new vertex, placed through either copy's transform, is where it was snapped in that copy.
    const m = definitionModel(s.doc, definitionId)!;
    const placedInA = snapPoints(m).map((p) => applyPoint(pathTransform(s.doc.scene, context), p.point));
    expect(placedInA.some((p) => near(p, target.point))).toBe(true);
    expect(frame.definitionId).toBe(definitionId);
  });

  test('a rectangle drawn on the plane of a face in another group lands on that plane', () => {
    const s = createSession();
    const g = ok(s.execute('core.makeGroup', { faceIds: box(s, 0, 0, 1000, 1000, 500) }));
    const ig = findInstance(s.doc.scene, g.instanceId)!.instance;
    s.load({ ...s.doc, scene: putInstance(s.doc.scene, s.doc.scene.rootId, { ...ig, transform: translation([2000, 0, 0]) }) });
    // Editing the root, draw on the group's +X wall (world x = 3000), as the rectangle tool does.
    const frame = Frame.ROOT;
    const normal = frame.normalToLocal(new Vector3(1, 0, 0));
    ok(s.execute('core.drawRectangle', { faceId: null, normal, corner: frame.toLocal(new Vector3(3000, 100, 100)), width: 200, depth: 300 }));
    const root = definitionModel(s.doc)!;
    const faces = listFaces(root);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.normal).toEqual([1, 0, 0]);
    expect(bounds(root)).toEqual({ min: [3000, 100, 100], max: [3000, 400, 300] });
    // The group itself is untouched: geometry in different definitions never merges.
    expect(listFaces(definitionModel(s.doc, g.definitionId)!)).toHaveLength(6);
  });
});
