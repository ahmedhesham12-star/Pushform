import { describe, expect, test } from 'vitest';
import { createSession, definitionModel, type CommandSession } from '../src/commands';
import { checkModel, connectedGeometry, edgeFaces, faceEdges, listEdges, listFaces } from '../src/kernel';
import { definitionBounds, findInstance, getDefinition, placedInstances } from '../src/scene';
import { applySelection } from '../src/tools/select';
import type { Selection } from '../src/tools/tool';
import { dragRect, segmentTouchesRect, windowHits, type ScreenPoint, type WindowItem } from '../src/tools/windowSelect';

/* All sizes in mm; screen positions in pixels. */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

/** A box in the root; returns the ids of its faces. */
function box(s: CommandSession, x: number, z: number, w: number, d: number, h: number): string[] {
  const before = new Set(listFaces(definitionModel(s.doc)!).map((f) => f.id));
  const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [x, 0, z], width: w, depth: d }));
  ok(s.execute('core.pushPull', { faceId: r.faceIds[0]!, distance: h }));
  return listFaces(definitionModel(s.doc)!)
    .map((f) => f.id)
    .filter((f) => !before.has(f));
}

const emptySelection = (): Selection => ({ faces: new Set(), edges: new Set(), instances: new Set(), hovered: null });

describe('double- and triple-click queries', () => {
  test('a face with its edges, an edge with its faces', () => {
    const s = createSession();
    box(s, 0, 0, 1000, 1000, 500);
    const m = definitionModel(s.doc)!;
    const top = listFaces(m).find((f) => f.normal[1] === 1)!;
    expect(faceEdges(m, top.id)).toHaveLength(4);
    for (const e of listEdges(m)) expect(edgeFaces(m, e.id)).toHaveLength(2);
  });

  test('a face with a hole lists the hole edges too', () => {
    const s = createSession();
    const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 1000, depth: 1000 }));
    ok(s.execute('core.drawRectangle', { faceId: r.faceIds[0]!, corner: [250, 0, 250], width: 500, depth: 500 }));
    const m = definitionModel(s.doc)!;
    const outer = listFaces(m).find((f) => f.holes.length)!;
    expect(faceEdges(m, outer.id)).toHaveLength(8);
  });

  test('connected geometry stays within one solid and takes attached lines', () => {
    const s = createSession();
    const a = box(s, 0, 0, 1000, 1000, 500);
    box(s, 3000, 0, 500, 500, 500);
    ok(s.execute('core.drawLine', { start: [1000, 500, 1000], direction: [1, 0, 0], length: 700 }));
    const m = definitionModel(s.doc)!;
    const all = connectedGeometry(m, [a[0]!], []);
    expect(all.faceIds.sort()).toEqual([...a].sort());
    expect(all.edgeIds).toHaveLength(13);
    expect(checkModel(m)).toEqual([]);
    // Starting from the loose line reaches the same solid.
    const line = listEdges(m).find((e) => e.a[0] === 1700 || e.b[0] === 1700)!;
    expect(connectedGeometry(m, [], [line.id]).faceIds).toHaveLength(6);
  });
});

describe('window and crossing selection', () => {
  const p = (x: number, y: number, visible = true): ScreenPoint => ({ x, y, visible });
  const square = (id: string, x: number, y: number, size: number): WindowItem => {
    const pts = [p(x, y), p(x + size, y), p(x + size, y + size), p(x, y + size)];
    return { id, points: pts, segments: pts.map((q, i) => [q, pts[(i + 1) % 4]!] as const), areas: [pts] };
  };

  test('dragging left to right is a window, right to left a crossing', () => {
    expect(dragRect({ x: 10, y: 50 }, { x: 100, y: 20 })).toEqual({ rect: { x0: 10, y0: 20, x1: 100, y1: 50 }, crossing: false });
    expect(dragRect({ x: 100, y: 20 }, { x: 10, y: 50 }).crossing).toBe(true);
  });

  test('a window takes only items fully inside; a crossing also items it touches', () => {
    const items = [square('inside', 20, 20, 10), square('partly', 80, 80, 40), square('outside', 300, 300, 10)];
    const rect = { x0: 0, y0: 0, x1: 100, y1: 100 };
    expect(windowHits(items, rect, false)).toEqual(['inside']);
    expect(windowHits(items, rect, true)).toEqual(['inside', 'partly']);
  });

  test('a crossing inside a large face takes the face; points behind the camera never count', () => {
    const big = square('big', 0, 0, 500);
    expect(windowHits([big], { x0: 200, y0: 200, x1: 260, y1: 240 }, true)).toEqual(['big']);
    expect(windowHits([big], { x0: 200, y0: 200, x1: 260, y1: 240 }, false)).toEqual([]);
    const behind: WindowItem = { id: 'behind', points: [p(10, 10, false), p(20, 20)], segments: [[p(10, 10, false), p(20, 20)]] };
    expect(windowHits([behind], { x0: 0, y0: 0, x1: 100, y1: 100 }, false)).toEqual([]);
  });

  test('segments crossing the rectangle touch it even with both ends outside', () => {
    const rect = { x0: 10, y0: 10, x1: 20, y1: 20 };
    expect(segmentTouchesRect(p(0, 15), p(30, 15), rect)).toBe(true);
    expect(segmentTouchesRect(p(0, 0), p(30, 5), rect)).toBe(false);
    expect(segmentTouchesRect(p(0, 30), p(30, 0), rect)).toBe(true);
  });
});

