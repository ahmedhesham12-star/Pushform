import { describe, expect, test } from 'vitest';
import { createSession, definitionModel, documentFromText, documentToText, type CommandSession } from '../src/commands';
import { listEdges, listFaces, vertexAt, edgeThrough, vertexPoint } from '../src/kernel';
import { attachAnchor, dimensionLength, followAnchors, getDefinition, worldAnnotations, type Dimension, type LeaderText } from '../src/scene';

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
  getDefinition(s.doc.scene, definitionId ?? s.doc.scene.rootId)!.annotations.get(id)! as Dimension;

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
    const [id, d] = [...root.annotations][0]! as [string, Dimension];
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
    expect((inCopy.annotation as Dimension).start.point).toEqual([2000, 0, 0]);
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

describe('text commands', () => {
  test('leader text on a vertex follows it; editing changes what it says, in one undo step', () => {
    const s = createSession();
    const face = box(s);
    const { annotationId } = ok(s.execute('core.addText', { point: [0, 500, 0], leader: [-200, 200, 0], text: 'Corner' }));
    const text = () => getDefinition(s.doc.scene, s.doc.scene.rootId)!.annotations.get(annotationId) as LeaderText;
    expect(text().anchor.ref).toMatchObject({ path: [], definitionId: s.doc.scene.rootId });
    ok(s.execute('core.pushPull', { faceId: face, distance: 100 }));
    expect(text().anchor.point).toEqual([0, 600, 0]);
    expect(text().leader).toEqual([-200, 200, 0]);
    const before = s.doc;
    ok(s.execute('core.editText', { annotationId, text: 'Corner\nof the box' }));
    expect(text().text).toBe('Corner\nof the box');
    // Writing the same text again changes nothing, so there is no undo step for it.
    const r = s.execute('core.editText', { annotationId, text: 'Corner\nof the box' });
    expect(r.ok && r.changed).toBe(false);
    s.undo();
    expect(s.doc).toBe(before);
    expect(text().text).toBe('Corner');
  });

  test('text on a face stays where it was put', () => {
    const s = createSession();
    const face = box(s);
    const { annotationId } = ok(s.execute('core.addText', { point: [500, 500, 300], leader: [0, 300, 0], text: '0.60 m²' }));
    expect((getDefinition(s.doc.scene, s.doc.scene.rootId)!.annotations.get(annotationId) as LeaderText).anchor.ref).toBeUndefined();
    ok(s.execute('core.pushPull', { faceId: face, distance: 100 }));
    expect((getDefinition(s.doc.scene, s.doc.scene.rootId)!.annotations.get(annotationId) as LeaderText).anchor.point).toEqual([500, 500, 300]);
  });

  test('screen text shows once, even in a component placed twice', () => {
    const s = createSession();
    box(s);
    const m = definitionModel(s.doc)!;
    const c = ok(s.execute('core.makeComponent', { faceIds: listFaces(m).map((f) => f.id), edgeIds: listEdges(m).map((e) => e.id) }));
    ok(s.execute('core.addScreenText', { definitionId: c.definitionId, position: [0.1, 0.2], text: 'Cabinet' }));
    ok(s.execute('core.addText', { definitionId: c.definitionId, point: [0, 0, 0], leader: [0, 100, 0], text: 'Foot' }));
    ok(s.execute('core.copyInstances', { instanceIds: [c.instanceId], translation: [2000, 0, 0] }));
    const world = worldAnnotations(s.doc.scene);
    expect(world.filter((w) => w.annotation.kind === 'screenText')).toHaveLength(1);
    expect(world.filter((w) => w.annotation.kind === 'text')).toHaveLength(2);
    expect(world.every((w) => w.length === null)).toBe(true);
  });

  test('empty text, a screen position off the view and editing a dimension are refused', () => {
    const s = createSession();
    expect(s.execute('core.addText', { point: [0, 0, 0], leader: [0, 1, 0], text: '' }).ok).toBe(false);
    expect(s.execute('core.addScreenText', { position: [1.5, 0], text: 'A' }).ok).toBe(false);
    const { annotationId } = ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [800, 0, 0], offset: [0, 0, -100] }));
    const r = s.execute('core.editText', { annotationId, text: 'A' });
    expect(r.ok ? null : r.error.code).toBe('noSuchText');
  });

  test('text and screen text are saved and opened', () => {
    const s = createSession();
    box(s);
    ok(s.execute('core.addText', { point: [0, 500, 0], leader: [-200, 200, 0], text: 'Corner\nfront' }));
    ok(s.execute('core.addScreenText', { position: [0.05, 0.9], text: 'Kitchen, rev. 2' }));
    const reopened = documentFromText(documentToText(s.doc))!;
    expect(getDefinition(reopened.scene, reopened.scene.rootId)!.annotations).toEqual(getDefinition(s.doc.scene, s.doc.scene.rootId)!.annotations);
  });

  test('exploding brings text up to the parent', () => {
    const s = createSession();
    box(s);
    const m = definitionModel(s.doc)!;
    const g = ok(s.execute('core.makeGroup', { faceIds: listFaces(m).map((f) => f.id), edgeIds: listEdges(m).map((e) => e.id) }));
    ok(s.execute('core.addText', { definitionId: g.definitionId, point: [0, 500, 0], leader: [0, 100, 0], text: 'Top' }));
    ok(s.execute('core.move', { instanceIds: [g.instanceId], direction: [1, 0, 0], distance: 1000 }));
    ok(s.execute('core.explode', { instanceIds: [g.instanceId] }));
    const [, a] = [...getDefinition(s.doc.scene, s.doc.scene.rootId)!.annotations][0]! as [string, LeaderText];
    expect(a.anchor.point).toEqual([1000, 500, 0]);
    expect(a.anchor.ref).toMatchObject({ path: [] });
  });
});

