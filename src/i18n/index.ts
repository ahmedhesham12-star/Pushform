import { en, type Catalog, type MessageKey } from './en';

export type { MessageKey } from './en';

export type Locale = 'en';
export type TextDirection = 'ltr' | 'rtl';

interface LocaleInfo {
  /** BCP 47 tag passed to Intl formatters. */
  tag: string;
  dir: TextDirection;
  catalog: Partial<Catalog>;
}

const LOCALES: Record<Locale, LocaleInfo> = {
  en: { tag: 'en', dir: 'ltr', catalog: en },
};

let current: Locale = 'en';

export type MessageParams = Record<string, string | number>;

/** Translate a message key, filling {placeholders} from params. */
export function t(key: MessageKey, params?: MessageParams): string {
  const text = LOCALES[current].catalog[key] ?? en[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/** Keys with a form for one and a form for other counts: "key.one" and "key.other". */
type CountedKey = MessageKey extends infer K ? (K extends `${infer Base}.one` ? Base : never) : never;

/**
 * Translate a message that depends on a count: the locale's plural rule picks
 * the key's .one or .other form. `count` is the number; `shown` its text in
 * the message, already formatted (the {count} placeholder).
 */
export function tCount(key: CountedKey, count: number, shown: string, params: MessageParams = {}): string {
  const form = new Intl.PluralRules(localeTag()).select(count) === 'one' ? 'one' : 'other';
  return t(`${key}.${form}` as MessageKey, { ...params, count: shown });
}

export function getLocale(): Locale {
  return current;
}

/** BCP 47 tag of the active locale, for Intl APIs. */
export function localeTag(): string {
  return LOCALES[current].tag;
}

export function textDirection(): TextDirection {
  return LOCALES[current].dir;
}

export function setLocale(locale: Locale): void {
  current = locale;
}

/** The region of the browser's language (US for en-US; the likely one for a bare "en"), or null when unknown. */
export function browserRegion(): string | null {
  try {
    const language = typeof navigator === 'undefined' ? '' : navigator.language;
    return language ? (new Intl.Locale(language).maximize().region ?? null) : null;
  } catch {
    return null;
  }
}

/** Apply lang and dir to a document root (the html element). */
export function applyLocaleToDocument(root: HTMLElement): void {
  root.lang = LOCALES[current].tag;
  root.dir = LOCALES[current].dir;
}
