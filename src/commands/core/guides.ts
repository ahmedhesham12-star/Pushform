import { z } from 'zod';
import { t } from '../../i18n';
import { addGuide, getDefinition, guideLine, guidePoint, quatFromAxisAngle, quatRotate, removeGuides, type Guide } from '../../scene';
import type { PushformDocument } from '../document';
import type { CommandDef, RunResult } from '../types';
import { definitionId, length, point3 } from './schemas';

const vector3 = z.tuple([z.number(), z.number(), z.number()]);

export interface GuideOutput {
  guideId: string;
}

/** Add a guide to the editing context (the root when definitionId is omitted). */
function place(doc: PushformDocument, id: string | undefined, guide: Guide | null): RunResult<GuideOutput> {
  const contextId = id ?? doc.scene.rootId;
  if (!getDefinition(doc.scene, contextId)) return { ok: false, error: { code: 'noSuchDefinition', detail: id ?? '' } };
  if (!guide) return { ok: false, error: { code: 'invalidInput', detail: 'zero direction' } };
  const [guideId, scene] = addGuide(doc.scene, contextId, guide);
  return { ok: true, doc: { ...doc, scene }, output: { guideId } };
}

const unit = (v: readonly number[]): [number, number, number] | null => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return l > 1e-9 ? [v[0]! / l, v[1]! / l, v[2]! / l] : null;
};

export const addGuideLineInput = z.strictObject({
  definitionId,
  /** A point on the line, in the context's coordinates. */
  point: point3,
  /** Its direction; any non-zero length. */
  direction: vector3,
});
export type AddGuideLineInput = z.infer<typeof addGuideLineInput>;

/** A guide line through a point (Tape Measure from one point to another: the line through both). */
export const addGuideLine: CommandDef<AddGuideLineInput, GuideOutput> = {
  id: 'core.addGuideLine',
  title: () => t('command.addGuide'),
  input: addGuideLineInput,
  run: (doc, input) => place(doc, input.definitionId, guideLine(input.point, input.direction)),
};

export const addGuideOffsetInput = z.strictObject({
  definitionId,
  /** A point on the line the guide is parallel to (an edge), and its direction. */
  point: point3,
  direction: vector3,
  /** The side the guide lies on, across the line. */
  side: vector3,
  /** How far from the line, in mm; typing a new distance amends it. */
  distance: length,
});
export type AddGuideOffsetInput = z.infer<typeof addGuideOffsetInput>;

/** A guide line parallel to a line (Tape Measure from an edge), at a distance to one side. */
export const addGuideOffset: CommandDef<AddGuideOffsetInput, GuideOutput> = {
  id: 'core.addGuideOffset',
  title: () => t('command.addGuide'),
  input: addGuideOffsetInput,
  amendable: [{ key: 'distance', mode: 'positive' }],
  amendHint: () => t('error.typeOneDistance'),
  run(doc, input) {
    const dir = unit(input.direction);
    // Only the part of `side` across the line counts.
    const across = dir && unit(input.side.map((s, i) => s - dir[i]! * (input.side[0] * dir[0] + input.side[1] * dir[1] + input.side[2] * dir[2])));
    if (!dir || !across || input.distance <= 0) return { ok: false, error: { code: 'invalidInput', detail: 'no side or distance' } };
    const p = input.point.map((c, i) => c + across[i]! * input.distance) as [number, number, number];
    return place(doc, input.definitionId, guideLine(p, dir));
  },
};

export const addGuidePointInput = z.strictObject({
  definitionId,
  /** The point measured from, the direction measured in, and the distance (typing a new one amends it). */
  from: point3,
  direction: vector3,
  distance: length,
});
export type AddGuidePointInput = z.infer<typeof addGuidePointInput>;

/** A guide point at a distance from a point (Tape Measure from a point to anywhere). */
export const addGuidePoint: CommandDef<AddGuidePointInput, GuideOutput> = {
  id: 'core.addGuidePoint',
  title: () => t('command.addGuide'),
  input: addGuidePointInput,
  amendable: [{ key: 'distance', mode: 'positive' }],
  amendHint: () => t('error.typeOneDistance'),
  run(doc, input) {
    const dir = unit(input.direction);
    if (!dir || input.distance <= 0) return { ok: false, error: { code: 'invalidInput', detail: 'no direction or distance' } };
    return place(doc, input.definitionId, guidePoint(input.from.map((c, i) => c + dir[i]! * input.distance) as [number, number, number]));
  },
};

export const addGuideAngleInput = z.strictObject({
  definitionId,
  /** The protractor's center and the base direction the angle is measured from. */
  center: point3,
  base: vector3,
  /** The protractor's axis (its normal). */
  axis: vector3,
  /** Degrees, counter-clockwise looking against the axis; typing a new angle amends it. */
  angle: z.number(),
});
export type AddGuideAngleInput = z.infer<typeof addGuideAngleInput>;

/** A guide line through a center at an angle from a base direction (the Protractor). */
export const addGuideAngle: CommandDef<AddGuideAngleInput, GuideOutput> = {
  id: 'core.addGuideAngle',
  title: () => t('command.addGuide'),
  input: addGuideAngleInput,
  amendable: [{ key: 'angle', mode: 'signed', kind: 'angle' }],
  amendHint: () => t('error.typeAngle'),
  run(doc, input) {
    const axis = unit(input.axis);
    if (!axis) return { ok: false, error: { code: 'invalidInput', detail: 'zero axis' } };
    const direction = quatRotate(quatFromAxisAngle(axis, (input.angle * Math.PI) / 180), input.base);
    return place(doc, input.definitionId, guideLine(input.center, direction));
  },
};

export const deleteGuidesInput = z.strictObject({ definitionId });
export type DeleteGuidesInput = z.infer<typeof deleteGuidesInput>;

/** Delete every guide of the editing context (the root when definitionId is omitted). */
export const deleteGuides: CommandDef<DeleteGuidesInput, { count: number }> = {
  id: 'core.deleteGuides',
  title: () => t('command.deleteGuides'),
  input: deleteGuidesInput,
  run(doc, input) {
    const contextId = input.definitionId ?? doc.scene.rootId;
    const d = getDefinition(doc.scene, contextId);
    if (!d) return { ok: false, error: { code: 'noSuchDefinition', detail: input.definitionId ?? '' } };
    const scene = removeGuides(doc.scene, contextId);
    return { ok: true, doc: scene === doc.scene ? doc : { ...doc, scene }, output: { count: d.guides.size } };
  },
};
