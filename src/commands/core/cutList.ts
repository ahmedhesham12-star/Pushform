import { z } from 'zod';
import { t } from '../../i18n';
import { getDefinition, setGrain as setSceneGrain } from '../../scene';
import { cutListSettings, type CutListSettings } from '../document';
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
  /** Cutting diagrams: saw kerf, trim off each sheet edge, and the smallest offcut kept, in mm. */
  kerf: z.number().min(0).max(50).optional(),
  trim: z.number().min(0).max(200).optional(),
  minOffcut: z.number().min(0).max(999).optional(),
  guillotine: z.boolean().optional(),
  firstCut: z.enum(['length', 'width', 'best']).optional(),
});
export type SetCutListSettingsInput = z.infer<typeof setCutListSettingsInput>;

/** Change the cut list's settings (waste, currency, hidden parts, and the cutting diagrams'); saved in the file. */
export const setCutListSettings: CommandDef<SetCutListSettingsInput, Record<string, never>> = {
  id: 'core.setCutListSettings',
  title: () => t('command.setCutListSettings'),
  input: setCutListSettingsInput,
  run(doc, input) {
    const old = cutListSettings(doc);
    const given = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const next: CutListSettings = { ...old, ...given };
    if ((Object.keys(next) as (keyof CutListSettings)[]).every((k) => next[k] === old[k])) return { ok: true, doc, output: {} };
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
