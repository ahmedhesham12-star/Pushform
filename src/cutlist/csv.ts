import { t, type MessageKey } from '../i18n';
import type { Scene } from '../scene';
import { formatLength, MM_PER, type UnitSettings } from '../units';
import type { CutList, CutListRow, PartWarning } from './cutList';
import { EDGES } from './edges';

/** The text of each warning, for the CSV and the panel. */
export const WARNING_KEYS: Record<PartWarning, MessageKey> = {
  severalBoards: 'cutlist.warning.severalBoards',
  thickness: 'cutlist.warning.thickness',
  stretched: 'cutlist.warning.stretched',
  notSolid: 'cutlist.warning.notSolid',
  noMaterial: 'cutlist.warning.noMaterial',
};

/** A row's warnings as text, for the CSV and the panel; a thickness warning says both thicknesses. */
export function warningText(row: CutListRow, scene: Scene, units: UnitSettings): string {
  const stock = row.materialId ? scene.materials.get(row.materialId)?.stock : undefined;
  return row.warnings
    .map((w) =>
      w === 'thickness' && stock ? t('cutlist.warning.thickness', { part: formatLength(row.thickness, units), material: formatLength(stock.thickness, units) }) : t(WARNING_KEYS[w]),
    )
    .join('; ');
}

/** A CSV field: quoted when it holds a comma, a quote or a line break. */
const field = (v: string | number) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The cut list as CSV, one row per line of parts with its part number,
 * grouped by material as in the panel, with the edge band on each edge and,
 * when asked, the cut size. UTF-8 with a byte order mark, so spreadsheets read accents.
 * Decimal units give plain numbers in the file's unit (named in the header),
 * with a point; fractional inches and feet-inches give the text as shown.
 * Hardware follows after an empty line, with its own header (milestone 6).
 */
export function toCsv(list: CutList, scene: Scene, units: UnitSettings, options: { readonly cutSize?: boolean } = {}): string {
  const decimal = units.unit === 'mm' || units.unit === 'cm' || units.unit === 'm' || units.unit === 'in';
  const symbol = decimal ? t(`units.symbol.${units.unit}` as MessageKey) : '';
  const size = (label: MessageKey) => (decimal ? t('cutlist.csv.withUnit', { label: t(label), unit: symbol }) : t(label));
  // Rounded to the file's precision, without trailing zeros.
  const length = (mm: number) => (decimal ? String(Number((mm / MM_PER[units.unit as 'mm' | 'cm' | 'm' | 'in']).toFixed(units.precision))) : formatLength(mm, units));
  const cut = options.cutSize ? [size('cutlist.cutLength'), size('cutlist.cutWidth')] : [];
  const edges = EDGES.map((e) => t(`cutlist.edge.${e}` as MessageKey));
  const header = [t('cutlist.number'), t('cutlist.material'), t('cutlist.part'), t('cutlist.quantity'), size('cutlist.length'), size('cutlist.width'), size('cutlist.thickness'), ...cut, t('cutlist.grain'), ...edges, t('cutlist.warnings')];
  const lines = [header.map(field).join(',')];
  for (const r of list.rows) {
    const material = r.materialId ? scene.materials.get(r.materialId)!.name : t('cutlist.noMaterial');
    const grain = r.grain ? t(`cutlist.grain.${r.grain}` as MessageKey) : '';
    const warnings = warningText(r, scene, units);
    const cutSizes = options.cutSize ? [length(r.cutLength), length(r.cutWidth)] : [];
    const bands = EDGES.map((e) => (r.bands[e] ? scene.materials.get(r.bands[e])!.name : ''));
    lines.push([r.number, material, r.name, r.quantity, length(r.length), length(r.width), length(r.thickness), ...cutSizes, grain, ...bands, warnings].map(field).join(','));
  }
  if (list.hardware.length) {
    const price = (v: number | null) => (v === null ? '' : v.toFixed(2));
    lines.push('', [t('cutlist.hardware'), t('hardware.manufacturer'), t('hardware.partNumber'), t('cutlist.quantity'), t('hardware.price'), t('hardware.cost'), t('hardware.link')].map(field).join(','));
    for (const h of list.hardware) lines.push([h.name, h.manufacturer, h.partNumber, h.quantity, price(h.price), price(h.cost), h.link].map(field).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
