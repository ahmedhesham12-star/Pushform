/**
 * Hardware details (milestone 6) on a component or reference mesh: slides,
 * hinges, handles. Hardware is bought, not cut: the cut list leaves it out
 * with everything inside it and lists it on its own.
 */
export interface Hardware {
  readonly manufacturer: string;
  readonly partNumber: string;
  /** Per piece, in the file's currency; null without a price. */
  readonly price: number | null;
  /** Where to buy it or read about it: empty, or an http or https address. */
  readonly link: string;
}

export const NO_DETAILS: Hardware = { manufacturer: '', partNumber: '', price: null, link: '' };

/** Whether a text can be a hardware link: empty, or an http or https address with no spaces. */
export const validLink = (s: string): boolean => s === '' || /^https?:\/\/\S+$/i.test(s);

/** Hardware details from a file, or null when they are not valid. */
export function validHardware(v: unknown): Hardware | null {
  if (typeof v !== 'object' || v === null) return null;
  const x = v as Record<string, unknown>;
  if (typeof x.manufacturer !== 'string' || typeof x.partNumber !== 'string' || typeof x.link !== 'string' || !validLink(x.link)) return null;
  if (x.price !== null && (typeof x.price !== 'number' || !Number.isFinite(x.price) || x.price < 0)) return null;
  return { manufacturer: x.manufacturer, partNumber: x.partNumber, price: x.price as number | null, link: x.link };
}
