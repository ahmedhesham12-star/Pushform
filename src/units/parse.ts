import { MM_PER } from './length';
import { isImperial, type LengthUnit } from './settings';

export type ParseError = 'empty' | 'invalid';

export type ParseResult = { ok: true; mm: number } | { ok: false; error: ParseError };
export type ParseListResult = { ok: true; mm: number[] } | { ok: false; error: ParseError };

/**
 * Map input that people commonly type or paste onto plain ASCII: Arabic-Indic
 * digits, the Arabic decimal separator, typographic minus and quote marks.
 */
function normalize(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/[−–]/g, '-')
    .replace(/[′‘’]/g, "'")
    .replace(/[″“”]/g, '"')
    .trim()
    .toLowerCase();
}

const NUM = String.raw`(\d+(?:\.\d*)?|\.\d+)`;
const METRIC = new RegExp(String.raw`^${NUM}\s*(mm|cm|m)$`);
const FEET = String.raw`${NUM}\s*(?:feet|foot|ft|')`;
// Mixed number "6 1/2", plain fraction "1/2", or decimal "6.5".
const INCH_VALUE = String.raw`(?:${NUM}\s+(\d+)\s*/\s*(\d+)|(\d+)\s*/\s*(\d+)|${NUM})`;
const INCH_MARK = String.raw`(?:inches|inch|in|")`;
const IMPERIAL = new RegExp(String.raw`^(?:${FEET})?\s*-?\s*(?:${INCH_VALUE}\s*(${INCH_MARK})?)?$`);

/**
 * Parse a typed length into mm. Either unit system is accepted regardless of the
 * file's display unit: 600mm, 60 cm, 0.6m, 24", 24in, 2', 2' 6 1/2", 2'-6".
 * A bare number (or fraction) is read in the file's unit; for imperial units it
 * is read as inches.
 */
export function parseLength(input: string, fileUnit: LengthUnit): ParseResult {
  let text = normalize(input);
  if (!text) return { ok: false, error: 'empty' };

  let sign = 1;
  if (text[0] === '-' || text[0] === '+') {
    if (text[0] === '-') sign = -1;
    text = text.slice(1).trim();
  }

  const metric = METRIC.exec(text);
  if (metric) {
    const unit = metric[2] as 'mm' | 'cm' | 'm';
    return finish(sign * Number(metric[1]) * MM_PER[unit]);
  }

  const m = IMPERIAL.exec(text);
  if (!m) return { ok: false, error: 'invalid' };
  const [, feet, mixWhole, mixNum, mixDen, fracNum, fracDen, decimal, inchMark] = m;

  let value: number | undefined;
  if (mixWhole !== undefined) value = Number(mixWhole) + ratio(mixNum, mixDen);
  else if (fracNum !== undefined) value = ratio(fracNum, fracDen);
  else if (decimal !== undefined) value = Number(decimal);

  if (feet === undefined && value === undefined) return { ok: false, error: 'invalid' };

  if (feet === undefined && inchMark === undefined) {
    // Bare number: interpret in the file's unit.
    const perUnit = isImperial(fileUnit) ? MM_PER.in : MM_PER[fileUnit as 'mm' | 'cm' | 'm'];
    return finish(sign * (value ?? 0) * perUnit);
  }
  return finish(sign * (Number(feet ?? 0) * MM_PER.ft + (value ?? 0) * MM_PER.in));
}

function ratio(num: string | undefined, den: string | undefined): number {
  return Number(num) / Number(den);
}

function finish(mm: number): ParseResult {
  return Number.isFinite(mm) ? { ok: true, mm } : { ok: false, error: 'invalid' };
}

/** Separators between several typed values, e.g. "600, 400" or "24 x 36". Never spaces. */
const LIST_SEPARATOR = /[,;x×،؛]/;

/** A copy array typed after Move or Rotate: x5 (multiply, 5 copies) or /4 (divide the distance into 4). */
export interface TypedArray {
  count: number;
  divide: boolean;
}

/**
 * `angles` holds every part that reads as an angle in degrees: a plain
 * number, or one marked ° or deg. A plain number is a length too; `bare` is
 * true when every length was a plain number, so a command that takes an
 * angle and no length can read them as degrees.
 */
export type TypedValuesResult =
  | { ok: true; lengths: number[]; counts: number[]; arrays: TypedArray[]; angles: number[]; bare: boolean }
  | { ok: false; error: ParseError };

/** A count typed with an "s" suffix, such as 48s for 48 segments or 6s for 6 sides. */
const COUNT = /^(\d+)\s*s$/;
/** Arrays as in SketchUp: x5, 5x and *5 multiply; /4 divides. Typed on their own, since x also separates values. */
const MULTIPLY = /^(?:[x×*]\s*(\d+)|(\d+)\s*[x×*])$/;
const DIVIDE = /^\/\s*(\d+)$/;
/** An angle: a plain number, or one marked with ° or deg. */
const ANGLE = new RegExp(String.raw`^(-?)\s*${NUM}\s*(°|deg)?$`);

/** Parse a typed angle in degrees (45, -30, 22.5°, 90deg); null when it is not one. */
export function parseAngle(input: string): number | null {
  const m = ANGLE.exec(normalize(input));
  if (!m) return null;
  const v = Number(m[2]) * (m[1] ? -1 : 1);
  return Number.isFinite(v) ? v + 0 : null;
}

/**
 * Parse what the user typed into the measurements box: lengths (either unit
 * system, see parseLength) and counts with an "s" suffix, in any order and
 * separated like parseLengthList. "500mm, 48s" gives one length and one count.
 * An array (x5, 5x, *5 or /4) is typed on its own.
 */
export function parseTypedValues(input: string, fileUnit: LengthUnit): TypedValuesResult {
  const whole = normalize(input);
  const multiply = MULTIPLY.exec(whole);
  const divide = DIVIDE.exec(whole);
  if (multiply || divide) {
    const count = Number(multiply ? (multiply[1] ?? multiply[2]) : divide![1]);
    return { ok: true, lengths: [], counts: [], arrays: [{ count, divide: !!divide }], angles: [], bare: false };
  }
  const parts = whole
    .split(LIST_SEPARATOR)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return { ok: false, error: 'empty' };
  const lengths: number[] = [];
  const counts: number[] = [];
  const angles: number[] = [];
  let bare = true;
  for (const part of parts) {
    const count = COUNT.exec(part);
    if (count) {
      counts.push(Number(count[1]));
      continue;
    }
    const angle = ANGLE.exec(part);
    if (angle) {
      angles.push(parseAngle(part)!);
      // Marked as degrees: not a length.
      if (angle[3]) continue;
    } else {
      bare = false;
    }
    const r = parseLength(part, fileUnit);
    if (!r.ok) return r;
    lengths.push(r.mm);
  }
  return { ok: true, lengths, counts, arrays: [], angles, bare };
}

/** Parse one or more lengths, such as the width and depth of a rectangle. */
export function parseLengthList(input: string, fileUnit: LengthUnit): ParseListResult {
  const parts = normalize(input)
    .split(LIST_SEPARATOR)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return { ok: false, error: 'empty' };
  const out: number[] = [];
  for (const part of parts) {
    const r = parseLength(part, fileUnit);
    if (!r.ok) return r;
    out.push(r.mm);
  }
  return { ok: true, mm: out };
}
