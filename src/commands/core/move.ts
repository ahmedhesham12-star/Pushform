import { z } from 'zod';
import { t } from '../../i18n';
import { extractGeometry, hasEdge, hasFace, hasVertex, mergeGeometry, transformGeometry, transformSelection, type Model, type Vec3 } from '../../kernel';
import {
  applyPoint,
  applyVector,
  compose,
  getDefinition,
  putInstance,
  rotationAbout,
  snapTransform,
  transformAnnotations,
  translation,
  type InstanceId,
  type Scene,
  type Transform,
} from '../../scene';
import { withDefinitionModel, type PushformDocument } from '../document';
import type { CommandDef, CommandError, RunResult } from '../types';
import { placeCopy } from './instances';
import { definitionId, faceId, length, point3, targetModel } from './schemas';

/** Most copies one array may make. */
export const MAX_COPIES = 500;

const vector3 = z.tuple([z.number(), z.number(), z.number()]);
const selection = {
  /** The editing context the selection is in (the root when omitted). */
  definitionId,
  faceIds: z.array(faceId).optional(),
  edgeIds: z.array(z.string().min(1)).optional(),
  instanceIds: z.array(z.string().min(1)).optional(),
  /** Dimensions and text of the context; moved and turned, not copied. */
  annotationIds: z.array(z.string().min(1)).optional(),
};
const array = {
  /** How many copies; with `divide`, how many equal steps the distance or angle is split into. */
  copies: z.number().int().min(1).max(MAX_COPIES),
  /** False: copies at the distance (angle), twice it, and so on (x5). True: it divided into equal steps (/4). */
  divide: z.boolean(),
};
/** Single vertices, moved or turned on their own (a corner, for one); not copied. */
const vertexIds = z.array(z.string().min(1)).optional();
const moveFields = {
  ...selection,
  /** Direction of the move in the context's coordinates; any non-zero length, it is normalized. */
  direction: vector3,
  /** Distance along the direction in mm, so typing a new distance amends the move. */
  distance: length,
};
const rotateFields = {
  ...selection,
  /** A point on the axis, in the context's coordinates. */
  center: point3,
  /** Direction of the axis; any non-zero length, it is normalized. */
  axis: vector3,
  /** Angle in degrees, counter-clockwise looking against the axis, so typing a new angle amends it. */
  angle: z.number(),
};
type Ids = string[] | undefined;
const anything = (v: { faceIds?: Ids; edgeIds?: Ids; instanceIds?: Ids; vertexIds?: Ids; annotationIds?: Ids }) =>
  (v.faceIds?.length ?? 0) + (v.edgeIds?.length ?? 0) + (v.instanceIds?.length ?? 0) + (v.vertexIds?.length ?? 0) + (v.annotationIds?.length ?? 0) > 0;
const nothingSelected = { message: 'nothing selected' };

export const moveInput = z.strictObject({ ...moveFields, vertexIds }).refine(anything, nothingSelected);
export type MoveInput = z.infer<typeof moveInput>;
export const moveCopiesInput = z.strictObject({ ...moveFields, ...array }).refine(anything, nothingSelected);
export type MoveCopiesInput = z.infer<typeof moveCopiesInput>;
export const rotateInput = z.strictObject({ ...rotateFields, vertexIds }).refine(anything, nothingSelected);
export type RotateInput = z.infer<typeof rotateInput>;
export const rotateCopiesInput = z.strictObject({ ...rotateFields, ...array }).refine(anything, nothingSelected);
export type RotateCopiesInput = z.infer<typeof rotateCopiesInput>;

export interface MoveOutput {
  /** The moved (or copied) faces, edges, instances and annotations, for the selection afterwards. */
  faceIds: string[];
  edgeIds: string[];
  instanceIds: InstanceId[];
  annotationIds: string[];
}

type Selection = z.infer<z.ZodObject<typeof selection>> & { vertexIds?: string[] | undefined };
type Prepared = { ok: true; model: Model; faces: string[]; edges: string[]; vertices: string[]; instances: InstanceId[]; annotations: string[] };

