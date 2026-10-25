/** Millimeters per unit. The internal storage unit is the millimeter. */
export const MM_PER = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
} as const;

export type BaseUnit = keyof typeof MM_PER;

export function toMm(value: number, unit: BaseUnit): number {
  return value * MM_PER[unit];
}

export function fromMm(mm: number, unit: BaseUnit): number {
  return mm / MM_PER[unit];
}
