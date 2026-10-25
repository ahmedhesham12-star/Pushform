import { z } from 'zod';
import { t } from '../../i18n';
import { isValidSettings, LENGTH_UNITS } from '../../units';
import type { CommandDef } from '../types';

export const setDisplayUnitsInput = z.strictObject({
  unit: z.enum(LENGTH_UNITS),
  /** Decimal places, or the fraction denominator for in-frac and ft-in. */
  precision: z.number().int(),
});
export type SetDisplayUnitsInput = z.infer<typeof setDisplayUnitsInput>;

/** Change the file's display units and precision. Stored geometry is unaffected. */
export const setDisplayUnits: CommandDef<SetDisplayUnitsInput, Record<string, never>> = {
  id: 'core.setDisplayUnits',
  title: () => t('command.setDisplayUnits'),
  input: setDisplayUnitsInput,
  run(doc, input) {
    if (!isValidSettings(input)) return { ok: false, error: { code: 'invalidPrecision' } };
    if (input.unit === doc.units.unit && input.precision === doc.units.precision) return { ok: true, doc, output: {} };
    return { ok: true, doc: { ...doc, units: { unit: input.unit, precision: input.precision } }, output: {} };
  },
};