/** The existing selection of a context that exists, or an error. */
function prepare(doc: PushformDocument, input: Selection): Prepared | { ok: false; error: CommandError } {
  const target = targetModel(doc, input.definitionId);
  if (!target.ok) return target;
  const context = getDefinition(doc.scene, input.definitionId ?? doc.scene.rootId)!;
  const placed = context.instances;
  const faces = (input.faceIds ?? []).filter((f) => hasFace(target.model, f));
  const edges = (input.edgeIds ?? []).filter((e) => hasEdge(target.model, e));
  const vertices = (input.vertexIds ?? []).filter((v) => hasVertex(target.model, v));
  const instances = [...new Set(input.instanceIds ?? [])].filter((i) => placed.has(i));
  const annotations = [...new Set(input.annotationIds ?? [])].filter((a) => context.annotations.has(a));
  if (!faces.length && !edges.length && !vertices.length && !instances.length && !annotations.length) {
    return { ok: false, error: { code: 'nothingSelected', detail: JSON.stringify(input) } };
  }
  return { ok: true, model: target.model, faces, edges, vertices, instances, annotations };
}

/** A non-zero vector made unit length, or null. */
function unit(v: readonly number[]): Vec3 | null {
  const len = Math.hypot(v[0]!, v[1]!, v[2]!);
  return len ? [v[0]! / len, v[1]! / len, v[2]! / len] : null;
}
const zeroDirection = { ok: false as const, error: { code: 'invalidInput', detail: 'zero direction or axis' } as CommandError };

/**
 * Apply a rigid transform to a selection: instances change their transform;
 * loose geometry moves, stretching what it is connected to, or the whole
 * command is refused when that would turn a face over or cross other geometry.
 */
function transformAll(doc: PushformDocument, input: Selection, p: Prepared, tr: Transform): RunResult<MoveOutput> {
  let next = doc;
  let faceIds = p.faces;
  let edgeIds = p.edges;
  if (faceIds.length || edgeIds.length || p.vertices.length) {
    const r = transformSelection(p.model, faceIds, edgeIds, (q) => applyPoint(tr, q), (n) => applyVector(tr, n), p.vertices);
    if (!r.ok) return { ok: false, error: { code: r.error } };
    next = withDefinitionModel(doc, input.definitionId, r.model);
    ({ faceIds, edgeIds } = r);
  }
  const contextId = input.definitionId ?? doc.scene.rootId;
  let scene = next.scene;
  for (const id of p.instances) {
    const i = getDefinition(scene, contextId)!.instances.get(id)!;
    scene = putInstance(scene, contextId, { ...i, transform: snapTransform(compose(tr, i.transform)) });
  }
  if (p.annotations.length) scene = transformAnnotations(scene, contextId, p.annotations, tr);
  const output = { faceIds, edgeIds, instanceIds: p.instances, annotationIds: p.annotations };
  return { ok: true, doc: scene === doc.scene ? doc : { ...next, scene }, output };
}

/**
 * Copies of a selection, the k-th placed with transformAt(k). Copies of loose
 * geometry merge where they land; component copies share their definition,
 * group copies get their own.
 */
function copyAll(doc: PushformDocument, input: Selection, p: Prepared, count: number, transformAt: (k: number) => Transform): RunResult<MoveOutput> {
  // Dimensions and text are not copied (a next step), so on their own there is nothing to copy.
  if (!p.faces.length && !p.edges.length && !p.instances.length) return { ok: false, error: { code: 'nothingSelected', detail: 'nothing to copy' } };
  const contextId = input.definitionId ?? doc.scene.rootId;
  const out: MoveOutput = { faceIds: [], edgeIds: [], instanceIds: [], annotationIds: [] };
  let model: Model = p.model;
  if (p.faces.length || p.edges.length) {
    const piece = extractGeometry(p.model, p.faces, p.edges).extracted;
    for (let k = 1; k <= count; k++) {
      const tr = transformAt(k);
      const r = mergeGeometry(model, transformGeometry(piece, (q) => applyPoint(tr, q), (n) => applyVector(tr, n)));
      model = r.model;
      out.faceIds.push(...r.faceIds);
      out.edgeIds.push(...r.edgeIds);
    }
  }
  let scene: Scene = withDefinitionModel(doc, input.definitionId, model).scene;
  for (const id of p.instances) {
    const original = getDefinition(scene, contextId)!.instances.get(id)!;
    for (let k = 1; k <= count; k++) {
      let copy: InstanceId;
      [copy, scene] = placeCopy(scene, contextId, original, compose(transformAt(k), original.transform));
      out.instanceIds.push(copy);
    }
  }
  // Later copies can merge into earlier ones: keep only what still exists.
  out.faceIds = out.faceIds.filter((f) => hasFace(model, f));
  out.edgeIds = out.edgeIds.filter((e) => hasEdge(model, e));
  return { ok: true, doc: { ...doc, scene }, output: out };
}