describe('moving dimensions and text', () => {
  const root = (s: CommandSession) => getDefinition(s.doc.scene, s.doc.scene.rootId)!;
  const everything = (s: CommandSession) => {
    const m = definitionModel(s.doc)!;
    return { faceIds: listFaces(m).map((f) => f.id), edgeIds: listEdges(m).map((e) => e.id) };
  };

  test('a dimension moved on its own slides square to its line; its ends stay attached', () => {
    const s = createSession();
    box(s);
    const { annotationId } = ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [1000, 0, 0], offset: [0, 0, -100] }));
    ok(s.execute('core.move', { annotationIds: [annotationId], direction: [3, 0, -2], distance: Math.hypot(300, 200) }));
    const d = dimension(s, annotationId);
    expect(d.start.point).toEqual([0, 0, 0]);
    expect(d.end.point).toEqual([1000, 0, 0]);
    expect(d.start.ref).toBeDefined();
    expect(d.offset[0]).toBeCloseTo(0, 6);
    expect(d.offset[2]).toBeCloseTo(-300, 6);
    // Typing a distance afterwards amends the move.
    ok(s.amend({ distance: Math.hypot(600, 400) }));
    expect(dimension(s, annotationId).offset[2]).toBeCloseTo(-500, 6);
  });

  test('a dimension moved with its geometry keeps its offset', () => {
    const s = createSession();
    box(s);
    const { annotationId } = ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [1000, 0, 0], offset: [0, 0, -100] }));
    ok(s.execute('core.move', { ...everything(s), annotationIds: [annotationId], direction: [0, 0, -1], distance: 400 }));
    const d = dimension(s, annotationId);
    expect(d.start.point).toEqual([0, 0, -400]);
    expect(d.offset[2]).toBeCloseTo(-100, 6);
  });

  test('attached text moved on its own: the leader stretches, the point stays', () => {
    const s = createSession();
    box(s);
    const { annotationId } = ok(s.execute('core.addText', { point: [0, 500, 0], leader: [-200, 200, 0], text: 'Corner' }));
    ok(s.execute('core.move', { annotationIds: [annotationId], direction: [0, 1, 0], distance: 300 }));
    const a = root(s).annotations.get(annotationId) as LeaderText;
    expect(a.anchor.point).toEqual([0, 500, 0]);
    expect(a.anchor.ref).toBeDefined();
    expect(a.leader[1]).toBeCloseTo(500, 6);
  });

  test('free text moves whole, alone or with a selection; attached text keeps its leader when its geometry moves too', () => {
    const s = createSession();
    box(s);
    const free = ok(s.execute('core.addText', { point: [3000, 0, 0], leader: [0, 200, 0], text: 'Note' })).annotationId;
    const attached = ok(s.execute('core.addText', { point: [0, 500, 0], leader: [-200, 200, 0], text: 'Corner' })).annotationId;
    ok(s.execute('core.move', { annotationIds: [free], direction: [1, 0, 0], distance: 100 }));
    expect((root(s).annotations.get(free) as LeaderText).anchor.point).toEqual([3100, 0, 0]);
    ok(s.execute('core.move', { ...everything(s), annotationIds: [free, attached], direction: [0, 0, 1], distance: 250 }));
    const f = root(s).annotations.get(free) as LeaderText;
    const a = root(s).annotations.get(attached) as LeaderText;
    expect(f.anchor.point).toEqual([3100, 0, 250]);
    expect(f.leader).toEqual([0, 200, 0]);
    expect(a.anchor.point).toEqual([0, 500, 250]);
    expect(a.leader[0]).toBeCloseTo(-200, 6);
    expect(a.leader[1]).toBeCloseTo(200, 6);
    expect(a.leader[2]).toBeCloseTo(0, 6);
  });

  test('rotating free text turns it about the axis', () => {
    const s = createSession();
    const { annotationId } = ok(s.execute('core.addText', { point: [1000, 0, 0], leader: [100, 0, 0], text: 'Note' }));
    ok(s.execute('core.rotate', { annotationIds: [annotationId], center: [0, 0, 0], axis: [0, 1, 0], angle: 90 }));
    const a = root(s).annotations.get(annotationId) as LeaderText;
    expect(a.anchor.point[0]).toBeCloseTo(0, 6);
    expect(a.anchor.point[2]).toBeCloseTo(-1000, 6);
    expect(a.leader[2]).toBeCloseTo(-100, 6);
  });

  test('screen text does not move; dimensions and text alone make nothing to copy', () => {
    const s = createSession();
    const { annotationId } = ok(s.execute('core.addScreenText', { position: [0.1, 0.1], text: 'A' }));
    const r = s.execute('core.move', { annotationIds: [annotationId], direction: [1, 0, 0], distance: 100 });
    expect(r.ok && r.changed).toBe(false);
    const dim = ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [800, 0, 0], offset: [0, 0, -100] })).annotationId;
    const c = s.execute('core.moveCopies', { annotationIds: [dim], direction: [1, 0, 0], distance: 100, copies: 1, divide: false });
    expect(c.ok ? null : c.error.code).toBe('nothingSelected');
  });
});

