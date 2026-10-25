import { z } from 'zod';
import { t } from '../../i18n';
import { createModel, edgeCount, faceCount } from '../../kernel';
import type { CommandDef } from '../types';

export const clearModelInput = z.strictObject({});
export type ClearModelInput = z.infer<typeof clearModelInput>;

/** Remove all geometry. Display settings are kept. */
export const clearModel: CommandDef<ClearModelInput, Record<string, never>> = {
  id: 'core.clearModel',
  title: () => t('command.clearModel'),
  input: clearModelInput,
  run(doc) {
    if (faceCount(doc.model) === 0 && edgeCount(doc.model) === 0) return { ok: true, doc, output: {} };
    return { ok: true, doc: { ...doc, model: createModel() }, output: {} };
  },
};
