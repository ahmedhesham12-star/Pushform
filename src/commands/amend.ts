import type { AmendableField, CommandError } from './types';

/**
 * Replace a command's amendable fields with typed values (mm). Each value
 * keeps the direction of the field it replaces; see AmendableField.
 */
export function applyAmendValues<I>(
  fields: readonly AmendableField<I>[],
  input: I,
  values: readonly number[],
): { ok: true; input: I } | { ok: false; error: CommandError } {
  if (values.length !== fields.length) {
    return { ok: false, error: { code: 'amendValueCount', detail: `expected ${fields.length}, got ${values.length}` } };
  }
  const next = { ...input } as Record<string, unknown>;
  for (const [i, field] of fields.entries()) {
    const value = values[i]!;
    if (!Number.isFinite(value) || value === 0 || (field.mode === 'positive' && value < 0)) {
      return { ok: false, error: { code: 'amendValueInvalid', detail: `${field.key}: ${value}` } };
    }
    const direction = Math.sign(next[field.key] as number) || 1;
    next[field.key] = direction * value;
  }
  return { ok: true, input: next as I };
}
