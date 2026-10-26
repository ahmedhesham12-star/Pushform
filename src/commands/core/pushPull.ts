import { z } from 'zod';
import { t } from '../../i18n';
import { hasFace, pushPull as kernelPushPull } from '../../kernel';
import { withDefinitionModel } from '../document';
import type { CommandDef } from '../types';
import { definitionId, faceId, length, targetModel } from './schemas';

export const pushPullInput = z.strictObject({
  definitionId,
  faceId,
  /** Signed distance in mm along the face normal. */
  distance: length,
});
export type PushPullInput = z.infer<typeof pushPullInput>;
export interface PushPullOutput {
  /** Distance actually applied after clamping, in mm. */
  distance: number;
  /** Faces created: walls, and the bottom a lone face leaves behind. */
  createdFaceIds: string[];
  /** Faces removed, for example by pushing through to the opposite face. */
  removedFaceIds: string[];
}

export const pushPull: CommandDef<PushPullInput, PushPullOutput> = {
  id: 'core.pushPull',
  title: () => t('command.pushPull'),
  input: pushPullInput,
  amendable: [{ key: 'distance', mode: 'signed' }],
  amendHint: () => t('error.typeOneDistance'),
  run(doc, input) {
    const target = targetModel(doc, input.definitionId);
    if (!target.ok) return target;
    if (!hasFace(target.model, input.faceId)) return { ok: false, error: { code: 'noSuchFace', detail: input.faceId } };
    const r = kernelPushPull(target.model, input.faceId, input.distance);
    return {
      ok: true,
      doc: withDefinitionModel(doc, input.definitionId, r.model),
      output: { distance: r.distance, createdFaceIds: r.createdFaceIds, removedFaceIds: r.removedFaceIds },
    };
  },
};
