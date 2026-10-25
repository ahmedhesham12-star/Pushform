/**
 * English catalog. This is the source of truth for message keys: other locales
 * must provide the same keys (missing ones fall back to English).
 * Placeholders use {name} and are filled by t().
 */
export const en = {
  'units.symbol.mm': 'mm',
  'units.symbol.cm': 'cm',
  'units.symbol.m': 'm',
  'units.symbol.ft': "'",
  'units.symbol.in': '"',
  'units.symbol.mm2': 'mm²',
  'units.symbol.cm2': 'cm²',
  'units.symbol.m2': 'm²',
  'units.symbol.in2': 'in²',
  'units.symbol.ft2': 'ft²',
} as const;

export type MessageKey = keyof typeof en;
export type Catalog = { readonly [K in MessageKey]: string };
