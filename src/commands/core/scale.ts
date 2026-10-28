import { z } from 'zod';
import { t } from '../../i18n';
import { getEdge, getFace, type Vec3 } from '../../kernel';
import { applyPoint, applyVector, definitionBounds, getDefinition, scaling, transformBounds } from '../../scene';
import type { PushformDocument } from '../document';
import type { AmendableField, CommandDef } from '../types';
import { anything, nothingSelected, prepare, selection, transformAll, vector3, vertexIds, type MoveOutput } from './move';
import { point3 } from './schemas';

/** A box in a context's coordinates: a center, axes at right angles and half sizes along them. */
export interface ScaleBox {
  center: Vec3;
  axes: [Vec3, Vec3, Vec3];
  half: [number, number, number];
}

const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const plus = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/**
 * The box Scale and Flip work in, in the context's coordinates: a lone group's
 * or component's own box (along its own axes), or else the box around the
 * selected geometry, groups, components, dimensions and text along the
 * context's axes. Null when there is nothing in it.
 */
export function selectionBox(
  doc: PushformDocument,
  sel: { definitionId?: string | undefined; faceIds?: readonly string[]; edgeIds?: readonly string[]; instanceIds?: readonly string[]; annotationIds?: readonly string[] },
): ScaleBox | null {
  const scene = doc.scene;
  const context = getDefinition(scene, sel.definitionId ?? scene.rootId);
  if (!context) return null;
  const [faces, edges, instances, annotations] = [sel.faceIds ?? [], sel.edgeIds ?? [], sel.instanceIds ?? [], sel.annotationIds ?? []];
  const lone = instances.length === 1 && !faces.length && !edges.length && !annotations.length ? context.instances.get(instances[0]!) : undefined;
  if (lone) {
    const b = definitionBounds(scene, lone.definitionId);
    if (!b) return null;
    const cols = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).map((e) => applyVector(lone.transform, e));
    const mid: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    return {
      center: applyPoint(lone.transform, mid),
      axes: cols.map((c) => c.map((x) => x / norm(c)) as unknown as Vec3) as ScaleBox['axes'],
      half: cols.map((c, k) => (norm(c) * (b.max[k]! - b.min[k]!)) / 2) as ScaleBox['half'],
    };
  }
  const points: Vec3[] = [];
  for (const f of faces) points.push(...(getFace(context.model, f)?.outer ?? []));
  for (const e of edges) {
    const v = getEdge(context.model, e);
    if (v) points.push(v.a, v.b);
  }
  for (const id of instances) {
    const i = context.instances.get(id);
    const b = i && transformBounds(i.transform, definitionBounds(scene, i.definitionId));
    if (b) points.push(b.min, b.max);
  }
  for (const id of annotations) {
    const a = context.annotations.get(id);
    if (a?.kind === 'dimension') points.push(a.start.point, a.end.point, plus(a.start.point, a.offset), plus(a.end.point, a.offset));
    else if (a?.kind === 'text') points.push(a.anchor.point, plus(a.anchor.point, a.leader));
  }
  if (!points.length) return null;
  const min = [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k]!)));
  const max = [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k]!)));
  return {
    center: [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    half: [(max[0]! - min[0]!) / 2, (max[1]! - min[1]!) / 2, (max[2]! - min[2]!) / 2],
  };
}

const factor = z.number().refine((v) => v !== 0 && Number.isFinite(v), { message: 'a factor cannot be zero' });
const FACTOR_KEYS = ['factor', 'factor2', 'factor3'] as const;

/** One factor per axis, or one for every direction; sizes to match; axes of unit length at right angles. */
function fits(v: { axes: number[][]; factor2?: number | undefined; factor3?: number | undefined; sizes: number[] }): boolean {
  const n = Math.max(1, v.axes.length);
  if ((v.factor2 !== undefined) !== n >= 2 || (v.factor3 !== undefined) !== n >= 3 || v.sizes.length !== n) return false;
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  return v.axes.every((a, i) => Math.abs(dot(a, a) - 1) <= 1e-9 && v.axes.slice(i + 1).every((b) => Math.abs(dot(a, b)) <= 1e-9));
}

export const scaleInput = z
  .strictObject({
    ...selection,
    vertexIds,
    /** The point that stays put (the opposite grip, or the center), in the context's coordinates. */
    origin: point3,
    /** Unit directions at right angles to scale along, in the context's coordinates; none scales the same in every direction. */
    axes: z.array(vector3).max(3),
    /** Factor along the first axis (every direction when there are none); negative mirrors. */
    factor,
    factor2: factor.optional(),
    factor3: factor.optional(),
    /** The selection's size in mm along each axis (with no axes, the distance the grip moves along), so a typed length becomes a factor. */
    sizes: z.array(z.number().positive()).min(1).max(3),
  })
  .refine(anything, nothingSelected)
  .refine(fits, { message: 'axes, factors and sizes do not match' });
export type ScaleInput = z.infer<typeof scaleInput>;

/**
 * Scale a selection of the editing context about a point: by one factor in
 * every direction, or along one to three axes. Loose geometry scales,
 * stretching what it is connected to (a negative factor mirrors it, and faces
 * keep facing outward); groups and components take the scale into their
 * transform, refused when it would skew one (scaleWouldSkew). Typing a factor
 * or a length afterwards amends it.
 */
export const scale: CommandDef<ScaleInput, MoveOutput> = {
  id: 'core.scale',
  title: () => t('command.scale'),
  input: scaleInput,
  amendable: (input) =>
    input.sizes.map((size, i): AmendableField<ScaleInput> => ({ key: FACTOR_KEYS[i]!, mode: 'signed', kind: 'factor', reference: size })),
  amendHint: () => t('error.typeScale'),
  run(doc, input) {
    const p = prepare(doc, input);
    if (!p.ok) return p;
    const factors = [input.factor, input.factor2, input.factor3].slice(0, input.sizes.length) as number[];
    if (factors.every((f) => f === 1)) return { ok: true, doc, output: { faceIds: p.faces, edgeIds: p.edges, instanceIds: p.instances, annotationIds: p.annotations } };
    return transformAll(doc, input, p, scaling(input.origin, input.axes as Vec3[], factors));
  },
};

/** Red, green and blue as box axes: red is x, green z and blue y (up). */
const AXIS_INDEX = { red: 0, green: 2, blue: 1 } as const;

export const flipInput = z.strictObject({ ...selection, axis: z.enum(['red', 'green', 'blue']) }).refine(anything, nothingSelected);
export type FlipInput = z.infer<typeof flipInput>;

/**
 * Flip a selection along the red, green or blue direction, about the middle
 * of its box: a lone group or component along its own axis (it stays where it
 * is, mirrored), anything else along the context's. Loose geometry is
 * mirrored with its faces still facing outward; instances take the mirror into
 * their transform.
 */
export const flip: CommandDef<FlipInput, MoveOutput> = {
  id: 'core.flip',
  title: () => t('command.flip'),
  input: flipInput,
  run(doc, input) {
    const p = prepare(doc, input);
    if (!p.ok) return p;
    const box = selectionBox(doc, { definitionId: input.definitionId, faceIds: p.faces, edgeIds: p.edges, instanceIds: p.instances, annotationIds: p.annotations });
    if (!box) return { ok: false, error: { code: 'nothingSelected', detail: 'nothing to flip' } };
    return transformAll(doc, input, p, scaling(box.center, [box.axes[AXIS_INDEX[input.axis]]], [-1]));
  },
};