const scaled = (u: Vec3, s: number): [number, number, number] => [u[0] * s, u[1] * s, u[2] * s];
const radians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Move a selection of the editing context: groups and components change their
 * transform; loose geometry moves, stretching what it is connected to. A move
 * that would turn a stretched face over or cross other geometry is refused. Typing a distance
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
    const u = unit(input.direction);
    if (!u) return zeroDirection;
    if (input.distance === 0) return { ok: true, doc, output: { faceIds: p.faces, edgeIds: p.edges, instanceIds: p.instances, annotationIds: p.annotations } };
    return transformAll(doc, input, p, translation(scaled(u, input.distance)));
  },
};

/** Copy a selection along a direction: one copy at the distance, or an array (x5 or /4 afterwards). */
export const moveCopies: CommandDef<MoveCopiesInput, MoveOutput> = {
  id: 'core.moveCopies',
  title: () => t('command.copy'),
  input: moveCopiesInput,
  amendable: [
    { key: 'distance', mode: 'signed' },
    { key: 'copies', mode: 'positive', kind: 'array', flag: 'divide' },
  ],
  amendHint: () => t('error.typeDistanceOrArray'),
  run(doc, input) {
    const p = prepare(doc, input);
    if (!p.ok) return p;
    const u = unit(input.direction);
    if (!u) return zeroDirection;
    if (input.distance === 0) return { ok: false, error: { code: 'tooSmall', detail: 'copies need a distance' } };
    const step = input.divide ? input.distance / input.copies : input.distance;
    return copyAll(doc, input, p, input.copies, (k) => translation(scaled(u, step * k)));
  },
};

/**
 * Rotate a selection of the editing context about an axis through a center:
 * groups and components change their transform; loose geometry turns,
 * stretching (and folding) what it is connected to, unless that would turn a face over or cross other geometry.
 * Typing an angle afterwards amends it.
 */
export const rotate: CommandDef<RotateInput, MoveOutput> = {
  id: 'core.rotate',
  title: () => t('command.rotate'),
  input: rotateInput,
  amendable: [{ key: 'angle', mode: 'signed', kind: 'angle' }],
  amendHint: () => t('error.typeAngle'),
  run(doc, input) {
    const p = prepare(doc, input);
    if (!p.ok) return p;
    const axis = unit(input.axis);
    if (!axis) return zeroDirection;
    if (input.angle % 360 === 0) return { ok: true, doc, output: { faceIds: p.faces, edgeIds: p.edges, instanceIds: p.instances, annotationIds: p.annotations } };
    return transformAll(doc, input, p, rotationAbout(input.center, axis, radians(input.angle)));
  },
};

/** Rotated copies: one at the angle, or an array (x5 or /4 afterwards). */
export const rotateCopies: CommandDef<RotateCopiesInput, MoveOutput> = {
  id: 'core.rotateCopies',
  title: () => t('command.rotateCopy'),
  input: rotateCopiesInput,
  amendable: [
    { key: 'angle', mode: 'signed', kind: 'angle' },
    { key: 'copies', mode: 'positive', kind: 'array', flag: 'divide' },
  ],
  amendHint: () => t('error.typeAngleOrArray'),
  run(doc, input) {
    const p = prepare(doc, input);
    if (!p.ok) return p;
    const axis = unit(input.axis);
    if (!axis) return zeroDirection;
    if (input.angle === 0) return { ok: false, error: { code: 'tooSmall', detail: 'copies need an angle' } };
    const step = input.divide ? input.angle / input.copies : input.angle;
    return copyAll(doc, input, p, input.copies, (k) => rotationAbout(input.center, axis, radians(step * k)));
  },
};
