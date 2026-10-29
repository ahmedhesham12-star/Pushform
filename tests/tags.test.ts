import { describe, expect, test } from 'vitest';
import { createSession, documentFromText, documentToText, serializeDocument, type CommandSession } from '../src/commands';
import { exportGlb, worldTriangles } from '../src/export';
import { listFaces } from '../src/kernel';
import { findInstance, getDefinition, placements, worldAnnotations, worldEdges, worldGuides, worldSnapPoints, type Scene } from '../src/scene';
import { InstancesView } from '../src/viewport/instancesView';

/* Tags (milestone 5, step 1): commands, what a hidden tag hides, and files. */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}
const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error!.code);

/** A box in the root (a rectangle pushed up), made a group or component; returns the instance and definition ids. */
function boxInstance(s: CommandSession, x: number, kind: 'makeGroup' | 'makeComponent' = 'makeGroup', definitionId?: string) {
  const faces = () => listFaces(getDefinition(s.doc.scene, definitionId ?? s.doc.scene.rootId)!.model).map((f) => f.id);
  const before = new Set(faces());
  const r = ok(s.execute('core.drawRectangle', { definitionId, faceId: null, corner: [x, 0, 0], width: 100, depth: 100 }));
  ok(s.execute('core.pushPull', { definitionId, faceId: r.faceIds[0]!, distance: 100 }));
  const faceIds = faces().filter((f) => !before.has(f));
  return ok(s.execute(`core.${kind}`, { definitionId, faceIds, ...(kind === 'makeComponent' ? { name: 'Box' } : {}) }));
}

const tagOf = (s: CommandSession, instanceId: string) => findInstance(s.doc.scene, instanceId)!.instance.tag;
const placedPaths = (scene: Scene, context: string[] = []) => placements(scene, context).map((p) => p.path.join('/'));

describe('tag commands', () => {
  test('new tags get the next free name and a color; rename, recolor, hide and show them', () => {
    const s = createSession();
    const a = ok(s.execute('core.addTag', {})).tagId;
    const b = ok(s.execute('core.addTag', {})).tagId;
    expect([...s.doc.scene.tags.values()].map((x) => [x.name, x.visible])).toEqual([
      ['Tag 1', true],
      ['Tag 2', true],
    ]);
    expect(s.doc.scene.tags.get(a)!.color).not.toBe(s.doc.scene.tags.get(b)!.color);
    ok(s.execute('core.renameTag', { tagId: a, name: '  Doors ' }));
    ok(s.execute('core.setTagColor', { tagId: a, color: '#AA3300' }));
    ok(s.execute('core.setTagVisible', { tagId: a, visible: false }));
    expect(s.doc.scene.tags.get(a)).toEqual({ name: 'Doors', color: '#aa3300', visible: false });
    // The freed name is used again.
    const c = ok(s.execute('core.addTag', {})).tagId;
    expect(s.doc.scene.tags.get(c)!.name).toBe('Tag 1');
    s.undo();
    s.undo();
    expect(s.doc.scene.tags.get(a)!.visible).toBe(true);
  });

  test('no change gives back the same document; bad input is refused', () => {
    const s = createSession();
    const a = ok(s.execute('core.addTag', { name: 'Shelves' })).tagId;
    const doc = s.doc;
    ok(s.execute('core.renameTag', { tagId: a, name: 'Shelves' }));
    ok(s.execute('core.setTagVisible', { tagId: a, visible: true }));
    expect(s.doc).toBe(doc);
    expect(code(s.execute('core.renameTag', { tagId: a, name: '   ' }))).toBe('invalidInput');
    expect(code(s.execute('core.setTagColor', { tagId: a, color: 'red' }))).toBe('invalidInput');
    expect(code(s.execute('core.setTagVisible', { tagId: 't999', visible: false }))).toBe('noSuchTag');
    expect(code(s.execute('core.deleteTag', { tagId: 't999' }))).toBe('noSuchTag');
  });

  test('groups, components, guides and annotations take a tag; loose geometry stays Untagged', () => {
    const s = createSession();
    const tag = ok(s.execute('core.addTag', {})).tagId;
    const g = boxInstance(s, 0);
    const r = ok(s.execute('core.drawRectangle', { faceId: null, corner: [500, 0, 0], width: 100, depth: 100 }));
    const { guideId } = ok(s.execute('core.addGuidePoint', { from: [0, 0, 0], direction: [1, 0, 0], distance: 50 }));
    const { annotationId } = ok(s.execute('core.addText', { point: [500, 0, 0], leader: [0, 100, 0], text: 'Note' }));
    expect(code(s.execute('core.setTag', { faceIds: r.faceIds, tagId: tag }))).toBe('looseGeometryUntagged');
    const out = ok(s.execute('core.setTag', { instanceIds: [g.instanceId], guideIds: [guideId], annotationIds: [annotationId], faceIds: r.faceIds, tagId: tag }));
    expect(out.looseSkipped).toBe(1);
    const root = getDefinition(s.doc.scene, s.doc.scene.rootId)!;
    expect([tagOf(s, g.instanceId), root.guides.get(guideId)!.tag, root.annotations.get(annotationId)!.tag]).toEqual([tag, tag, tag]);
    ok(s.execute('core.setTag', { instanceIds: [g.instanceId], tagId: null }));
    expect(tagOf(s, g.instanceId)).toBeUndefined();
    expect(code(s.execute('core.setTag', { instanceIds: [g.instanceId], tagId: 't999' }))).toBe('noSuchTag');
  });

  test('deleting a tag moves what is on it to Untagged, inside definitions too', () => {
    const s = createSession();
    const tag = ok(s.execute('core.addTag', {})).tagId;
    const outer = boxInstance(s, 0);
    const inner = boxInstance(s, 300, 'makeGroup', outer.definitionId);
    ok(s.execute('core.setTag', { instanceIds: [outer.instanceId], tagId: tag }));
    ok(s.execute('core.setTag', { definitionId: outer.definitionId, instanceIds: [inner.instanceId], tagId: tag }));
    ok(s.execute('core.deleteTag', { tagId: tag }));
    expect(s.doc.scene.tags.size).toBe(0);
    expect([tagOf(s, outer.instanceId), tagOf(s, inner.instanceId)]).toEqual([undefined, undefined]);
    s.undo();
    expect([tagOf(s, outer.instanceId), tagOf(s, inner.instanceId)]).toEqual([tag, tag]);
  });
});

