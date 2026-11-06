import { z } from 'zod';
import { t } from '../../i18n';
import { setHardware as setDefinitionHardware, validLink } from '../../scene';
import type { CommandDef } from '../types';

export const setHardwareInput = z.strictObject({
  definitionId: z.string().min(1),
  /** The details, or null for no longer hardware. */
  hardware: z
    .strictObject({
      manufacturer: z.string().trim().max(200),
      partNumber: z.string().trim().max(200),
      price: z.number().nonnegative().finite().nullable(),
      link: z.string().trim().max(2000).refine(validLink, { message: 'not an http or https address' }),
    })
    .nullable(),
});
export type SetHardwareInput = z.infer<typeof setHardwareInput>;

/**
 * Mark a component or reference mesh as hardware (milestone 6), with its
 * details, or as not hardware (null). Copies share it, as they share the
 * definition. Groups and the model are refused (`hardwareNeedsComponent`).
 */
export const setHardware: CommandDef<SetHardwareInput, Record<string, never>> = {
  id: 'core.setHardware',
  title: () => t('command.setHardware'),
  input: setHardwareInput,
  run(doc, input) {
    const def = doc.scene.definitions.get(input.definitionId);
    if (!def) return { ok: false, error: { code: 'noSuchDefinition', detail: input.definitionId } };
    if (def.kind !== 'component' && def.kind !== 'mesh') return { ok: false, error: { code: 'hardwareNeedsComponent', detail: input.definitionId } };
    const scene = setDefinitionHardware(doc.scene, def.id, input.hardware);
    return { ok: true, doc: scene === doc.scene ? doc : { ...doc, scene }, output: {} };
  },
};
