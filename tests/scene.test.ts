import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createSession, deserializeDocument, rootModel, serializeDocument } from '../src/commands';
import { checkModel, createModel, faceCount, serialize } from '../src/kernel';
import {
  addDefinition,
  applyPoint,
  compose,
  contains,
  createScene,
  deserializeScene,
  findInstance,
  IDENTITY,
  instanceCount,
  inverse,
  pathDefinition,
  pathTransform,
  placedInstances,
  pruneDefinitions,
  putInstance,
  removeInstance,
  rotationAbout,
  serializeScene,
  snapTransform,
  toMatrix,
  translation,
  type Scene,
  type Transform,
} from '../src/scene';

const near = (a: readonly number[], b: readonly number[], tol = 1e-9) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
const quarter = (axis: [number, number, number]) => rotationAbout([0, 0, 0], axis, Math.PI / 2);

describe('transforms', () => {
  test('applying, composing and inverting', () => {
    const t = compose(translation([100, 0, 0]), quarter([0, 1, 0]));
    // A quarter turn around +Y takes +X to -Z, then the translation applies.
    expect(near(applyPoint(t, [10, 0, 0]), [100, 0, -10])).toBe(true);
    const back = applyPoint(inverse(t), applyPoint(t, [3, 4, 5]));
    expect(near(back, [3, 4, 5])).toBe(true);
    expect(near(applyPoint(compose(t, inverse(t)), [7, 8, 9]), [7, 8, 9])).toBe(true);
  });

  test('rotation about a center keeps the center fixed', () => {
    const r = rotationAbout([500, 0, 500], [0, 1, 0], Math.PI / 3);
    expect(near(applyPoint(r, [500, 0, 500]), [500, 0, 500])).toBe(true);
  });

  test('snapping makes quarter turns exact, so four of them compose back to the identity', () => {
    let t: Transform = IDENTITY;
    for (let i = 0; i < 4; i++) t = snapTransform(compose(quarter([0, 1, 0]), t));
    expect(t.rotation).toEqual([0, 0, 0, 1]);
    expect(snapTransform(quarter([0, 1, 0])).rotation).toEqual([0, Math.SQRT1_2, 0, Math.SQRT1_2]);
  });

  test('the matrix agrees with applyPoint', () => {
    const t = compose(translation([10, 20, 30]), rotationAbout([0, 0, 0], [1, 1, 0], 0.7));
    const m = toMatrix(t);
    const p: [number, number, number] = [3, -2, 5];
    const viaMatrix = [0, 1, 2].map((r) => m[r]! * p[0] + m[4 + r]! * p[1] + m[8 + r]! * p[2] + m[12 + r]!);
    expect(near(viaMatrix, applyPoint(t, p))).toBe(true);
  });
});

/** Root with a component definition placed twice, and a group nested inside the component. */
function sample(): { s: Scene; comp: string; group: string } {
  let s = createScene(createModel());
  let comp: string;
  let group: string;
  [comp, s] = addDefinition(s, { kind: 'component', name: 'Drawer', model: createModel(), instances: new Map() });
  [group, s] = addDefinition(s, { kind: 'group', name: '', model: createModel(), instances: new Map() });
  s = putInstance(s, comp, { id: 'i10', definitionId: group, name: 'front', transform: translation([0, 0, 500]) });
  s = putInstance(s, s.rootId, { id: 'i11', definitionId: comp, name: '', transform: translation([1000, 0, 0]) });
  s = putInstance(s, s.rootId, { id: 'i12', definitionId: comp, name: '', transform: translation([2000, 0, 0]) });
  return { s, comp, group };
}

describe('scene', () => {
  test('a new scene has just the root', () => {
    const s = createScene(createModel());
    expect(s.definitions.size).toBe(1);
    expect(s.definitions.get(s.rootId)!.kind).toBe('root');
  });

  test('finding instances, counting them and walking paths', () => {
    const { s, comp, group } = sample();
    expect(findInstance(s, 'i10')!.parent.id).toBe(comp);
    expect(instanceCount(s, comp)).toBe(2);
    expect(instanceCount(s, group)).toBe(1);
    const placed = placedInstances(s);
    expect(placed.map((p) => p.path.join('/'))).toEqual(['i11', 'i11/i10', 'i12', 'i12/i10']);
    // The nested group sits at the component's offset plus its own.
    expect(near(applyPoint(placed[3]!.world, [0, 0, 0]), [2000, 0, 500])).toBe(true);
    expect(near(applyPoint(pathTransform(s, ['i12', 'i10']), [0, 0, 0]), [2000, 0, 500])).toBe(true);
    expect(pathDefinition(s, ['i11', 'i10'])!.id).toBe(group);
    expect(pathDefinition(s, ['nope'])).toBeUndefined();
  });

  test('contains follows nesting and survives a cyclic scene', () => {
    const { s, comp, group } = sample();
    expect(contains(s, s.rootId, group)).toBe(true);
    expect(contains(s, group, comp)).toBe(false);
    const cyclic = putInstance(s, group, { id: 'i99', definitionId: comp, name: '', transform: IDENTITY });
    expect(contains(cyclic, comp, 'd404')).toBe(false);
  });

  test('removing the last instance and pruning drops unused definitions', () => {
    let { s, comp } = sample();
    s = removeInstance(s, s.rootId, 'i11');
    expect(pruneDefinitions(s).definitions.has(comp)).toBe(true);
    s = removeInstance(s, s.rootId, 'i12');
    expect(pruneDefinitions(s).definitions.size).toBe(1);
  });
});

