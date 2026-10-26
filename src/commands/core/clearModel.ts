import { z } from 'zod';
import { t } from '../../i18n';
import { createModel, edgeCount, faceCount } from '../../kernel';
import { createScene, rootDefinition } from '../../scene';
import type { CommandDef } from '../types';

export const clearModelInput = z.strictObject({});
export type ClearModelInput = z.infer<typeof clearModelInput>;

/** Remove all geometry, groups, components and guides. Display settings are kept. */
export const clearModel: CommandDef<ClearModelInput, Record<string, never>> = {
  id: 'core.clearModel',
  title: () => t('command.clearModel'),
  input: clearModelInput,
  run(doc) {
    const root = rootDefinition(doc.scene);
    const empty = faceCount(root.model) === 0 && edgeCount(root.model) === 0 && root.instances.size === 0 && root.guides.size === 0;
    if (empty && doc.scene.definitions.size === 1) return { ok: true, doc, output: {} };
    return { ok: true, doc: { ...doc, scene: createScene(createModel()) }, output: {} };
  },
};
