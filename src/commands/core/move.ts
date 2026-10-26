import { z } from 'zod';
import { t } from '../../i18n';
import {
  extractGeometry,
  hasEdge,
  hasFace,
  mergeGeometry,
  moveGeometry,
  transformGeometry,
  type Model,
  type Vec3,
} from '../../kernel';
import { compose, getDefinition, putInstance, snapTransform, translation, type InstanceId, type Scene } from '../../scene';
import { withDefinitionModel, type PushformDocument } from '../document';
import type { CommandDef, CommandError, RunResult } from '../types';
import { placeCopy } from './instances';
import { definitionId, faceId, length, targetModel } from './schemas';

/** Most copies one array may make. */
export const MAX_COPIES = 500;

const selection = {
  /** The editing context the selection is in (the root when omitted). */
  definitionId,
  faceIds: z.array(faceId).optional(),
  edgeIds: z.array(z.string().min(1)).optional(),
  instanceIds: z.array(z.string().min(1)).optional(),
  /** Direction of the move in the context's coordinates; any non-zero length, it is normalized. */
  direction: z.tuple([z.number(), z.number(), z.number()]),
  /** Distance along the direction in mm, so typing a new distance amends the move. */
  distance: length,
};
const anything = (v: { faceIds?: string[] | undefined; edgeIds?: string[] | undefined; instanceIds?: string[] | undefined }) =>
  (v.faceIds?.length ?? 0) + (v.edgeIds?.length ?? 0) + (v.instanceIds?.length ?? 0) > 0;

export const moveInput = z.strictObject(selection).refine(anything, { message: 'nothing selected' });
export type MoveInput = z.infer<typeof moveInput>;

export const moveCopiesInput = z
  .strictObject({
    ...selection,
    /** How many copies; with `divide`, how many equal steps the distance is split into. */
    copies: z.number().int().min(1).max(MAX_COPIES),
    /** False: copies at distance, 2 x distance, and so on (x5). True: the distance divided into equal steps (/4). */
    divide: z.boolean(),
  })
  .refine(anything, { message: 'nothing selected' });
export type MoveCopiesInput = z.infer<typeof moveCopiesInput>;

export interface MoveOutput {
  /** The moved (or copied) faces, edges and instances, for the selection afterwards. */
  faceIds: string[];
  edgeIds: string[];
  instanceIds: InstanceId[];
}

/** The selection of a context that exists, and the unit direction; or an error. */
function prepare(doc: PushformDocument, input: MoveInput) {
  const target = targetModel(doc, input.definitionId);
  if (!target.ok) return target;
  const [x, y, z] = input.direction;
  const len = Math.hypot(x, y, z);
  if (!len) return { ok: false as const, error: { code: 'invalidInput', detail: 'zero direction' } as CommandError };
  const placed = getDefinition(doc.scene, input.definitionId ?? doc.scene.rootId)!.instances;
  const faces = (input.faceIds ?? []).filter((f) => hasFace(target.model, f));
  const edges = (input.edgeIds ?? []).filter((e) => hasEdge(target.model, e));
  const instances = [...new Set(input.instanceIds ?? [])].filter((i) => placed.has(i));
  if (!faces.length && !edges.length && !instances.length) {
    return { ok: false as const, error: { code: 'nothingSelected', detail: JSON.stringify(input) } as CommandError };
  }
  const unit: Vec3 = [x / len, y / len, z / len];
  return { ok: true as const, model: target.model, faces, edges, instances, unit };
}

const scaled = (u: Vec3, s: number): [number, number, number] => [u[0] * s, u[1] * s, u[2] * s];

/**
 * Move a selection of the editing context: groups and components change their
 * transform; loose geometry moves, stretching what it is connected to. A move
 * that would bend or cross a stretched face is refused. Typing a distance
 * afterwards amends it.
 */
export const move: CommandDef<MoveInput, MoveOutput> = {
  id: 'core.move',
  title: () => t('command.move'),
  input: moveInput,
  amendable: [{ key: 'distance', mode: 'signed' }],
  amendHint: () => t('error.typeOneDistance'),
  run(doc, input) {
    const p = prepare(doc, input);
    if (!p.ok) return p;
    if (input.distance === 0) return { ok: true, doc, output: { faceIds: p.faces, edgeIds: p.edges, instanceIds: p.instances } };
    const vector = scaled(p.unit, input.distance);
    let next = doc;
    let faceIds = p.faces;
    let edgeIds = p.edges;
    if (faceIds.length || edgeIds.length) {
      const r = moveGeometry(p.model, faceIds, edgeIds, vector);
      if (!r.ok) return { ok: false, error: { code: r.error } };
      next = withDefinitionModel(doc, input.definitionId, r.model);
      ({ faceIds, edgeIds } = r);
    }
    const contextId = input.definitionId ?? doc.scene.rootId;
    let scene = next.scene;
    for (const id of p.instances) {
      const i = getDefinition(scene, contextId)!.instances.get(id)!;
      scene = putInstance(scene, contextId, { ...i, transform: snapTransform(compose(translation(vector), i.transform)) });
    }
    return { ok: true, doc: { ...next, scene }, output: { faceIds, edgeIds, instanceIds: p.instances } };
  },
};

/**
 * Copy a selection along a direction: one copy at the distance, or an array.
 * Copies of loose geometry merge where they land; component copies share
 * their definition, group copies get their own. Typing a distance, x5 or /4
 * afterwards amends it.
 */
export const moveCopies: CommandDef<MoveCopiesInput, MoveOutput> = {
  id: 'core.moveCopies',
  title: () => t('command.copy'),
  input: moveCopiesInput,
  amendable: [
    { key: 'distance', mode: 'signed' },
    { key: 'copies', mode: 'positive', kind: 'array', flag: 'divide' },
  ],
  amendHint: () => t('error.typeDistanceOrArray'),
  run(doc, input): RunResult<MoveOutput> {
    const p = prepare(doc, input);
    if (!p.ok) return p;
    if (input.distance === 0) return { ok: false, error: { code: 'tooSmall', detail: 'copies need a distance' } };
    const step = input.divide ? input.distance / input.copies : input.distance;
    const contextId = input.definitionId ?? doc.scene.rootId;
    const out: MoveOutput = { faceIds: [], edgeIds: [], instanceIds: [] };

    let model: Model = p.model;
    if (p.faces.length || p.edges.length) {
      const piece = extractGeometry(p.model, p.faces, p.edges).extracted;
      for (let k = 1; k <= input.copies; k++) {
        const offset = scaled(p.unit, step * k);
        const copy = transformGeometry(piece, (q) => [q[0] + offset[0], q[1] + offset[1], q[2] + offset[2]], (n) => n);
        const r = mergeGeometry(model, copy);
        model = r.model;
        out.faceIds.push(...r.faceIds);
        out.edgeIds.push(...r.edgeIds);
      }
    }
    let scene: Scene = withDefinitionModel(doc, input.definitionId, model).scene;
    for (const id of p.instances) {
      const original = getDefinition(scene, contextId)!.instances.get(id)!;
      for (let k = 1; k <= input.copies; k++) {
        let copy: InstanceId;
        [copy, scene] = placeCopy(scene, contextId, original, compose(translation(scaled(p.unit, step * k)), original.transform));
        out.instanceIds.push(copy);
      }
    }
    // Later copies can merge into earlier ones: keep only what still exists.
    out.faceIds = out.faceIds.filter((f) => hasFace(model, f));
    out.edgeIds = out.edgeIds.filter((e) => hasEdge(model, e));
    return { ok: true, doc: { ...doc, scene }, output: out };
  },
};