describe('scene serialization (version 3)', () => {
  test('round-trips definitions, instances and transforms', () => {
    const { s } = sample();
    const json = JSON.parse(JSON.stringify(serializeScene(s)));
    const back = deserializeScene(json)!;
    expect(back).not.toBeNull();
    expect(serializeScene(back)).toEqual(serializeScene(s));
    expect(json.definitions[back.rootId].instances.i11.transform.scale).toEqual([1, 1, 1]);
  });

  const mutate = (fn: (j: ReturnType<typeof serializeScene>) => void) => {
    const j = JSON.parse(JSON.stringify(serializeScene(sample().s)));
    fn(j);
    return deserializeScene(j);
  };

  test.each([
    ['a scale other than 1 (Flip and Scale arrive in milestone 4)', (j: ReturnType<typeof serializeScene>) => (j.definitions[j.root]!.instances.i11!.transform.scale = [-1, 1, 1])],
    ['a rotation that is not a unit quaternion', (j: ReturnType<typeof serializeScene>) => (j.definitions[j.root]!.instances.i11!.transform.rotation = [0, 0, 0, 2])],
    ['an instance of a missing definition', (j: ReturnType<typeof serializeScene>) => (j.definitions[j.root]!.instances.i11!.definition = 'd404')],
    ['an instance of the root', (j: ReturnType<typeof serializeScene>) => (j.definitions[j.root]!.instances.i11!.definition = j.root)],
    ['a definition that contains itself', (j: ReturnType<typeof serializeScene>) => {
      const comp = j.definitions[j.root]!.instances.i11!.definition;
      const group = j.definitions[comp]!.instances.i10!.definition;
      j.definitions[group]!.instances.i98 = { definition: comp, name: '', transform: { rotation: [0, 0, 0, 1], translation: [0, 0, 0], scale: [1, 1, 1] } };
    }],
    ['a root that is not of kind root', (j: ReturnType<typeof serializeScene>) => (j.definitions[j.root]!.kind = 'group')],
    ['a broken model', (j: ReturnType<typeof serializeScene>) => (j.definitions[j.root]!.model = { kind: 'topology' } as never)],
  ])('rejects %s', (_, fn) => {
    expect(mutate(fn)).toBeNull();
  });
});

describe('documents', () => {
  test('new documents save as version 4 and load back', () => {
    const s = createSession();
    s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 1000, depth: 500 });
    const saved = JSON.parse(JSON.stringify(serializeDocument(s.doc)));
    expect(saved.version).toBe(4);
    expect(serializeDocument(deserializeDocument(saved)!)).toEqual(saved);
  });

  test('a milestone 2 (version 2) autosave becomes the root definition of a version 4 document', () => {
    const v2 = JSON.parse(readFileSync(join(__dirname, 'fixtures/milestone2-autosave.json'), 'utf8'));
    expect(v2.version).toBe(2);
    const doc = deserializeDocument(v2)!;
    expect(doc).not.toBeNull();
    expect(doc.units).toEqual({ unit: 'ft-in', precision: 16 });
    expect(doc.scene.definitions.size).toBe(1);
    expect(serialize(rootModel(doc))).toEqual(v2.model);
    expect(faceCount(rootModel(doc))).toBe(Object.keys(v2.model.faces).length);
    expect(checkModel(rootModel(doc))).toEqual([]);
    const saved = serializeDocument(doc);
    expect(saved.version).toBe(4);
    expect(saved.scene.definitions[saved.scene.root]!.model).toEqual(v2.model);
  });

  test('a milestone 1 (version 1) autosave converts through to version 4', () => {
    const v1 = JSON.parse(readFileSync(join(__dirname, 'fixtures/milestone1-autosave.json'), 'utf8'));
    const doc = deserializeDocument(v1)!;
    expect(serializeDocument(doc).version).toBe(4);
    expect(faceCount(rootModel(doc))).toBe(Object.keys(v1.model.faces).length);
  });

  test('commands default to the root definition and reject a missing one', () => {
    const s = createSession();
    expect(s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 1000, depth: 500 })).toMatchObject({ ok: true });
    expect(faceCount(rootModel(s.doc))).toBe(1);
    expect(s.execute('core.drawRectangle', { definitionId: 'd404', faceId: null, corner: [0, 0, 0], width: 1000, depth: 500 })).toMatchObject({
      ok: false,
      error: { code: 'noSuchDefinition' },
    });
  });

  test('clear model removes groups and components too', () => {
    const s = createSession({ ...createSession().doc, scene: sample().s });
    expect(s.execute('core.clearModel', {})).toMatchObject({ ok: true, changed: true });
    expect(s.doc.scene.definitions.size).toBe(1);
  });
});
