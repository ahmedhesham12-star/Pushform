import { z } from 'zod';
import { t } from '../../i18n';
import { deleteFace as kernelDeleteFace, hasFace } from '../../kernel';
import type { CommandDef } from '../types';
import { faceId } from './schemas';

export const deleteFaceInput = z.strictObject({ faceId });
export type DeleteFaceInput = z.infer<typeof deleteFaceInput>;

export const deleteFace: CommandDef<DeleteFaceInput, Record<string, never>> = {
  id: 'core.deleteFace',
  title: () => t('command.deleteFace'),
  input: deleteFaceInput,
  run(doc, input) {
    if (!hasFace(doc.model, input.faceId)) return { ok: false, error: { code: 'noSuchFace', detail: input.faceId } };
    return { ok: true, doc: { ...doc, model: kernelDeleteFace(doc.model, input.faceId) }, output: {} };
  },
};
