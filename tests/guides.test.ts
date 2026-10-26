import { describe, expect, test } from 'vitest';
import { createSession, definitionModel, documentFromText, documentToText, serializeDocument, type CommandSession } from '../src/commands';
import { listFaces } from '../src/kernel';
import { getDefinition, worldGuides, type Guide } from '../src/scene';

/* Guides: lines and points a definition holds next to its geometry. All sizes in mm. */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

const guidesOf = (s: CommandSession, definitionId?: string): Map<string, Guide> =>
  new Map(getDefinition(s.doc.scene, definitionId ?? s.doc.scene.rootId)!.guides);

function box(s: CommandSession, x: number, z: number, w: number, d: number, h: number): string[] {
  const before = new Set(listFaces(definitionModel(s.doc)!).map((f) => f.id));
  const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [x, 0, z], width: w, depth: d }));
  ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: h }));
  return listFaces(definitionModel(s.doc)!)
    .map((f) => f.id)
    .filter((f) => !before.has(f));
}

describe('guide commands', () => {
  test('a guide line through two points has a unit direction', () => {
    const s = createSession();
    const { guideId } = ok(s.execute('core.addGuideLine', { point: [0, 0, 0], direction: [300, 0, 400] }));
    expect(guidesOf(s).get(guideId)).toEqual({ kind: 'line', point: [0, 0, 0], direction: [0.6, 0, 0.8] });
  });

  test('a guide parallel to an edge lies at the distance to the chosen side; typing amends the distance', () => {
    const s = createSession();
    // An edge along red at z = 0; the guide goes toward +z (only the part of side across the edge counts).
    const { guideId } = ok(s.execute('core.addGuideOffset', { point: [0, 0, 0], direction: [1, 0, 0], side: [0.5, 0, 2], distance: 300 }));
    expect(guidesOf(s).get(guideId)).toEqual({ kind: 'line', point: [0, 0, 300], direction: [1, 0, 0] });
    ok(s.amend({ distance: 450 }));
    expect([...guidesOf(s).values()]).toEqual([{ kind: 'line', point: [0, 0, 450], direction: [1, 0, 0] }]);
    expect(s.history()).toHaveLength(1);
  });

  test('a guide point at a distance from a point; typing amends it', () => {
    const s = createSession();
    ok(s.execute('core.addGuidePoint', { from: [100, 0, 0], direction: [0, 2, 0], distance: 250 }));
    expect([...guidesOf(s).values()]).toEqual([{ kind: 'point', point: [100, 250, 0] }]);
    ok(s.amend({ distance: 600 }));
    expect([...guidesOf(s).values()]).toEqual([{ kind: 'point', point: [100, 600, 0] }]);
  });

  test('a protractor guide turns the base direction about the axis; typing amends the angle', () => {
    const s = createSession();
    ok(s.execute('core.addGuideAngle', { center: [0, 0, 0], base: [1, 0, 0], axis: [0, 1, 0], angle: 90 }));
    const lineDirection = () => {
      const g = [...guidesOf(s).values()][0]!;
      return g.kind === 'line' ? g.direction : null;
    };
    // A quarter turn about blue (up) takes red to -green (z down), counter-clockwise looking down.
    expect(lineDirection()).toEqual([0, 0, -1]);
    ok(s.amend({ angle: 45 }));
    expect(lineDirection()![0]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(lineDirection()![2]).toBeCloseTo(-Math.SQRT1_2, 12);
  });

  test('bad input is refused: no direction, no side, no distance', () => {
    const s = createSession();
    expect(s.execute('core.addGuideLine', { point: [0, 0, 0], direction: [0, 0, 0] }).ok).toBe(false);
    expect(s.execute('core.addGuideOffset', { point: [0, 0, 0], direction: [1, 0, 0], side: [1, 0, 0], distance: 10 }).ok).toBe(false);
    expect(s.execute('core.addGuidePoint', { from: [0, 0, 0], direction: [1, 0, 0], distance: 0 }).ok).toBe(false);
    expect(s.history()).toHaveLength(0);
  });

  test('erase removes chosen guides; delete all guides empties the context; undo brings them back', () => {
    const s = createSession();
    const a = ok(s.execute('core.addGuideLine', { point: [0, 0, 0], direction: [1, 0, 0] })).guideId;
    const b = ok(s.execute('core.addGuidePoint', { from: [0, 0, 0], direction: [1, 0, 0], distance: 100 })).guideId;
    ok(s.execute('core.addGuidePoint', { from: [0, 0, 0], direction: [0, 0, 1], distance: 100 }));
    ok(s.execute('core.erase', { faceIds: [], edgeIds: [], guideIds: [a] }));
    expect([...guidesOf(s).keys()]).not.toContain(a);
    expect(guidesOf(s).has(b)).toBe(true);
    expect(ok(s.execute('core.deleteGuides', {})).count).toBe(2);
    expect(guidesOf(s).size).toBe(0);
    // Nothing left: no change, no undo step.
    const before = s.doc;
    expect(ok(s.execute('core.deleteGuides', {})).count).toBe(0);
    expect(s.doc).toBe(before);
    s.undo();
    expect(guidesOf(s).size).toBe(2);
  });

  test('clearing the model clears its guides', () => {
    const s = createSession();
    ok(s.execute('core.addGuideLine', { point: [0, 0, 0], direction: [1, 0, 0] }));
    ok(s.execute('core.clearModel', {}));
    expect(guidesOf(s).size).toBe(0);
  });
});

describe('guides in groups and components', () => {
  test('a guide inside a group lives in its definition and is placed with the group', () => {
    const s = createSession();
    const g = ok(s.execute('core.makeGroup', { faceIds: box(s, 1000, 0, 500, 500, 500) }));
    ok(s.execute('core.addGuidePoint', { definitionId: g.definitionId, from: [0, 0, 0], direction: [0, 1, 0], distance: 100 }));
    expect(guidesOf(s).size).toBe(0);
    expect(guidesOf(s, g.definitionId).size).toBe(1);
    // The group's origin is its minimum corner, (1000, 0, 0).
    expect(worldGuides(s.doc.scene).map((w) => w.guide)).toEqual([{ kind: 'point', point: [1000, 100, 0] }]);
  });

  test('exploding a group moves its guides up, placed where they were', () => {
    const s = createSession();
    const g = ok(s.execute('core.makeGroup', { faceIds: box(s, 1000, 0, 500, 500, 500) }));
    ok(s.execute('core.addGuideLine', { definitionId: g.definitionId, point: [0, 0, 0], direction: [0, 0, 1] }));
    ok(s.execute('core.explode', { instanceIds: [g.instanceId] }));
    expect([...guidesOf(s).values()]).toEqual([{ kind: 'line', point: [1000, 0, 0], direction: [0, 0, 1] }]);
  });

  test('a copied group keeps the guides of the original', () => {
    const s = createSession();
    const g = ok(s.execute('core.makeGroup', { faceIds: box(s, 0, 0, 500, 500, 500) }));
    ok(s.execute('core.addGuidePoint', { definitionId: g.definitionId, from: [0, 0, 0], direction: [0, 1, 0], distance: 100 }));
    ok(s.execute('core.moveCopies', { instanceIds: [g.instanceId], direction: [1, 0, 0], distance: 1000, copies: 1, divide: false }));
    expect(worldGuides(s.doc.scene).map((w) => w.guide.point)).toEqual([
      [0, 100, 0],
      [1000, 100, 0],
    ]);
  });
});

describe('guides in files', () => {
  test('guides are saved (version 4) and come back the same', () => {
    const s = createSession();
    ok(s.execute('core.addGuideLine', { point: [10, 20, 30], direction: [0, 1, 0] }));
    ok(s.execute('core.addGuidePoint', { from: [0, 0, 0], direction: [1, 0, 0], distance: 50 }));
    const text = documentToText(s.doc);
    expect(JSON.parse(text).version).toBe(4);
    const back = documentFromText(text)!;
    expect(serializeDocument(back)).toEqual(serializeDocument(s.doc));
    expect(getDefinition(back.scene, back.scene.rootId)!.guides).toEqual(guidesOf(s));
  });

  test('a definition without guides saves no guides key; a version 3 file opens with none', () => {
    const s = createSession();
    box(s, 0, 0, 500, 500, 500);
    const saved = serializeDocument(s.doc);
    expect(saved.scene.definitions[saved.scene.root]!.guides).toBeUndefined();
    const v3 = documentFromText(JSON.stringify({ ...saved, version: 3 }))!;
    expect(v3).not.toBeNull();
    expect(getDefinition(v3.scene, v3.scene.rootId)!.guides.size).toBe(0);
  });

  test('a broken guide makes the file invalid', () => {
    const s = createSession();
    ok(s.execute('core.addGuideLine', { point: [0, 0, 0], direction: [1, 0, 0] }));
    const saved = JSON.parse(documentToText(s.doc));
    const root = saved.scene.definitions[saved.scene.root];
    const id = Object.keys(root.guides)[0]!;
    root.guides[id] = { kind: 'line', point: [0, 0, 0], direction: [0, 0, 0] };
    expect(documentFromText(JSON.stringify(saved))).toBeNull();
    root.guides[id] = { kind: 'circle', point: [0, 0, 0] };
    expect(documentFromText(JSON.stringify(saved))).toBeNull();
  });
});
