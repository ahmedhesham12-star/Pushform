import { describe, expect, test } from 'vitest';
import {
  formatArea,
  formatVolume,
  formatAngle,
  parseAngle,
  formatLength,
  parseLength,
  parseLengthList,
  parseTypedValues,
  isValidSettings,
  type LengthUnit,
  type UnitSettings,
} from '../src/units';

const mm = (text: string, unit: LengthUnit = 'm') => {
  const r = parseLength(text, unit);
  if (!r.ok) throw new Error(`could not parse ${text}: ${r.error}`);
  return r.mm;
};

describe('parseLength: metric', () => {
  test.each([
    ['600mm', 600],
    ['600 mm', 600],
    ['60cm', 600],
    ['60 CM', 600],
    ['0.6m', 600],
    ['.6m', 600],
    ['1.25 m', 1250],
    ['-15mm', -15],
    ['+2m', 2000],
  ])('%s -> %f mm', (text, expected) => {
    expect(mm(text)).toBeCloseTo(expected, 9);
  });
});

describe('parseLength: imperial', () => {
  test.each([
    ['24"', 609.6],
    ['24in', 609.6],
    ['24 inches', 609.6],
    ["2'", 609.6],
    ['2ft', 609.6],
    ['2 feet', 609.6],
    ['2.5\'', 762],
    ['2\' 6"', 762],
    ['2\'6"', 762],
    ['2\'-6"', 762],
    ["2'6", 762],
    ['2\' 6 1/2"', 774.7],
    ['2ft 6 1/2in', 774.7],
    ['6 1/2"', 165.1],
    ['3/4"', 19.05],
    ['3/4 in', 19.05],
    ['1/16"', 1.5875],
    ['-2\' 6"', -762],
    ['2′ 6″', 762],
  ])('%s -> %f mm', (text, expected) => {
    expect(mm(text)).toBeCloseTo(expected, 9);
  });
});

describe('parseLength: bare numbers use the file unit', () => {
  test.each<[string, LengthUnit, number]>([
    ['3', 'm', 3000],
    ['3', 'cm', 30],
    ['3', 'mm', 3],
    ['3', 'in', 76.2],
    ['3', 'ft-in', 76.2],
    ['6 1/2', 'in-frac', 165.1],
    ['3/4', 'ft-in', 19.05],
    ['1/2', 'm', 500],
  ])('%s in %s -> %f mm', (text, unit, expected) => {
    expect(mm(text, unit)).toBeCloseTo(expected, 9);
  });

  test('suffixes override the file unit in either direction', () => {
    expect(mm('600mm', 'ft-in')).toBeCloseTo(600, 9);
    expect(mm('24"', 'mm')).toBeCloseTo(609.6, 9);
  });
});