describe('selection modifiers', () => {
  test('replace, add, remove and toggle work the same for groups and components as for faces', () => {
    const sel = emptySelection();
    applySelection(sel, 'replace', { instances: ['i2'] });
    applySelection(sel, 'toggle', { instances: ['i3'] }, true);
    expect([...sel.instances]).toEqual(['i2', 'i3']);
    applySelection(sel, 'add', { faces: ['f1'] });
    expect(sel.faces.has('f1') && sel.instances.size === 2).toBe(true);
    applySelection(sel, 'toggle', { instances: ['i2'] }, false);
    expect([...sel.instances]).toEqual(['i3']);
    applySelection(sel, 'remove', { instances: ['i3'], faces: ['f1'] });
    expect(sel.instances.size + sel.faces.size).toBe(0);
  });

  test('a toggling window flips each item on its own', () => {
    const sel = emptySelection();
    applySelection(sel, 'replace', { faces: ['f1', 'f2'] });
    applySelection(sel, 'toggle', { faces: ['f2', 'f3'], instances: ['i4'] });
    expect([...sel.faces].sort()).toEqual(['f1', 'f3']);
    expect([...sel.instances]).toEqual(['i4']);
  });
});

describe('grouping a mixed selection', () => {
  test('two components selected with Shift are grouped into a nested group', () => {
    const s = createSession();
    const a = ok(s.execute('core.makeComponent', { faceIds: box(s, 0, 0, 500, 500, 500) }));
    const b = ok(s.execute('core.makeComponent', { faceIds: box(s, 1000, 0, 500, 500, 500) }));
    const before = definitionBounds(s.doc.scene, s.doc.scene.rootId);
    const sel = emptySelection();
    applySelection(sel, 'replace', { instances: [a.instanceId] });
    applySelection(sel, 'toggle', { instances: [b.instanceId] }, !sel.instances.has(b.instanceId));
    const g = ok(s.execute('core.makeGroup', { faceIds: [...sel.faces], edgeIds: [...sel.edges], instanceIds: [...sel.instances] }));
    const group = getDefinition(s.doc.scene, g.definitionId)!;
    expect(group.kind).toBe('group');
    expect([...group.instances.keys()].sort()).toEqual([a.instanceId, b.instanceId].sort());
    expect(getDefinition(s.doc.scene, s.doc.scene.rootId)!.instances.size).toBe(1);
    expect(placedInstances(s.doc.scene).map((p) => p.path.length)).toEqual([1, 2, 2]);
    expect(definitionBounds(s.doc.scene, s.doc.scene.rootId)).toEqual(before);
  });

  test('a component and loose geometry make a component holding both', () => {
    const s = createSession();
    const knob = ok(s.execute('core.makeComponent', { faceIds: box(s, 0, 0, 100, 100, 100), name: 'Knob' }));
    const front = box(s, 500, 0, 600, 20, 400);
    const r = ok(s.execute('core.makeComponent', { faceIds: front, instanceIds: [knob.instanceId], name: 'Front' }));
    const def = getDefinition(s.doc.scene, r.definitionId)!;
    expect(def.kind).toBe('component');
    expect(listFaces(def.model)).toHaveLength(6);
    expect(def.instances.has(knob.instanceId)).toBe(true);
    expect(findInstance(s.doc.scene, knob.instanceId)!.parent.id).toBe(r.definitionId);
    expect(listFaces(definitionModel(s.doc)!)).toHaveLength(0);
    expect(checkModel(def.model)).toEqual([]);
  });
});
