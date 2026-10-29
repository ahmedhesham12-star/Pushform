import { t, type MessageKey } from '../i18n';
import type { Scene } from '../scene';
import { formatLength, MM_PER, type UnitSettings } from '../units';
import type { CutList, PartWarning } from './cutList';

/** The text of each warning, for the CSV and the panel. */
export const WARNING_KEYS: Record<PartWarning, MessageKey> = {
  thickness: 'cutlist.warning.thickness',
  stretched: 'cutlist.warning.stretched',
  notSolid: 'cutlist.warning.notSolid',
  noMaterial: 'cutlist.warning.noMaterial',
};

/** A CSV field: quoted when it holds a comma, a quote or a line break. */
const field = (v: string | number) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The cut list as CSV, one row per line of parts, grouped by material as in
 * the panel. UTF-8 with a byte order mark, so spreadsheets read accents.
 * Decimal units give plain numbers in the file's unit (named in the header),
 * with a point; fractional inches and feet-inches give the text as shown.
 */
export function toCsv(list: CutList, scene: Scene, units: UnitSettings): string {
  const decimal = units.unit === 'mm' || units.unit === 'cm' || units.unit === 'm' || units.unit === 'in';
  const symbol = decimal ? t(`units.symbol.${units.unit}` as MessageKey) : '';
  const size = (label: MessageKey) => (decimal ? t('cutlist.csv.withUnit', { label: t(label), unit: symbol }) : t(label));
  // Rounded to the file's precision, without trailing zeros.
  const length = (mm: number) => (decimal ? String(Number((mm / MM_PER[units.unit as 'mm' | 'cm' | 'm' | 'in']).toFixed(units.precision))) : formatLength(mm, units));
  const header = [t('cutlist.material'), t('cutlist.part'), t('cutlist.quantity'), size('cutlist.length'), size('cutlist.width'), size('cutlist.thickness'), t('cutlist.grain'), t('cutlist.warnings')];
  const lines = [header.map(field).join(',')];
  for (const r of list.rows) {
    const material = r.materialId ? scene.materials.get(r.materialId)!.name : t('cutlist.noMaterial');
    const grain = r.grain ? t(`cutlist.grain.${r.grain}` as MessageKey) : '';
    const warnings = r.warnings.map((w) => t(WARNING_KEYS[w])).join('; ');
    lines.push([material, r.name, r.quantity, length(r.length), length(r.width), length(r.thickness), grain, warnings].map(field).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
