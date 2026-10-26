import { localeTag, t } from '../i18n';
import { fromMm, MM_PER } from './length';
import { isImperial, type UnitSettings } from './settings';

/** Differences below this (in mm) are not reported as rounding. */
const EXACT_MM = 1e-6;

const APPROX = '~';

export interface FormatOptions {
  /** BCP 47 locale for digits. Defaults to the active UI locale. */
  locale?: string;
  /** Prefix "~" when the shown value is rounded. Defaults to true. */
  markApprox?: boolean;
}

const formatters = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: string, digits: number): Intl.NumberFormat {
  const id = `${locale}|${digits}`;
  let f = formatters.get(id);
  if (!f) {
    // No grouping: the measurements box uses commas to separate values.
    f = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: false,
    });
    formatters.set(id, f);
  }
  return f;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Format a length stored in mm using the file's display settings. */
export function formatLength(mm: number, settings: UnitSettings, options: FormatOptions = {}): string {
  const locale = options.locale ?? localeTag();
  const markApprox = options.markApprox ?? true;
  const { unit, precision } = settings;

  let text: string;
  let shownMm: number;

  if (unit === 'in-frac' || unit === 'ft-in') {
    const denom = precision;
    const ticks = Math.round((Math.abs(mm) / MM_PER.in) * denom);
    shownMm = (Math.sign(mm) * ticks * MM_PER.in) / denom;
    const int = numberFormat(locale, 0);
    const perFoot = 12 * denom;
    const feet = unit === 'ft-in' ? Math.floor(ticks / perFoot) : 0;
    const rest = ticks - feet * perFoot;
    const whole = Math.floor(rest / denom);
    let num = rest % denom;
    let den = denom;
    if (num) {
      const g = gcd(num, den);
      num /= g;
      den /= g;
    }
    let inches: string;
    if (num && whole) inches = `${int.format(whole)} ${int.format(num)}/${int.format(den)}`;
    else if (num) inches = `${int.format(num)}/${int.format(den)}`;
    else inches = int.format(whole);
    inches += t('units.symbol.in');
    text = feet ? `${int.format(feet)}${t('units.symbol.ft')} ${inches}` : inches;
  } else {
    const value = fromMm(Math.abs(mm), unit);
    const factor = 10 ** precision;
    const rounded = Math.round(value * factor) / factor;
    shownMm = Math.sign(mm) * rounded * MM_PER[unit];
    const num = numberFormat(locale, precision).format(rounded);
    text = unit === 'in' ? `${num}${t('units.symbol.in')}` : `${num} ${t(`units.symbol.${unit}`)}`;
  }

  const isZero = shownMm === 0;
  if (mm < 0 && !isZero) text = `-${text}`;
  if (markApprox && Math.abs(shownMm - mm) > EXACT_MM) text = APPROX + text;
  return text;
}

/** Format an area stored in mm² using the file's display settings. */
export function formatArea(mm2: number, settings: UnitSettings, options: FormatOptions = {}): string {
  return formatPower(mm2, 2, settings, options);
}

/** Volumes from this size (mm³) show in m³: 0.01 m³, ten liters. */
const CUBIC_METER_FROM = 1e7;

/**
 * A volume stored in mm³, for reading (Entity Info), whatever the file's
 * length precision: metric files in m³ from 0.01 m³ up and cm³ below,
 * imperial files in ft³ from 1 ft³ up and in³ below. Three significant
 * digits under 1,000 (0.0317 m³, 5.00 cm³), whole numbers with thousands
 * separators from there (1,235 cm³).
 */
export function formatVolume(mm3: number, settings: UnitSettings, options: FormatOptions = {}): string {
  const locale = options.locale ?? localeTag();
  // A hair of tolerance, so exactly 1 ft³ computed from 1,728 in³ still counts as 1 ft³.
  const atLeast = (limit: number) => Math.abs(mm3) >= limit * (1 - 1e-9);
  const unit = isImperial(settings.unit) ? (atLeast(MM_PER.ft ** 3) ? 'ft' : 'in') : atLeast(CUBIC_METER_FROM) ? 'm' : 'cm';
  const value = mm3 / MM_PER[unit] ** 3;
  return `${readable(locale, value)} ${t(`units.symbol.${unit}3`)}`;
}

const readableFormats = new Map<string, Intl.NumberFormat>();

/** At least three significant digits; whole numbers with grouping from 1,000 up. */
function readable(locale: string, value: number): string {
  const whole = Math.abs(value) >= 1000;
  const id = `${locale}|${whole}`;
  let f = readableFormats.get(id);
  if (!f) {
    f = new Intl.NumberFormat(
      locale,
      whole ? { maximumFractionDigits: 0, useGrouping: true } : { minimumSignificantDigits: 3, maximumSignificantDigits: 3, useGrouping: true },
    );
    readableFormats.set(id, f);
  }
  return f.format(value + 0);
}

/**
 * Areas: metric and decimal-inch files use their own unit and precision;
 * fractional inches use square inches and feet-and-inches square feet, with
 * two decimals.
 */
function formatPower(value: number, power: 2 | 3, settings: UnitSettings, options: FormatOptions): string {
  const locale = options.locale ?? localeTag();
  const { unit } = settings;
  const base = unit === 'in-frac' ? 'in' : unit === 'ft-in' ? 'ft' : unit;
  const digits = unit === 'in-frac' || unit === 'ft-in' ? 2 : settings.precision;
  const symbol = t(`units.symbol.${base}${power}`);
  return `${numberFormat(locale, digits).format(value / MM_PER[base] ** power)} ${symbol}`;
}

/** An angle in degrees with one decimal, such as 22.5°. */
export function formatAngle(degrees: number, options: FormatOptions = {}): string {
  return `${numberFormat(options.locale ?? localeTag(), 1).format(degrees + 0)}${t('units.symbol.degree')}`;
}

/** Plain number in the active locale, used for counts and other non-length values. */
export function formatNumber(value: number, digits = 0, locale: string = localeTag()): string {
  return numberFormat(locale, digits).format(value);
}
