import { describe, expect, test } from 'vitest';
import { createSession, definitionModel, documentFromText, documentToText, type CommandSession } from '../src/commands';
import { listEdges, listFaces, vertexAt, edgeThrough, vertexPoint } from '../src/kernel';
import { dimensionLength, getDefinition, worldAnnotations, type Dimension } from '../src/scene';

/* Dimensions: anchored to geometry, they follow it through every command. All sizes in mm. */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

/** A 1000 x 600 box, 500 high, at the origin; returns its top face. */
function box(s: CommandSession, definitionId?: string): string {
  const r = ok(s.execute('core.drawRectangle', { definitionId, faceId: null, corner: [0, 0, 0], width: 1000, depth: 600 }));
  ok(s.execute('core.pushPull', { definitionId, faceId: r.faceIds[0]!, distance: 500 }));
  return top(s, definitionId);
}

const top = (s: CommandSession, definitionId?: string) =>
  listFaces(definitionModel(s.doc, definitionId)!).find((f) => f.normal[1] > 0.9 && f.outer[0]![1] > 0)!.id;

const dimension = (s: CommandSession, id: string, definitionId?: string): Dimension =>
  getDefinition(s.doc.scene, definitionId ?? s.doc.scene.rootId)!.annotations.get(id)!;

const lengthOf = (s: CommandSession, id: string, definitionId?: string) => dimensionLength(dimension(s, id, definitionId));

describe('kernel lookups for anchors', () => {
  test('a vertex at a point, an edge through a point, and where a vertex is', () => {
    const s = createSession();
    box(s);
    const m = definitionModel(s.doc)!;
    const v = vertexAt(m, [0, 500, 0], 1e-3)!;
    expect(vertexPoint(m, v)).toEqual([0, 500, 0]);
    expect(vertexAt(m, [0, 499, 0], 1e-3)).toBeNull();
    const e = edgeThrough(m, [0, 125, 0], 1e-3)!;
    const [a, b] = [vertexPoint(m, e.a)!, vertexPoint(m, e.b)!];
    expect([a[0] + (b[0] - a[0]) * e.t, a[1] + (b[1] - a[1]) * e.t, a[2] + (b[2] - a[2]) * e.t]).toEqual([0, 125, 0]);
    // Ends of an edge are vertices, not points through it.
    expect(edgeThrough(m, [0, 0, 0], 1e-3)).toBeNull();
    expect(vertexPoint(m, 'nope')).toBeUndefined();
  });
});