describe('what a hidden tag hides', () => {
  /** A component used twice in the root, holding a nested group; tags on one instance and on the nested group. */
  function scene() {
    const s = createSession();
    const doors = ok(s.execute('core.addTag', { name: 'Doors' })).tagId;
    const hinges = ok(s.execute('core.addTag', { name: 'Hinges' })).tagId;
    const box = boxInstance(s, 0, 'makeComponent');
    const nested = boxInstance(s, 300, 'makeGroup', box.definitionId);
    const copy = ok(s.execute('core.copyInstances', { instanceIds: [box.instanceId], translation: [1000, 0, 0] })).instanceIds[0]!;
    ok(s.execute('core.setTag', { instanceIds: [copy], tagId: doors }));
    ok(s.execute('core.setTag', { definitionId: box.definitionId, instanceIds: [nested.instanceId], tagId: hinges }));
    return { s, doors, hinges, box, nested, copy };
  }

  test('a hidden instance hides everything in it; an item inside a definition hides on its own tag', () => {
    const { s, doors, hinges, box, nested, copy } = scene();
    const all = placedPaths(s.doc.scene);
    expect(all).toEqual(['', box.instanceId, `${box.instanceId}/${nested.instanceId}`, copy, `${copy}/${nested.instanceId}`]);
    ok(s.execute('core.setTagVisible', { tagId: doors, visible: false }));
    expect(placedPaths(s.doc.scene)).toEqual(['', box.instanceId, `${box.instanceId}/${nested.instanceId}`]);
    ok(s.execute('core.setTagVisible', { tagId: doors, visible: true }));
    ok(s.execute('core.setTagVisible', { tagId: hinges, visible: false }));
    // In both copies of the component, though neither copy is on Hinges.
    expect(placedPaths(s.doc.scene)).toEqual(['', box.instanceId, copy]);
  });

  test('the open editing context and the instances leading to it stay shown', () => {
    const { s, doors, hinges, copy, nested } = scene();
    ok(s.execute('core.setTagVisible', { tagId: doors, visible: false }));
    ok(s.execute('core.setTagVisible', { tagId: hinges, visible: false }));
    const context = [copy, nested.instanceId];
    expect(placedPaths(s.doc.scene, context)).toContain(`${copy}/${nested.instanceId}`);
  });

  test('hidden geometry gives no snap points, edges or meshes to pick; exports leave it out', () => {
    const { s, doors, copy } = scene();
    const before = { snaps: worldSnapPoints(s.doc.scene).length, edges: worldEdges(s.doc.scene).length, triangles: worldTriangles(s.doc.scene).length };
    ok(s.execute('core.setTagVisible', { tagId: doors, visible: false }));
    const scene2 = s.doc.scene;
    expect(worldSnapPoints(scene2).some((p) => p.path[0] === copy)).toBe(false);
    expect(worldEdges(scene2).some((e) => e.path[0] === copy)).toBe(false);
    expect(worldSnapPoints(scene2).length).toBe(before.snaps / 2);
    expect(worldEdges(scene2).length).toBe(before.edges / 2);
    expect(worldTriangles(scene2).length).toBe(before.triangles / 2);
    const view = new InstancesView();
    view.build(scene2, []);
    expect(view.pickables.some((m) => m.userData.placement.path[0] === copy)).toBe(false);
    view.build(scene2, [copy]);
    expect(view.pickables.some((m) => m.userData.placement.path[0] === copy)).toBe(true);
    const glb = new TextDecoder().decode(exportGlb(scene2));
    expect((glb.match(/"mesh":/g) ?? []).length).toBe(2);
  });

  test('guides and annotations on a hidden tag are not shown or snapped to', () => {
    const s = createSession();
    const tag = ok(s.execute('core.addTag', {})).tagId;
    const { guideId } = ok(s.execute('core.addGuideLine', { point: [0, 0, 0], direction: [1, 0, 0] }));
    ok(s.execute('core.addGuideLine', { point: [0, 0, 500], direction: [1, 0, 0] }));
    const { annotationId } = ok(s.execute('core.addScreenText', { position: [0.1, 0.1], text: 'Title' }));
    ok(s.execute('core.setTag', { guideIds: [guideId], annotationIds: [annotationId], tagId: tag }));
    ok(s.execute('core.setTagVisible', { tagId: tag, visible: false }));
    expect(worldGuides(s.doc.scene).map((g) => g.guideId)).not.toContain(guideId);
    expect(worldGuides(s.doc.scene).length).toBe(1);
    expect(worldAnnotations(s.doc.scene)).toEqual([]);
  });

  test('Explode keeps the tags of what was inside', () => {
    const s = createSession();
    const tag = ok(s.execute('core.addTag', {})).tagId;
    const outer = boxInstance(s, 0);
    const inner = boxInstance(s, 300, 'makeGroup', outer.definitionId);
    const { guideId } = ok(s.execute('core.addGuidePoint', { definitionId: outer.definitionId, from: [0, 0, 0], direction: [1, 0, 0], distance: 10 }));
    ok(s.execute('core.setTag', { definitionId: outer.definitionId, instanceIds: [inner.instanceId], guideIds: [guideId], tagId: tag }));
    const out = ok(s.execute('core.explode', { instanceIds: [outer.instanceId] }));
    const root = getDefinition(s.doc.scene, s.doc.scene.rootId)!;
    expect(root.instances.get(out.instanceIds[0]!)!.tag).toBe(tag);
    expect([...root.guides.values()].map((g) => g.tag)).toEqual([tag]);
  });
});

