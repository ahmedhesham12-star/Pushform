import { localeTag, t } from '../i18n';
import { fromMm, MM_PER } from './length';
import type { UnitSettings } from './settings';

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
  const locale = options.locale ?? localeTag();
  const { unit } = settings;
  let value: number;
  let symbol: string;
  let digits: number;
  switch (unit) {
    case 'mm':
    case 'cm':
    case 'm':
      value = mm2 / MM_PER[unit] ** 2;
      symbol = t(`units.symbol.${unit}2`);
      digits = settings.precision;
      break;
    case 'in':
      value = mm2 / MM_PER.in ** 2;
      symbol = t('units.symbol.in2');
      digits = settings.precision;
      break;
    case 'in-frac':
      value = mm2 / MM_PER.in ** 2;
      symbol = t('units.symbol.in2');
      digits = 2;
      break;
    case 'ft-in':
      value = mm2 / MM_PER.ft ** 2;
      symbol = t('units.symbol.ft2');
      digits = 2;
      break;
  }
  return `${numberFormat(locale, digits).format(value)} ${symbol}`;
}

/** Plain number in the active locale, used for counts and other non-length values. */
export function formatNumber(value: number, digits = 0, locale: string = localeTag()): string {
  return numberFormat(locale, digits).format(value);
}