describe('dimensions and text in new groups and components', () => {
  test('Make Group takes selected dimensions and text, still attached inside it; copies carry them', () => {
    const s = createSession();
    box(s);
    const dim = ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [0, 500, 0], offset: [-100, 0, 0] })).annotationId;
    const note = ok(s.execute('core.addText', { point: [1000, 500, 600], leader: [100, 100, 0], text: 'Back corner' })).annotationId;
    const m = definitionModel(s.doc)!;
    const g = ok(
      s.execute('core.makeGroup', { faceIds: listFaces(m).map((f) => f.id), edgeIds: listEdges(m).map((e) => e.id), annotationIds: [dim, note] }),
    );
    expect(getDefinition(s.doc.scene, s.doc.scene.rootId)!.annotations.size).toBe(0);
    const inside = getDefinition(s.doc.scene, g.definitionId)!.annotations;
    expect(inside.size).toBe(2);
    expect((inside.get(dim) as Dimension).start.ref).toMatchObject({ path: [], definitionId: g.definitionId });
    expect((inside.get(note) as LeaderText).anchor.ref).toMatchObject({ path: [], definitionId: g.definitionId });
    // Pushing the top inside the group stretches the dimension.
    const topFace = listFaces(definitionModel(s.doc, g.definitionId)!).find((f) => f.normal[1] > 0.9 && f.outer[0]![1] > 0)!.id;
    ok(s.execute('core.pushPull', { definitionId: g.definitionId, faceId: topFace, distance: 100 }));
    expect(dimensionLength(getDefinition(s.doc.scene, g.definitionId)!.annotations.get(dim) as Dimension)).toBe(600);
    // Undo puts everything back where it was.
    s.undo();
    s.undo();
    expect(getDefinition(s.doc.scene, s.doc.scene.rootId)!.annotations.size).toBe(2);
    s.redo();
    const copy = ok(s.execute('core.copyInstances', { instanceIds: [g.instanceId], translation: [3000, 0, 0] }));
    const inCopy = worldAnnotations(s.doc.scene).filter((w) => w.path[0] === copy.instanceIds[0]);
    expect(inCopy).toHaveLength(2);
    expect((inCopy.find((w) => w.annotation.kind === 'dimension')!.annotation as Dimension).start.point).toEqual([3000, 0, 0]);
  });

  test('a dimension taken into a component without its geometry comes loose', () => {
    const s = createSession();
    box(s);
    const dim = ok(s.execute('core.addDimension', { start: [0, 0, 0], end: [1000, 0, 0], offset: [0, 0, -100] })).annotationId;
    const text = ok(s.execute('core.addText', { point: [5000, 0, 0], leader: [0, 100, 0], text: 'Alone' })).annotationId;
    const c = ok(s.execute('core.makeComponent', { annotationIds: [dim, text] }));
    const inside = getDefinition(s.doc.scene, c.definitionId)!.annotations;
    expect((inside.get(dim) as Dimension).start.ref).toBeUndefined();
    expect(dimensionLength(inside.get(dim) as Dimension)).toBe(1000);
    expect(inside.has(text)).toBe(true);
  });
});

describe('attaching by position', () => {
  test('an anchor attached near a vertex takes its exact place, so following again changes nothing', () => {
    const s = createSession();
    ok(s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 500, depth: 500 }));
    const anchor = attachAnchor(s.doc.scene, s.doc.scene.rootId, [500.000001, 0, 0]);
    expect(anchor.ref).toBeDefined();
    expect(anchor.point).toEqual([500, 0, 0]);
    // Found by stress sweep 7 (seed 7079): an exploded dimension end, attached again 0.000001 mm off.
    ok(s.execute('core.addDimension', { start: [500.000001, 0, 0], end: [0, 0, 0], offset: [0, 0, -100] }));
    expect(followAnchors(s.doc.scene)).toBe(s.doc.scene);
  });
});
