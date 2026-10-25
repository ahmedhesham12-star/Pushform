import { z } from 'zod';
import { t } from '../../i18n';
import { erase as kernelErase, hasEdge, hasFace } from '../../kernel';
import type { CommandDef } from '../types';
import { faceId } from './schemas';

export const eraseInput = z
  .strictObject({
    faceIds: z.array(faceId),
    edgeIds: z.array(z.string().min(1)),
  })
  .refine((v) => v.faceIds.length + v.edgeIds.length > 0, { message: 'nothing to erase' });
export type EraseInput = z.infer<typeof eraseInput>;
export interface EraseOutput {
  /** Faces that no longer exist: erased, removed with an edge, or merged into another face. */
  removedFaceIds: string[];
}

/**
 * Erase faces and edges in one undo step. Erasing a face keeps its edges.
 * Erasing an edge between two coplanar faces merges them; otherwise the faces
 * it bounds go with it. Erasing any edge of a curve erases the whole curve.
 */
export const erase: CommandDef<EraseInput, EraseOutput> = {
  id: 'core.erase',
  title: () => t('command.erase'),
  input: eraseInput,
  run(doc, input) {
    const faces = input.faceIds.filter((f) => hasFace(doc.model, f));
    const edges = input.edgeIds.filter((e) => hasEdge(doc.model, e));
    if (!faces.length && !edges.length) {
      return { ok: false, error: { code: 'nothingToErase', detail: JSON.stringify(input) } };
    }
    const r = kernelErase(doc.model, faces, edges);
    return { ok: true, doc: { ...doc, model: r.model }, output: { removedFaceIds: r.removedFaceIds } };
  },
};
