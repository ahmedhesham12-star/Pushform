import { z } from 'zod';
import { t } from '../../i18n';
import { drawRegularPolygon, MAX_SEGMENTS } from '../../kernel';
import type { CommandDef } from '../types';
import { faceId, length, point3 } from './schemas';

const shape = {
  /** Face to draw on, or null for the ground. */
  faceId: faceId.nullable(),
  /** Center, on the target plane. */
  center: point3,
  /** Distance from the center to each corner, in mm. */
  radius: length,
  /** Direction from the center to the first corner; projected onto the plane. Optional. */
  direction: z.tuple([z.number(), z.number(), z.number()]).nullable(),
};
const count = z.number().int().min(3).max(MAX_SEGMENTS);

export const drawCircleInput = z.strictObject({ ...shape, segments: count });
export type DrawCircleInput = z.infer<typeof drawCircleInput>;
export const drawPolygonInput = z.strictObject({ ...shape, sides: count });
export type DrawPolygonInput = z.infer<typeof drawPolygonInput>;

export interface DrawShapeOutput {
  /** Faces created: the shape's regions and pieces of faces it overlaps. */
  faceIds: string[];
}

/** A circle as one curve of `segments` edges. Typing a radius or a count like 48s amends it. */
export const drawCircle: CommandDef<DrawCircleInput, DrawShapeOutput> = {
  id: 'core.drawCircle',
  title: () => t('command.drawCircle'),
  input: drawCircleInput,
  amendable: [
    { key: 'radius', mode: 'positive' },
    { key: 'segments', mode: 'positive', kind: 'count' },
  ],
  amendHint: () => t('error.typeRadiusOrSegments'),
  run(doc, input) {
    const r = drawRegularPolygon(doc.model, { kind: 'circle', ...input });
    if (!r.ok) return { ok: false, error: { code: r.error } };
    return { ok: true, doc: { ...doc, model: r.model }, output: { faceIds: r.faceIds } };
  },
};

/** A regular polygon as one curve of `sides` edges. Typing a radius or a count like 8s amends it. */
export const drawPolygon: CommandDef<DrawPolygonInput, DrawShapeOutput> = {
  id: 'core.drawPolygon',
  title: () => t('command.drawPolygon'),
  input: drawPolygonInput,
  amendable: [
    { key: 'radius', mode: 'positive' },
    { key: 'sides', mode: 'positive', kind: 'count' },
  ],
  amendHint: () => t('error.typeRadiusOrSides'),
  run(doc, input) {
    const { sides, ...rest } = input;
    const r = drawRegularPolygon(doc.model, { kind: 'polygon', ...rest, segments: sides });
    if (!r.ok) return { ok: false, error: { code: r.error } };
    return { ok: true, doc: { ...doc, model: r.model }, output: { faceIds: r.faceIds } };
  },
};
