import { z } from 'zod';
import { t } from '../../i18n';
import { offset as kernelOffset } from '../../kernel';
import { withDefinitionModel } from '../document';
import type { CommandDef } from '../types';
import { definitionId, faceId, length, targetModel } from './schemas';

export const offsetInput = z
  .strictObject({
    definitionId,
    /** The face whose outer boundary is offset. */
    faceId: faceId.optional(),
    /** Or connected edges in one plane (an open chain or a loop). */
    edgeIds: z.array(z.string().min(1)).optional(),
    /** Signed distance in mm: positive inward (or to the left of an open chain), negative outward. */
    distance: length,
  })
  .refine((v) => (v.faceId !== undefined) !== Boolean(v.edgeIds?.length), { message: 'a face or edges, not both' });
export type OffsetInput = z.infer<typeof offsetInput>;
export interface OffsetOutput {
  /** Faces created: the inner face or ring, and pieces of faces the new loop split. */
  faceIds: string[];
  /** The new edges. */
  edgeIds: string[];
}

/**
 * Offset a face's outer boundary, or connected edges, by a distance in their
 * plane. Straight corners stay sharp; circles and polygons offset as curves
 * with the same segment count. Refused when the distance is too large for
 * the shape. Typing a distance afterwards amends it.
 */
export const offset: CommandDef<OffsetInput, OffsetOutput> = {
  id: 'core.offset',
  title: () => t('command.offset'),
  input: offsetInput,
  amendable: [{ key: 'distance', mode: 'signed' }],
  amendHint: () => t('error.typeOneDistance'),
  run(doc, input) {
    const target = targetModel(doc, input.definitionId);
    if (!target.ok) return target;
    if (input.distance === 0) return { ok: false, error: { code: 'tooSmall', detail: 'zero offset' } };
    const r = kernelOffset(target.model, input.faceId ?? null, input.edgeIds ?? [], input.distance);
    if (!r.ok) return { ok: false, error: { code: r.error } };
    return { ok: true, doc: withDefinitionModel(doc, input.definitionId, r.model), output: { faceIds: r.faceIds, edgeIds: r.edgeIds } };
  },
};
