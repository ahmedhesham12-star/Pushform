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

/** Apply lang and dir to a document root (the html element). */
export function applyLocaleToDocument(root: HTMLElement): void {
  root.lang = LOCALES[current].tag;
  root.dir = LOCALES[current].dir;
}
