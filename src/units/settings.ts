/**
 * Per-file display settings for lengths. The model itself is always stored in
 * millimeters (see INTERNAL_UNIT); these settings only affect display and the
 * meaning of bare numbers typed by the user.
 */

export const INTERNAL_UNIT = 'mm';

export const LENGTH_UNITS = ['mm', 'cm', 'm', 'in', 'in-frac', 'ft-in'] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

export interface UnitSettings {
  unit: LengthUnit;
  /**
   * Decimal places for mm, cm, m and in.
   * Fraction denominator (1, 2, 4, ... 64) for in-frac and ft-in.
   */
  precision: number;
}

export const DEFAULT_UNIT_SETTINGS: UnitSettings = { unit: 'm', precision: 2 };

const DECIMAL_PRECISIONS = [0, 1, 2, 3, 4] as const;
const FRACTION_PRECISIONS = [1, 2, 4, 8, 16, 32, 64] as const;

export function isFractional(unit: LengthUnit): boolean {
  return unit === 'in-frac' || unit === 'ft-in';
}

export function isImperial(unit: LengthUnit): boolean {
  return unit === 'in' || unit === 'in-frac' || unit === 'ft-in';
}

export function precisionOptions(unit: LengthUnit): readonly number[] {
  return isFractional(unit) ? FRACTION_PRECISIONS : DECIMAL_PRECISIONS;
}

/** A sensible precision when switching to a unit. */
export function defaultPrecision(unit: LengthUnit): number {
  switch (unit) {
    case 'mm':
      return 0;
    case 'cm':
      return 1;
    case 'm':
      return 2;
    case 'in':
      return 2;
    case 'in-frac':
    case 'ft-in':
      return 16;
  }
}

export function isValidSettings(s: UnitSettings): boolean {
  return LENGTH_UNITS.includes(s.unit) && precisionOptions(s.unit).includes(s.precision);
}

/** Grid step in mm used when the cursor is not snapped to geometry. */
export function gridStep(s: UnitSettings): number {
  return isImperial(s.unit) ? 50.8 : 50;
}

/** Rounding step in mm for distances set by dragging (push/pull). */
export function dragStep(s: UnitSettings): number {
  return isImperial(s.unit) ? 6.35 : 10;
}
