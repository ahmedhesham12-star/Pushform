import type { AmendableField, CommandError } from './types';

/**
 * Values for amendable fields: all of them in field order, or some of them by
 * key (an array field's flag takes a boolean).
 */
export type AmendValues = readonly number[] | Readonly<Record<string, number | boolean>>;

type Result<T> = { ok: true; value: T } | { ok: false; error: CommandError };

const kindOf = (f: AmendableField<unknown>) => f.kind ?? 'length';

/**
 * Match what the user typed to a command's amendable fields. Lengths fill the
 * length fields in order and counts fill the count fields; either group may be
 * left out (typing only 48s changes only the segment count), but a group that
 * is given must be complete. An array (x5 or /4) sets an array field's count
 * and its divide flag.
 */
export function matchTypedValues(
  fields: readonly AmendableField<unknown>[],
  typed: {
    lengths: readonly number[];
    counts: readonly number[];
    arrays?: readonly { count: number; divide: boolean }[];
    angles?: readonly number[];
    bare?: boolean;
    /** For each length, the plain number typed (no unit), or null. */
    plain?: readonly (number | null)[];
    radii?: readonly number[];
  },
): Result<Record<string, number | boolean>> {
  const out: Record<string, number | boolean> = {};
  // A plain number is a length for commands with lengths, and an angle for those with only angles.
  const hasLengths = fields.some((f) => kindOf(f) === 'length');
  const hasAngles = fields.some((f) => kindOf(f) === 'angle');
  // Commands with factors read plain numbers as factors and lengths as sizes to scale to.
  const factorFields = fields.filter((f) => kindOf(f) === 'factor');
  if (factorFields.length && typed.lengths.length) {
    if (typed.lengths.length !== factorFields.length) {
      return { ok: false, error: { code: 'amendValueCount', detail: `factor: expected ${factorFields.length}, got ${typed.lengths.length}` } };
    }
    for (const [i, f] of factorFields.entries()) {
      const plain = typed.plain?.[i] ?? null;
      const value = plain ?? (f.reference ? typed.lengths[i]! / f.reference : NaN);
      if (!Number.isFinite(value)) return { ok: false, error: { code: 'amendValueInvalid', detail: `${f.key}: no size to scale` } };
      out[f.key] = value;
    }
  }
  const lengths = factorFields.length || (!hasLengths && hasAngles && typed.bare) ? [] : typed.lengths;
  const angles = hasAngles ? (typed.angles ?? []) : [];
  const arrayFields = fields.filter((f) => kindOf(f) === 'array');
  if (typed.arrays?.length) {
    if (typed.arrays.length !== 1 || arrayFields.length !== 1) {
      return { ok: false, error: { code: 'amendValueCount', detail: `array: expected ${arrayFields.length}, got ${typed.arrays.length}` } };
    }
    const f = arrayFields[0]!;
    out[f.key] = typed.arrays[0]!.count;
    if (f.flag) out[f.flag] = typed.arrays[0]!.divide;
  }
  for (const [kind, values] of [
    ['length', lengths],
    ['count', typed.counts],
    ['angle', angles],
    ['radius', typed.radii ?? []],
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
  let byKey: Record<string, number | boolean>;
  if (Array.isArray(values)) {
    if (values.length !== fields.length) {
      return { ok: false, error: { code: 'amendValueCount', detail: `expected ${fields.length}, got ${values.length}` } };
    }
    byKey = Object.fromEntries(fields.map((f, i) => [f.key, values[i]!]));
  } else {
    byKey = { ...(values as Record<string, number | boolean>) };
    const unknown = Object.keys(byKey).filter((k) => !fields.some((f) => f.key === k || f.flag === k));
    if (unknown.length || !Object.keys(byKey).length) {
      return { ok: false, error: { code: 'amendValueCount', detail: `unknown or no fields: ${unknown.join(', ')}` } };
    }
  }
  const next = { ...input } as Record<string, unknown>;
  for (const field of fields) {
    if (field.flag && field.flag in byKey) next[field.flag] = byKey[field.flag] === true;
    if (!(field.key in byKey)) continue;
    const value = byKey[field.key]!;
    const kind = kindOf(field as AmendableField<unknown>);
    const bad =
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value === 0 ||
      (field.mode === 'positive' && value < 0) ||
      ((kind === 'count' || kind === 'array') && !Number.isInteger(value));
    if (bad) return { ok: false, error: { code: 'amendValueInvalid', detail: `${field.key}: ${value}` } };
    // A factor replaces the old one as typed; other values keep the old direction.
    const direction = kind === 'factor' ? 1 : Math.sign(next[field.key] as number) || 1;
    next[field.key] = direction * value;
    if (field.clears) delete next[field.clears];
  }
  return { ok: true, input: next as I };
}
