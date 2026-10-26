import { z } from 'zod';
import { t } from '../../i18n';
import { drawRegularPolygon, MAX_SEGMENTS } from '../../kernel';
import { withDefinitionModel } from '../document';
import type { CommandDef } from '../types';
import { definitionId, faceId, length, point3, targetModel } from './schemas';

const shape = {
  definitionId,
  /** Face to draw on, or null for the ground plane of the definition. */
  faceId: faceId.nullable(),
  /**
   * With no face: the normal of the plane to draw in, through the center
   * (the plane of a face in another group, for example). The ground when omitted.
   */
  normal: z.tuple([z.number(), z.number(), z.number()]).optional(),
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
    const { definitionId: defId, ...spec } = input;
    const target = targetModel(doc, defId);
    if (!target.ok) return target;
    const r = drawRegularPolygon(target.model, { kind: 'circle', ...spec });
    if (!r.ok) return { ok: false, error: { code: r.error } };
    return { ok: true, doc: withDefinitionModel(doc, defId, r.model), output: { faceIds: r.faceIds } };
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
    const { sides, definitionId: defId, ...rest } = input;
    const target = targetModel(doc, defId);
    if (!target.ok) return target;
    const r = drawRegularPolygon(target.model, { kind: 'polygon', ...rest, segments: sides });
    if (!r.ok) return { ok: false, error: { code: r.error } };
    return { ok: true, doc: withDefinitionModel(doc, defId, r.model), output: { faceIds: r.faceIds } };
  },
};
