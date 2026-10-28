import { z } from 'zod';
import { t } from '../../i18n';
import type { Vec3 } from '../../kernel';
import { scaling } from '../../scene';
import type { AmendableField, CommandDef } from '../types';
import { anything, nothingSelected, prepare, selection, transformAll, vector3, vertexIds, type MoveOutput } from './move';
import { point3 } from './schemas';

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
