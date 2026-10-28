import { z } from 'zod';
import { t } from '../../i18n';
import { drawArc as drawKernelArc, getFace, GROUND_NORMAL, MAX_SEGMENTS, twoPointArc, type Model, type Vec3 } from '../../kernel';
import { withDefinitionModel, type PushformDocument } from '../document';
import type { CommandDef, CommandError, RunResult } from '../types';
import { definitionId, faceId, length, point3, targetModel } from './schemas';

const plane = {
  definitionId,
  /** Face to draw on, or null for the plane given by `normal` through the arc (the ground when omitted). */
  faceId: faceId.nullable(),
  normal: z.tuple([z.number(), z.number(), z.number()]).optional(),
};
const segments = z.number().int().min(2).max(MAX_SEGMENTS);

export const drawArcInput = z.strictObject({
  ...plane,
  start: point3,
  end: point3,
  /**
   * How far the middle of the arc is from the middle of the chord, in mm:
   * positive to the left of start-to-end, seen against the plane's normal.
   * More than half the chord gives the larger arc.
   */
  bulge: length,
  /** A radius in mm instead: the bulge then only says which side, and which of the two arcs. */
  radius: length.optional(),
  segments,
});
export type DrawArcInput = z.infer<typeof drawArcInput>;

export const drawArcCenterInput = z.strictObject({
  ...plane,
  center: point3,
  /** Where the arc starts; its distance from the center is the radius. */
  start: point3,
  /** Degrees, counter-clockwise about the plane's normal; less than a full turn either way. */
  angle: z.number(),
  segments,
});
export type DrawArcCenterInput = z.infer<typeof drawArcCenterInput>;

export interface DrawArcOutput {
  /** Faces created: a pie, regions the arc closed, and pieces of faces it split. */
  faceIds: string[];
}

/** The normal of the plane an arc is drawn in, or null when the face does not exist. */
function planeNormal(m: Model, input: { faceId: string | null; normal?: [number, number, number] | undefined }): Vec3 | null {
  if (input.faceId !== null) return getFace(m, input.faceId)?.normal ?? null;
  return input.normal ?? GROUND_NORMAL;
}

function draw(doc: PushformDocument, defId: string | undefined, m: Model, spec: Parameters<typeof drawKernelArc>[1]): RunResult<DrawArcOutput> {
  const r = drawKernelArc(m, spec);
  if (!r.ok) return { ok: false, error: { code: r.error } };
  return { ok: true, doc: withDefinitionModel(doc, defId, r.model), output: { faceIds: r.faceIds } };
}

const noSuchFace = (id: string | null): { ok: false; error: CommandError } => ({ ok: false, error: { code: 'noSuchFace', detail: id ?? '' } });

/**
 * A 2-point arc, as one curve: from start to end, bulging by `bulge` (or with
 * a radius). Typing a bulge, a radius like 300mmr, or a count like 24s amends it.
 */
export const drawArc: CommandDef<DrawArcInput, DrawArcOutput> = {
  id: 'core.drawArc',
  title: () => t('command.drawArc'),
  input: drawArcInput,
  amendable: [
    { key: 'bulge', mode: 'signed', clears: 'radius' },
    { key: 'segments', mode: 'positive', kind: 'count' },
    { key: 'radius', mode: 'positive', kind: 'radius' },
  ],
  amendHint: () => t('error.typeArc'),
  run(doc, input) {
    const target = targetModel(doc, input.definitionId);
    if (!target.ok) return target;
    const n = planeNormal(target.model, input);
    if (!n) return noSuchFace(input.faceId);
    const arc = twoPointArc(n, input.start, input.end, input.bulge, input.radius);
    if (!arc) return { ok: false, error: { code: input.radius === undefined ? 'tooSmall' : 'arcRadiusTooSmall' } };
    return draw(doc, input.definitionId, target.model, { faceId: input.faceId, normal: input.normal, center: arc.center, start: input.start, sweep: arc.sweep, segments: input.segments });
  },
};

const centered = (pie: boolean): Pick<CommandDef<DrawArcCenterInput, DrawArcOutput>, 'amendable' | 'amendHint' | 'run'> => ({
  amendable: [
    { key: 'angle', mode: 'signed', kind: 'angle' },
    { key: 'segments', mode: 'positive', kind: 'count' },
  ],
  amendHint: () => t('error.typeArcAngle'),
  run(doc, input) {
    const target = targetModel(doc, input.definitionId);
    if (!target.ok) return target;
    const sweep = (input.angle * Math.PI) / 180;
    return draw(doc, input.definitionId, target.model, { faceId: input.faceId, normal: input.normal, center: input.center, start: input.start, sweep, segments: input.segments, pie });
  },
});

/** An arc around a center (the Arc and 3-Point Arc tools). Typing an angle or a count like 24s amends it. */
export const drawArcCenter: CommandDef<DrawArcCenterInput, DrawArcOutput> = {
  id: 'core.drawArcCenter',
  title: () => t('command.drawArc'),
  input: drawArcCenterInput,
  ...centered(false),
};

/** A pie: an arc around a center and its two radii, a face of its own. Typing an angle or a count amends it. */
export const drawPie: CommandDef<DrawArcCenterInput, DrawArcOutput> = {
  id: 'core.drawPie',
  title: () => t('command.drawPie'),
  input: drawArcCenterInput,
  ...centered(true),
};
