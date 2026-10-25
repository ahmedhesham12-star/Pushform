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