describe('tags in files', () => {
  test('tags, their visibility and what is on them are saved and come back the same', () => {
    const s = createSession();
    const tag = ok(s.execute('core.addTag', { name: 'Carcass', color: '#336699' })).tagId;
    ok(s.execute('core.addTag', {}));
    const g = boxInstance(s, 0);
    const { guideId } = ok(s.execute('core.addGuideLine', { point: [0, 0, 0], direction: [0, 1, 0] }));
    ok(s.execute('core.setTag', { instanceIds: [g.instanceId], guideIds: [guideId], tagId: tag }));
    ok(s.execute('core.setTagVisible', { tagId: tag, visible: false }));
    const text = documentToText(s.doc);
    const back = documentFromText(text)!;
    expect(serializeDocument(back)).toEqual(serializeDocument(s.doc));
    expect(back.scene.tags).toEqual(s.doc.scene.tags);
    expect([...back.scene.tags.keys()]).toEqual([...s.doc.scene.tags.keys()]);
    expect(placedPaths(back.scene)).toEqual(['']);
  });

  test('a version 4 file opens with no tags; a reference to a missing tag or a bad tag makes a file invalid', () => {
    const s = createSession();
    const tag = ok(s.execute('core.addTag', {})).tagId;
    const g = boxInstance(s, 0);
    const plain = serializeDocument(s.doc);
    const v4 = { ...plain, version: 4, scene: { ...plain.scene, tags: undefined } };
    expect(documentFromText(JSON.stringify(v4))!.scene.tags.size).toBe(0);
    ok(s.execute('core.setTag', { instanceIds: [g.instanceId], tagId: tag }));
    const saved = JSON.parse(documentToText(s.doc));
    const broken = structuredClone(saved);
    delete broken.scene.tags[tag];
    expect(documentFromText(JSON.stringify(broken))).toBeNull();
    const badColor = structuredClone(saved);
    badColor.scene.tags[tag].color = 'blue';
    expect(documentFromText(JSON.stringify(badColor))).toBeNull();
  });
});
