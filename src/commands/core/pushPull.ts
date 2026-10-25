import { z } from 'zod';
import { t } from '../../i18n';
import { hasFace, pushPull as kernelPushPull } from '../../kernel';
import type { CommandDef } from '../types';
import { faceId, length } from './schemas';

export const pushPullInput = z.strictObject({
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
  run(doc, input) {
    if (!hasFace(doc.model, input.faceId)) return { ok: false, error: { code: 'noSuchFace', detail: input.faceId } };
    const r = kernelPushPull(doc.model, input.faceId, input.distance);
    const next = r.model === doc.model ? doc : { ...doc, model: r.model };
    return {
      ok: true,
      doc: next,
      output: { distance: r.distance, createdFaceIds: r.createdFaceIds, removedFaceIds: r.removedFaceIds },
    };
  },
};