describe('parseLength: normalization and errors', () => {
  test('Arabic-Indic digits and decimal separator', () => {
    expect(mm('٦٠٠mm')).toBeCloseTo(600, 9);
    expect(mm('١٫٥m')).toBeCloseTo(1500, 9);
    expect(mm('۲۴"')).toBeCloseTo(609.6, 9);
  });

  test('unicode minus sign', () => {
    expect(mm('−15mm')).toBeCloseTo(-15, 9);
  });

  test.each(['', '   '])('empty input %j', (text) => {
    expect(parseLength(text, 'm')).toEqual({ ok: false, error: 'empty' });
  });

  test.each(['abc', '2 6', '5 km', '1/0"', 'mm', "'", '"', '1..2m', '3 4/5/6'])('invalid input %j', (text) => {
    expect(parseLength(text, 'm')).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('parseLengthList', () => {
  test('splits on commas, semicolons and x but not on spaces', () => {
    const r = parseLengthList('2\' 6 1/2", 600mm', 'm');
    expect(r.ok && r.mm.map((v) => +v.toFixed(4))).toEqual([774.7, 600]);
    const x = parseLengthList('24 x 36', 'in');
    expect(x.ok && x.mm.map((v) => +v.toFixed(4))).toEqual([609.6, 914.4]);
    const semi = parseLengthList('3;2', 'm');
    expect(semi.ok && semi.mm).toEqual([3000, 2000]);
    const arabicComma = parseLengthList('3، 2', 'm');
    expect(arabicComma.ok && arabicComma.mm).toEqual([3000, 2000]);
  });

  test('ignores empty parts and reports bad ones', () => {
    expect(parseLengthList('3, ', 'm')).toEqual({ ok: true, mm: [3000] });
    expect(parseLengthList(', ', 'm')).toEqual({ ok: false, error: 'empty' });
    expect(parseLengthList('3, abc', 'm')).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('parseTypedValues', () => {
  const typed = (text: string, unit: LengthUnit = 'm') => {
    const r = parseTypedValues(text, unit);
    if (!r.ok) throw new Error(`could not parse ${text}`);
    return { lengths: r.lengths.map((v) => +v.toFixed(6)), counts: r.counts };
  };

  test('a count with an s suffix', () => {
    expect(typed('48s')).toEqual({ lengths: [], counts: [48] });
    expect(typed('48 s')).toEqual({ lengths: [], counts: [48] });
    expect(typed('6S')).toEqual({ lengths: [], counts: [6] });
  });

  test('lengths and counts together, in any order and either unit system', () => {
    expect(typed('500mm, 48s')).toEqual({ lengths: [500], counts: [48] });
    expect(typed('12s; 2\' 6"')).toEqual({ lengths: [762], counts: [12] });
    expect(typed('0.5', 'm')).toEqual({ lengths: [500], counts: [] });
    expect(typed('600, 400', 'mm')).toEqual({ lengths: [600, 400], counts: [] });
  });

  test('Arabic-Indic digits work for counts too', () => {
    expect(typed('٤٨s')).toEqual({ lengths: [], counts: [48] });
  });

  test.each(['s', '4.5s', '-3s', 'abc', ''])('rejects %j', (text) => {
    expect(parseTypedValues(text, 'm').ok).toBe(false);
  });

  test.each([
    ['x5', 5, false],
    ['5x', 5, false],
    ['*5', 5, false],
    ['X 12', 12, false],
    ['5×', 5, false],
    ['/4', 4, true],
    ['/ 4', 4, true],
    ['/٤', 4, true],
  ])('array %j', (text, count, divide) => {
    const r = parseTypedValues(text, 'm');
    expect(r.ok && r.arrays).toEqual([{ count, divide }]);
    expect(r.ok && r.lengths.length + r.counts.length).toBe(0);
  });

  test('plain numbers are also angles; marked degrees are only angles', () => {
    const r = parseTypedValues('45', 'm');
    expect(r.ok && [r.angles, r.lengths, r.bare]).toEqual([[45], [45000], true]);
    const d = parseTypedValues('22.5°', 'm');
    expect(d.ok && [d.angles, d.lengths]).toEqual([[22.5], []]);
    const mm = parseTypedValues('500mm', 'm');
    expect(mm.ok && [mm.angles, mm.bare]).toEqual([[], false]);
  });

  test('x still separates lengths', () => {
    expect(typed('600 x 400', 'mm')).toEqual({ lengths: [600, 400], counts: [] });
    const r = parseTypedValues('600 x 400', 'mm');
    expect(r.ok && r.arrays).toEqual([]);
  });
});

describe('formatLength: metric', () => {
  const f = (v: number, s: UnitSettings) => formatLength(v, s, { locale: 'en' });

  test.each<[number, UnitSettings, string]>([
    [600, { unit: 'mm', precision: 0 }, '600 mm'],
    [600, { unit: 'cm', precision: 1 }, '60.0 cm'],
    [600, { unit: 'm', precision: 2 }, '0.60 m'],
    [1234567, { unit: 'mm', precision: 0 }, '1234567 mm'],
    [-1500, { unit: 'm', precision: 2 }, '-1.50 m'],
    [0, { unit: 'm', precision: 2 }, '0.00 m'],
    [600.4, { unit: 'mm', precision: 0 }, '~600 mm'],
    [1234, { unit: 'm', precision: 2 }, '~1.23 m'],
    [1235, { unit: 'm', precision: 3 }, '1.235 m'],
    [-0.001, { unit: 'mm', precision: 0 }, '~0 mm'],
  ])('%f mm in %o -> %s', (value, settings, expected) => {
    expect(f(value, settings)).toBe(expected);
  });

  test('approx marker can be disabled', () => {
    expect(formatLength(600.4, { unit: 'mm', precision: 0 }, { locale: 'en', markApprox: false })).toBe('600 mm');
  });

  test('digits follow the locale through Intl', () => {
    expect(formatLength(600, { unit: 'mm', precision: 0 }, { locale: 'ar-EG' })).toBe('٦٠٠ mm');
  });
});

describe('formatLength: imperial', () => {
  const f = (v: number, s: UnitSettings) => formatLength(v, s, { locale: 'en' });
  const inch = 25.4;

  test.each<[number, UnitSettings, string]>([
    [24 * inch, { unit: 'in', precision: 2 }, '24.00"'],
    [24.5 * inch, { unit: 'in', precision: 1 }, '24.5"'],
    [30 * inch, { unit: 'ft-in', precision: 16 }, '2\' 6"'],
    [30.5 * inch, { unit: 'ft-in', precision: 16 }, '2\' 6 1/2"'],
    [24 * inch, { unit: 'ft-in', precision: 16 }, '2\' 0"'],
    [6.5 * inch, { unit: 'ft-in', precision: 16 }, '6 1/2"'],
    [0.75 * inch, { unit: 'ft-in', precision: 16 }, '3/4"'],
    [0, { unit: 'ft-in', precision: 16 }, '0"'],
    [-30.5 * inch, { unit: 'ft-in', precision: 16 }, '-2\' 6 1/2"'],
    [23.5 * inch, { unit: 'in-frac', precision: 16 }, '23 1/2"'],
    [30.5 * inch, { unit: 'in-frac', precision: 16 }, '30 1/2"'],
    [(3 / 64) * inch, { unit: 'in-frac', precision: 64 }, '3/64"'],
  ])('%f mm in %o -> %s', (value, settings, expected) => {
    expect(f(value, settings)).toBe(expected);
  });

  test('rounds to the precision and carries into feet', () => {
    // 11 63/64" at 1/16 rounds up to a full foot.
    expect(f((11 + 63 / 64) * inch, { unit: 'ft-in', precision: 16 })).toBe('~1\' 0"');
    // 600 mm is 23.622"; at 1/16 that is 23 5/8".
    expect(f(600, { unit: 'in-frac', precision: 16 })).toBe('~23 5/8"');
    expect(f(600, { unit: 'ft-in', precision: 8 })).toBe('~1\' 11 5/8"');
    expect(f(600, { unit: 'ft-in', precision: 1 })).toBe('~2\' 0"');
  });

  test('round trip: formatted fractional values parse back exactly', () => {
    for (const ticks of [0, 1, 7, 15, 16, 191, 192, 385, 1000]) {
      const value = (ticks / 16) * inch;
      for (const unit of ['ft-in', 'in-frac'] as const) {
        const text = formatLength(value, { unit, precision: 16 }, { locale: 'en' });
        expect(mm(text, unit)).toBeCloseTo(value, 9);
      }
    }
  });
});

describe('formatArea', () => {
  const f = (v: number, s: UnitSettings) => formatArea(v, s, { locale: 'en' });
  test.each<[number, UnitSettings, string]>([
    [6e6, { unit: 'm', precision: 2 }, '6.00 m²'],
    [6e6, { unit: 'cm', precision: 0 }, '60000 cm²'],
    [6e6, { unit: 'mm', precision: 0 }, '6000000 mm²'],
    [144 * 645.16, { unit: 'in', precision: 1 }, '144.0 in²'],
    [144 * 645.16, { unit: 'in-frac', precision: 16 }, '144.00 in²'],
    [2 * 92903.04, { unit: 'ft-in', precision: 16 }, '2.00 ft²'],
  ])('%f mm² in %o -> %s', (value, settings, expected) => {
    expect(f(value, settings)).toBe(expected);
  });
});

describe('formatVolume', () => {
  const f = (v: number, s: UnitSettings) => formatVolume(v, s, { locale: 'en' });
  test.each<[number, UnitSettings, string]>([
    [0.5e9, { unit: 'm', precision: 3 }, '0.500 m³'],
    [0.5e9, { unit: 'cm', precision: 0 }, '500000 cm³'],
    [0.5e9, { unit: 'mm', precision: 0 }, '500000000 mm³'],
    [1728 * 16387.064, { unit: 'in', precision: 0 }, '1728 in³'],
    [1728 * 16387.064, { unit: 'in-frac', precision: 16 }, '1728.00 in³'],
    [2 * 28316846.592, { unit: 'ft-in', precision: 16 }, '2.00 ft³'],
  ])('%f mm³ in %o -> %s', (value, settings, expected) => {
    expect(f(value, settings)).toBe(expected);
  });
});

describe('angles', () => {
  test.each([
    ['45', 45],
    ['-30', -30],
    ['22.5°', 22.5],
    ['90 deg', 90],
    ['- 15', -15],
    ['٤٥', 45],
  ])('parseAngle(%j) = %d', (text, value) => {
    expect(parseAngle(text)).toBe(value);
  });

  test.each(['', 'abc', '45mm', '1/2'])('parseAngle rejects %j', (text) => {
    expect(parseAngle(text)).toBeNull();
  });

  test('formatAngle', () => {
    expect(formatAngle(22.5, { locale: 'en' })).toBe('22.5°');
    expect(formatAngle(-90, { locale: 'en' })).toBe('-90.0°');
  });
});

describe('settings', () => {
  test('precision must match the unit kind', () => {
    expect(isValidSettings({ unit: 'm', precision: 2 })).toBe(true);
    expect(isValidSettings({ unit: 'ft-in', precision: 16 })).toBe(true);
    expect(isValidSettings({ unit: 'ft-in', precision: 3 })).toBe(false);
    expect(isValidSettings({ unit: 'mm', precision: 16 })).toBe(false);
  });
});
