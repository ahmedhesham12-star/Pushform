import type { AmendableField, CommandError } from './types';

/** Values for amendable fields: all of them in field order, or some of them by key. */
export type AmendValues = readonly number[] | Readonly<Record<string, number>>;

type Result<T> = { ok: true; value: T } | { ok: false; error: CommandError };

const kindOf = (f: AmendableField<unknown>) => f.kind ?? 'length';

/**
 * Match what the user typed to a command's amendable fields. Lengths fill the
 * length fields in order and counts fill the count fields; either group may be
 * left out (typing only 48s changes only the segment count), but a group that
 * is given must be complete.
 */
export function matchTypedValues(
  fields: readonly AmendableField<unknown>[],
  typed: { lengths: readonly number[]; counts: readonly number[] },
): Result<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [kind, values] of [
    ['length', typed.lengths],
    ['count', typed.counts],
  ] as const) {
    const group = fields.filter((f) => kindOf(f) === kind);
    if (!values.length) continue;
    if (values.length !== group.length) {
      return { ok: false, error: { code: 'amendValueCount', detail: `${kind}: expected ${group.length}, got ${values.length}` } };
    }
    group.forEach((f, i) => (out[f.key] = values[i]!));
  }
  if (!Object.keys(out).length) return { ok: false, error: { code: 'amendValueCount', detail: 'nothing typed' } };
  return { ok: true, value: out };
}

/**
 * Replace a command's amendable fields with typed values. Each value keeps
 * the direction of the field it replaces; see AmendableField. Counts must be
 * whole numbers.
 */
export function applyAmendValues<I>(
  fields: readonly AmendableField<I>[],
  input: I,
  values: AmendValues,
): { ok: true; input: I } | { ok: false; error: CommandError } {
  let byKey: Record<string, number>;
  if (Array.isArray(values)) {
    if (values.length !== fields.length) {
      return { ok: false, error: { code: 'amendValueCount', detail: `expected ${fields.length}, got ${values.length}` } };
    }
    byKey = Object.fromEntries(fields.map((f, i) => [f.key, values[i]!]));
  } else {
    byKey = { ...(values as Record<string, number>) };
    const unknown = Object.keys(byKey).filter((k) => !fields.some((f) => f.key === k));
    if (unknown.length || !Object.keys(byKey).length) {
      return { ok: false, error: { code: 'amendValueCount', detail: `unknown or no fields: ${unknown.join(', ')}` } };
    }
  }
  const next = { ...input } as Record<string, unknown>;
  for (const field of fields) {
    if (!(field.key in byKey)) continue;
    const value = byKey[field.key]!;
    const bad =
      !Number.isFinite(value) ||
      value === 0 ||
      (field.mode === 'positive' && value < 0) ||
      (kindOf(field as AmendableField<unknown>) === 'count' && !Number.isInteger(value));
    if (bad) return { ok: false, error: { code: 'amendValueInvalid', detail: `${field.key}: ${value}` } };
    const direction = Math.sign(next[field.key] as number) || 1;
    next[field.key] = direction * value;
  }
  return { ok: true, input: next as I };
}