describe('dimension commands', () => {
  test('a dimension attaches its ends to vertices, edges, or nothing', () => {
    const s = createSession();
    box(s);
    const { annotationId } = ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [500, 500, 0], offset: [0, 0, -300] }));
    const d = dimension(s, annotationId);
    expect(d.start.ref).toMatchObject({ path: [], definitionId: s.doc.scene.rootId });
    expect(d.start.ref!.b).toBeUndefined();
    // (500, 500, 0) is the middle of the top front edge.
    expect(d.end.ref!.b).toBeDefined();
    expect(d.end.ref!.t).toBeCloseTo(0.5, 12);
    const free = ok(s.execute('core.addDimension', { start: [5000, 0, 0], end: [6000, 0, 0], offset: [0, 0, 100] }));
    expect(dimension(s, free.annotationId).start.ref).toBeUndefined();
    expect(lengthOf(s, free.annotationId)).toBe(1000);
  });

  test('ends at one point make no dimension; an unknown context is refused', () => {
    const s = createSession();
    const r = s.execute('core.addDimension', { start: [0, 0, 0], end: [0, 0, 0.001], offset: [0, 0, 1] });
    expect(r.ok ? null : r.error.code).toBe('tooSmall');
    const q = s.execute('core.addDimension', { definitionId: 'd99', start: [0, 0, 0], end: [1, 0, 0], offset: [0, 0, 1] });
    expect(q.ok ? null : q.error.code).toBe('noSuchDefinition');
  });

  test('push/pull carries an attached dimension; undo and redo restore each length', () => {
    const s = createSession();
    const face = box(s);
    const { annotationId } = ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [0, 500, 0], offset: [-200, 0, 0] }));
    ok(s.execute('core.pushPull', { faceId: face, distance: 200 }));
    expect(lengthOf(s, annotationId)).toBe(700);
    expect(dimension(s, annotationId).end.point).toEqual([0, 700, 0]);
    s.undo();
    expect(lengthOf(s, annotationId)).toBe(500);
    s.redo();
    expect(lengthOf(s, annotationId)).toBe(700);
  });

  test('a dimension at a midpoint stays at the middle as the edge stretches', () => {
    const s = createSession();
    const face = box(s);
    // From the bottom front-left corner to the middle of the left top edge (x = 0, z from 0 to 600).
    const { annotationId } = ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [0, 500, 300], offset: [-100, 0, 0] }));
    ok(s.execute('core.pushPull', { faceId: face, distance: 100 }));
    expect(dimension(s, annotationId).end.point).toEqual([0, 600, 300]);
  });

  test('moving and rotating geometry carries the dimension; amending the move too', () => {
    const s = createSession();
    box(s);
    const { annotationId } = ok(s.execute('core.addDimension', { start: [0, 500, 0], end: [1000, 500, 0], offset: [0, 0, -100] }));
    const everything = { faceIds: listFaces(definitionModel(s.doc)!).map((f) => f.id), edgeIds: listEdges(definitionModel(s.doc)!).map((e) => e.id) };
    ok(s.execute('core.move', { ...everything, direction: [0, 0, 1], distance: 250 }));
    expect(dimension(s, annotationId).start.point).toEqual([0, 500, 250]);
    ok(s.amend({ distance: 400 }));
    expect(dimension(s, annotationId).start.point).toEqual([0, 500, 400]);
    s.undo();
    ok(s.execute('core.rotate', { ...everything, center: [0, 0, 0], axis: [0, 1, 0], angle: 90 }));
    const d = dimension(s, annotationId);
    expect(d.end.point[0]).toBeCloseTo(0, 6);
    expect(d.end.point[2]).toBeCloseTo(-1000, 6);
    expect(dimensionLength(d)).toBeCloseTo(1000, 6);
  });

  test('a dimension follows geometry made into a group, then the group as it moves', () => {
    const s = createSession();
    box(s);
    const { annotationId } = ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [1000, 0, 0], offset: [0, 0, -100] }));
    const m = definitionModel(s.doc)!;
    const g = ok(s.execute('core.makeGroup', { faceIds: listFaces(m).map((f) => f.id), edgeIds: listEdges(m).map((e) => e.id) }));
    expect(dimension(s, annotationId).start.ref).toMatchObject({ path: [g.instanceId], definitionId: g.definitionId });
    ok(s.execute('core.move', { instanceIds: [g.instanceId], direction: [1, 0, 0], distance: 300 }));
    expect(dimension(s, annotationId).start.point).toEqual([300, 0, 0]);
    expect(dimension(s, annotationId).end.point).toEqual([1300, 0, 0]);
    // Editing inside the group moves the end it is attached to.
    const inner = definitionModel(s.doc, g.definitionId)!;
    const right = listFaces(inner).find((f) => f.normal[0] > 0.9)!.id;
    ok(s.execute('core.pushPull', { definitionId: g.definitionId, faceId: right, distance: 500 }));
    expect(lengthOf(s, annotationId)).toBe(1500);
  });

  test('exploding a group brings its dimensions up, still attached', () => {
    const s = createSession();
    box(s);
    const m = definitionModel(s.doc)!;
    const g = ok(s.execute('core.makeGroup', { faceIds: listFaces(m).map((f) => f.id), edgeIds: listEdges(m).map((e) => e.id) }));
    ok(s.execute('core.addDimension', { definitionId: g.definitionId, start: [0, 0, 0], end: [0, 500, 0], offset: [-100, 0, 0] }));
    ok(s.execute('core.move', { instanceIds: [g.instanceId], direction: [0, 0, 1], distance: 1000 }));
    ok(s.execute('core.explode', { instanceIds: [g.instanceId] }));
    const root = getDefinition(s.doc.scene, s.doc.scene.rootId)!;
    expect(root.annotations.size).toBe(1);
    const [id, d] = [...root.annotations][0]!;
    expect(d.start.point).toEqual([0, 0, 1000]);
    expect(d.start.ref).toMatchObject({ path: [], definitionId: s.doc.scene.rootId });
    ok(s.execute('core.pushPull', { faceId: top(s), distance: 100 }));
    expect(lengthOf(s, id)).toBe(600);
  });

  test('copies of a group keep their own dimensions, which follow each copy', () => {
    const s = createSession();
    box(s);
    const m = definitionModel(s.doc)!;
    const g = ok(s.execute('core.makeGroup', { faceIds: listFaces(m).map((f) => f.id), edgeIds: listEdges(m).map((e) => e.id) }));
    ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [1000, 0, 0], offset: [0, 0, -100] }));
    ok(s.execute('core.addDimension', { definitionId: g.definitionId, start: [0, 0, 0], end: [0, 500, 0], offset: [-100, 0, 0] }));
    const copy = ok(s.execute('core.copyInstances', { instanceIds: [g.instanceId], translation: [2000, 0, 0] }));
    const world = worldAnnotations(s.doc.scene);
    expect(world).toHaveLength(3);
    const inCopy = world.find((w) => w.path[0] === copy.instanceIds[0])!;
    expect(inCopy.annotation.start.point).toEqual([2000, 0, 0]);
    expect(inCopy.length).toBe(500);
  });

  test('erasing the geometry leaves the dimension in place, detached', () => {
    const s = createSession();
    const r = ok(s.execute('core.drawLine', { start: [0, 0, 0], direction: [1, 0, 0], length: 800 }));
    const { annotationId } = ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [800, 0, 0], offset: [0, 0, -100] }));
    ok(s.execute('core.erase', { faceIds: [], edgeIds: r.edgeIds }));
    const d = dimension(s, annotationId);
    expect(d.start.ref).toBeUndefined();
    expect(d.end.ref).toBeUndefined();
    expect(dimensionLength(d)).toBe(800);
  });

  test('erasing a dimension, with undo', () => {
    const s = createSession();
    const { annotationId } = ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [800, 0, 0], offset: [0, 0, -100] }));
    ok(s.execute('core.erase', { faceIds: [], edgeIds: [], annotationIds: [annotationId] }));
    expect(getDefinition(s.doc.scene, s.doc.scene.rootId)!.annotations.size).toBe(0);
    s.undo();
    expect(lengthOf(s, annotationId)).toBe(800);
    const r = s.execute('core.erase', { faceIds: [], edgeIds: [], annotationIds: ['a999'] });
    expect(r.ok ? null : r.error.code).toBe('nothingToErase');
  });

  test('dimensions are saved and opened with their references', () => {
    const s = createSession();
    const face = box(s);
    const { annotationId } = ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [0, 500, 300], offset: [-100, 0, 0] }));
    ok(s.execute('core.addDimension', { start: [5000, 0, 0], end: [6000, 0, 0], offset: [0, 0, 100] }));
    const reopened = documentFromText(documentToText(s.doc));
    expect(reopened).not.toBeNull();
    const t = createSession(reopened!);
    expect(getDefinition(t.doc.scene, t.doc.scene.rootId)!.annotations).toEqual(getDefinition(s.doc.scene, s.doc.scene.rootId)!.annotations);
    ok(t.execute('core.pushPull', { faceId: face, distance: 100 }));
    expect(dimension(t, annotationId).end.point).toEqual([0, 600, 300]);
  });

  test('a file with a broken dimension does not open', () => {
    const s = createSession();
    ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [800, 0, 0], offset: [0, 0, -100] }));
    const data = JSON.parse(documentToText(s.doc));
    const root = data.scene.definitions[data.scene.root];
    const id = Object.keys(root.annotations)[0]!;
    root.annotations[id].offset = [0, 0];
    expect(documentFromText(JSON.stringify(data))).toBeNull();
    root.annotations[id] = { kind: 'dimension', start: { point: [0, 0, 0], ref: { path: [], definition: 'd1', a: 'v1', b: 'v2', t: 2 } }, end: { point: [1, 0, 0] }, offset: [0, 0, 1] };
    expect(documentFromText(JSON.stringify(data))).toBeNull();
  });

  test('clearing the model removes dimensions too', () => {
    const s = createSession();
    ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [800, 0, 0], offset: [0, 0, -100] }));
    ok(s.execute('core.clearModel', {}));
    expect(getDefinition(s.doc.scene, s.doc.scene.rootId)!.annotations.size).toBe(0);
  });
});
