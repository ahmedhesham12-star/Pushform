/**
 * Part labels (milestone 6): one per part placed, in cut list order, each
 * with its part number and which copy it is, its name and assembly (the
 * nearest component above it), its size (the cut size when asked), its
 * material, whether it has a grain, and its edge banding. And the label
 * sheets they print on.
 */
import type { InstanceId, MaterialId, Scene } from '../scene';
import type { CutList } from './cutList';
import type { Bands } from './edges';

export interface PartLabel {
  readonly number: number;
  /** Which copy of the row this is (1, 2, ...), and how many there are. */
  readonly copy: number;
  readonly count: number;
  readonly name: string;
  /** The nearest component above the part, by its name; null when there is none. */
  readonly assembly: string | null;
  /** In mm: the finished size, or the cut size when asked. */
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly cutSize: boolean;
  readonly materialId: MaterialId | null;
  /** The part has a grain along its length (its material has one, or it has a grain direction). */
  readonly grain: boolean;
  readonly bands: Bands;
}

/** The name of the nearest component above the part at the end of a path. */
function assemblyOf(scene: Scene, path: readonly InstanceId[]): string | null {
  const above: { name: string; component: boolean }[] = [];
  let def = scene.definitions.get(scene.rootId);
  for (const id of path.slice(0, -1)) {
    const i = def?.instances.get(id);
    def = i && scene.definitions.get(i.definitionId);
    if (!i || !def) return null;
    above.push({ name: i.name || def.name, component: def.kind === 'component' });
  }
  return above.reverse().find((a) => a.component)?.name ?? null;
}

export function partLabels(scene: Scene, list: CutList, options: { readonly cutSize?: boolean } = {}): PartLabel[] {
  const cut = options.cutSize ?? false;
  return list.rows.flatMap((r) => {
    const stock = r.materialId ? scene.materials.get(r.materialId)?.stock : undefined;
    const grain = !!r.grain || (!!stock && stock.kind !== 'band' && stock.grain);
    return r.paths.map((path, i) => ({
      number: r.number,
      copy: i + 1,
      count: r.quantity,
      name: r.name,
      assembly: assemblyOf(scene, path),
      length: cut ? r.cutLength : r.length,
      width: cut ? r.cutWidth : r.width,
      thickness: r.thickness,
      cutSize: cut,
      materialId: r.materialId,
      grain,
      bands: r.bands,
    }));
  });
}

/** The label sheets offered, and a grid of one's own. */
export const LABEL_PRESETS = ['a4-3x8', 'a4-2x7', 'letter-3x10', 'custom'] as const;
export type LabelPreset = (typeof LABEL_PRESETS)[number];
export type LabelPage = 'a4' | 'letter';

/** The label layout, a setting of the device: a preset, or a custom grid on a page. */
export interface LabelSettings {
  readonly preset: LabelPreset;
  /** For a custom grid. */
  readonly page: LabelPage;
  readonly columns: number;
  readonly rows: number;
}

export const PAGE_SIZES: Record<LabelPage, { readonly width: number; readonly height: number }> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};

/** Where labels sit on a sheet, in mm from its top and start edges. */
export interface LabelSheet {
  readonly page: LabelPage;
  readonly columns: number;
  readonly rows: number;
  readonly label: { readonly width: number; readonly height: number };
  readonly margin: { readonly top: number; readonly start: number };
  readonly gap: { readonly x: number; readonly y: number };
}

/**
 * The presets match common label stock: A4 sheets of 24 labels 70 x 37 mm
 * edge to edge; A4 sheets of 14 labels 99.1 x 38.1 mm (as Avery L7163);
 * Letter sheets of 30 labels 2 5/8 x 1 in (as Avery 5160).
 */
const PRESET_SHEETS: Record<Exclude<LabelPreset, 'custom'>, LabelSheet> = {
  'a4-3x8': { page: 'a4', columns: 3, rows: 8, label: { width: 70, height: 37 }, margin: { top: 0.5, start: 0 }, gap: { x: 0, y: 0 } },
  'a4-2x7': { page: 'a4', columns: 2, rows: 7, label: { width: 99.1, height: 38.1 }, margin: { top: 15.15, start: 4.65 }, gap: { x: 2.5, y: 0 } },
  'letter-3x10': { page: 'letter', columns: 3, rows: 10, label: { width: 66.675, height: 25.4 }, margin: { top: 12.7, start: 4.7625 }, gap: { x: 3.175, y: 0 } },
};

/** A custom grid fills its page inside this margin, with this gap between labels (mm). */
const CUSTOM_MARGIN = 10;
const CUSTOM_GAP = 2;
export const MAX_LABEL_COLUMNS = 6;
export const MAX_LABEL_ROWS = 20;

export function labelSheet(s: LabelSettings): LabelSheet {
  if (s.preset !== 'custom') return PRESET_SHEETS[s.preset];
  const page = PAGE_SIZES[s.page];
  const across = (room: number, n: number) => (room - 2 * CUSTOM_MARGIN - (n - 1) * CUSTOM_GAP) / n;
  return {
    page: s.page,
    columns: s.columns,
    rows: s.rows,
    label: { width: across(page.width, s.columns), height: across(page.height, s.rows) },
    margin: { top: CUSTOM_MARGIN, start: CUSTOM_MARGIN },
    gap: { x: CUSTOM_GAP, y: CUSTOM_GAP },
  };
}

/** Label settings read from the device, or null when they are not valid. */
export function validLabelSettings(v: unknown): LabelSettings | null {
  if (typeof v !== 'object' || v === null) return null;
  const x = v as Record<string, unknown>;
  const count = (n: unknown, max: number) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= max;
  if (!LABEL_PRESETS.includes(x.preset as LabelPreset) || (x.page !== 'a4' && x.page !== 'letter') || !count(x.columns, MAX_LABEL_COLUMNS) || !count(x.rows, MAX_LABEL_ROWS)) return null;
  return { preset: x.preset as LabelPreset, page: x.page, columns: x.columns as number, rows: x.rows as number };
}

/** Regions that use Letter paper. */
const LETTER = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'CR', 'PR', 'DO', 'PA', 'SV', 'NI', 'HN']);

/** The first label layout on a device: Letter 3 x 10 where Letter paper is used, else A4 3 x 8. */
export function defaultLabelSettings(region: string | null): LabelSettings {
  return region && LETTER.has(region.toUpperCase()) ? { preset: 'letter-3x10', page: 'letter', columns: 3, rows: 10 } : { preset: 'a4-3x8', page: 'a4', columns: 3, rows: 8 };
}
