import { z } from 'zod';
import { t } from '../../i18n';
import { getDefinition, setGrain as setSceneGrain } from '../../scene';
import { cutListSettings } from '../document';
import type { CommandDef } from '../types';

export const setCutListSettingsInput = z.strictObject({
  /** Waste as a fraction (0.15 is 15%). */
  waste: z.number().min(0).max(9).optional(),
  /** An ISO 4217 code such as EUR, or null for plain numbers. */
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .transform((c) => c.toUpperCase())
    .nullable()
    .optional(),
  includeHidden: z.boolean().optional(),
});
export type SetCutListSettingsInput = z.infer<typeof setCutListSettingsInput>;

/** Change the cut list's waste, currency or whether hidden parts are listed; saved in the file. */
export const setCutListSettings: CommandDef<SetCutListSettingsInput, Record<string, never>> = {
  id: 'core.setCutListSettings',
  title: () => t('command.setCutListSettings'),
  input: setCutListSettingsInput,
  run(doc, input) {
    const old = cutListSettings(doc);
    const next = {
      waste: input.waste ?? old.waste,
      currency: input.currency === undefined ? old.currency : input.currency,
      includeHidden: input.includeHidden ?? old.includeHidden,
    };
    if (next.waste === old.waste && next.currency === old.currency && next.includeHidden === old.includeHidden) return { ok: true, doc, output: {} };
    return { ok: true, doc: { ...doc, cutList: next }, output: {} };
  },
};

export const setGrainInput = z.strictObject({ definitionId: z.string().min(1), grain: z.enum(['red', 'green', 'blue']).nullable() });
export type SetGrainInput = z.infer<typeof setGrainInput>;

/**
 * A part's grain direction (Entity Info): its length in the cut list runs
 * along that axis of its own. Null leaves the longest side as the length.
 * Copies of a component share it.
 */
export const setGrain: CommandDef<SetGrainInput, Record<string, never>> = {
  id: 'core.setGrain',
  title: () => t('command.setGrain'),
  input: setGrainInput,
  run(doc, input) {
    const def = getDefinition(doc.scene, input.definitionId);
    if (!def || def.kind === 'root') return { ok: false, error: { code: 'noSuchDefinition', detail: input.definitionId } };
    const scene = setSceneGrain(doc.scene, def.id, input.grain);
    return { ok: true, doc: scene === doc.scene ? doc : { ...doc, scene }, output: {} };
  },
};
