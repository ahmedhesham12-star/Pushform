/**
 * The cut list (milestone 5), as OpenCutList makes one for SketchUp. Pure:
 * it reads the scene and imports nothing but the kernel, the scene, units
 * and i18n.
 *
 * A part is a group or component holding faces and no other groups or
 * components; those holding others are assemblies, and parts are found at
 * any depth. A part's size is its definition's box along its own axes, as
 * placed (scaled by every instance above it). Its thickness is the smallest
 * size and its length the largest, unless a grain direction picks the
 * length. Its material is the one most of its painted face area shows. Identical
 * parts are one row with a quantity.
 */
import { bounds, faceArea, listFaces, solidVolume, type Model } from '../kernel';
import { t } from '../i18n';
import { inheritedMaterial, placedInstances, tagShown, type GrainAxis, type InstanceId, type MaterialId, type Scene, type Stock } from '../scene';

/**
 * What can be wrong with a part. `severalBoards` stands for a thick part that
 * is not a solid (a whole cabinet modeled in one group or component): it
 * replaces the thickness and not-a-solid warnings, which would not say what to do.
 */
export type PartWarning = 'severalBoards' | 'thickness' | 'stretched' | 'notSolid' | 'noMaterial';

export interface CutListRow {
  /** What makes these parts one row. */
  readonly key: string;
  readonly name: string;
  readonly quantity: number;
  /** Sizes in mm: length, then width, then thickness. */
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly materialId: MaterialId | null;
  readonly grain: GrainAxis | null;
  readonly warnings: readonly PartWarning[];
  /** Where each of these parts is: its instance path from the root. */
  readonly paths: readonly (readonly InstanceId[])[];
}

export interface MaterialTotal {
  readonly materialId: MaterialId | null;
  /** How many parts. */
  readonly quantity: number;
  /** Part faces, length times width, in mm². */
  readonly area: number;
  /** Part volumes, length times width times thickness, in mm³. */
  readonly volume: number;
  readonly stock: Stock | undefined;
  /** For sheet goods: sheets needed with the waste, as a fraction and rounded up. */
  readonly sheets: { readonly exact: number; readonly count: number } | null;
  /** For solid wood: board volume with the waste, in mm³. */
  readonly boardVolume: number | null;
  /** In the file's currency; null without a price. */
  readonly cost: number | null;
}

export interface CutList {
  readonly rows: readonly CutListRow[];
  readonly totals: readonly MaterialTotal[];
  /** Parts a hidden tag hides that are not listed (0 when hidden parts are listed). */
  readonly hiddenLeftOut: number;
  /** Assemblies (groups and components holding others) with loose faces of their own, which are not parts. */
  readonly looseInAssemblies: readonly { readonly name: string; readonly path: readonly InstanceId[] }[];
}

export interface CutListOptions {
  /** Waste as a fraction (0.15 is 15%). */
  readonly waste: number;
  readonly includeHidden: boolean;
}

/** A thickness this close (mm) to the stock's matches it. */
const THICKNESS_TOLERANCE = 0.05;
/** A part that is not a solid and thicker than this (mm), or than its material's stock, is taken for several boards in one. */
const BOARD_THICKNESS = 50;
const MM3_PER_BOARD_FOOT = 25.4 ** 3 * 144;
const MM3_PER_CUBIC_METER = 1e9;
/** Our axes as SketchUp names them: red is x, green is z, blue is y (up). */
const AXIS_INDEX: Record<GrainAxis, number> = { red: 0, green: 2, blue: 1 };

/** Ids for models, so copied groups that still share geometry group together. */
const modelIds = new WeakMap<Model, number>();
let nextModel = 1;
const modelId = (m: Model) => {
  let id = modelIds.get(m);
  if (id === undefined) modelIds.set(m, (id = nextModel++));
  return id;
};

const round = (mm: number) => Math.round(mm * 1000) / 1000;

export function cutList(scene: Scene, options: CutListOptions): CutList {
  const hidden = (i: { readonly tag?: string }) => !tagShown(scene, i.tag);
  const placed = placedInstances(scene, scene.rootId, undefined, [], options.includeHidden ? undefined : hidden);
  const rows = new Map<string, Omit<CutListRow, 'quantity'> & { paths: (readonly InstanceId[])[] }>();
  const looseInAssemblies: { name: string; path: readonly InstanceId[] }[] = [];
  const nameOf = (p: (typeof placed)[number]) => {
    const def = scene.definitions.get(p.instance.definitionId)!;
    return p.instance.name || def.name || t('scene.group');
  };
  for (const p of placed) {
    const def = scene.definitions.get(p.instance.definitionId)!;
    const faces = listFaces(def.model);
    if (def.instances.size) {
      if (faces.length) looseInAssemblies.push({ name: nameOf(p), path: p.path });
      continue;
    }
    const box = bounds(def.model);
    if (!faces.length || !box) continue;
    // Each own axis as placed: its length is the scale along it.
    const m = p.world.m;
    const column = (i: number) => [m[3 * i]!, m[3 * i + 1]!, m[3 * i + 2]!];
    const scales = [0, 1, 2].map((i) => Math.hypot(...column(i)));
    const sizes = [0, 1, 2].map((i) => (box.max[i]! - box.min[i]!) * scales[i]!);
    const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    const skewed = [0, 1, 2].some((i) => Math.abs(dot(column(i), column((i + 1) % 3))) > 1e-9 * scales[i]! * scales[(i + 1) % 3]!);
    const stretched = skewed || scales.some((s) => Math.abs(s - scales[0]!) > 1e-9 * scales[0]!);
    const grain = def.grain ?? null;
    let length: number, width: number, thickness: number;
    if (grain) {
      const along = AXIS_INDEX[grain];
      const rest = sizes.filter((_, i) => i !== along).sort((a, b) => b - a);
      [length, width, thickness] = [sizes[along]!, rest[0]!, rest[1]!];
    } else [length, width, thickness] = [...sizes].sort((a, b) => b - a) as [number, number, number];

    // The material most of the part's painted face area shows (its own paint, else what is passed
    // down); unpainted faces do not count, so edges painted on their own still give the part its material.
    const inherited = inheritedMaterial(scene, p.path);
    const area = new Map<MaterialId | null, number>();
    for (const f of faces) {
      const own = f.paint?.front;
      const id = own && scene.materials.has(own) ? own : (inherited ?? null);
      area.set(id, (area.get(id) ?? 0) + faceArea(def.model, f.id));
    }
    const painted = [...area].filter(([id]) => id !== null).sort((a, b) => b[1] - a[1]);
    const materialId = painted[0]?.[0] ?? null;

    const warnings: PartWarning[] = [];
    const stock = materialId ? scene.materials.get(materialId)!.stock : undefined;
    const solid = solidVolume(def.model) !== null;
    if (!solid && thickness > (stock?.thickness ?? BOARD_THICKNESS) + THICKNESS_TOLERANCE) warnings.push('severalBoards');
    else {
      if (stock && Math.abs(stock.thickness - thickness) > THICKNESS_TOLERANCE) warnings.push('thickness');
      if (!solid) warnings.push('notSolid');
    }
    if (stretched) warnings.push('stretched');
    if (!materialId) warnings.push('noMaterial');

    const name = nameOf(p);
    // Components group by definition; groups by their geometry, which copies share until edited.
    const identity = def.kind === 'component' ? `d:${def.id}` : `m:${modelId(def.model)}`;
    const key = [identity, name, round(length), round(width), round(thickness), materialId ?? '', grain ?? '', warnings.join(',')].join('|');
    const row = rows.get(key);
    if (row) row.paths.push(p.path);
    else rows.set(key, { key, name, length, width, thickness, materialId, grain, warnings, paths: [p.path] });
  }

  const materialName = (id: MaterialId | null) => (id ? scene.materials.get(id)!.name : null);
  const out: CutListRow[] = [...rows.values()]
    .map((r) => ({ ...r, quantity: r.paths.length }))
    .sort((a, b) => order(materialName(a.materialId), materialName(b.materialId)) || collator.compare(a.name, b.name) || b.length - a.length);

  let hiddenLeftOut = 0;
  if (!options.includeHidden) {
    const all = placedInstances(scene);
    const shown = new Set(placed.map((p) => p.path.join('/')));
    hiddenLeftOut = all.filter((p) => !shown.has(p.path.join('/')) && isPart(scene, p.instance.definitionId)).length;
  }
  return { rows: out, totals: totals(scene, out, options.waste), hiddenLeftOut, looseInAssemblies };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** Materials by name, parts with no material last. */
const order = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : collator.compare(a, b));

function isPart(scene: Scene, definitionId: string): boolean {
  const def = scene.definitions.get(definitionId);
  return !!def && !def.instances.size && listFaces(def.model).length > 0;
}

/** Totals per material, in the order of the rows: area, volume, sheets or board volume with the waste, and cost. */
function totals(scene: Scene, rows: readonly CutListRow[], waste: number): MaterialTotal[] {
  const by = new Map<MaterialId | null, { quantity: number; area: number; volume: number }>();
  for (const r of rows) {
    const x = by.get(r.materialId) ?? { quantity: 0, area: 0, volume: 0 };
    x.quantity += r.quantity;
    x.area += r.length * r.width * r.quantity;
    x.volume += r.length * r.width * r.thickness * r.quantity;
    by.set(r.materialId, x);
  }
  return [...by].map(([materialId, x]) => {
    const stock = materialId ? scene.materials.get(materialId)!.stock : undefined;
    let sheets: MaterialTotal['sheets'] = null;
    let boardVolume: number | null = null;
    let cost: number | null = null;
    if (stock?.kind === 'sheet') {
      const exact = (x.area * (1 + waste)) / (stock.length * stock.width);
      // A hair over a whole sheet is rounding, not another sheet.
      sheets = { exact, count: Math.ceil(exact - 1e-9) };
      if (stock.price !== undefined) cost = sheets.count * stock.price;
    } else if (stock?.kind === 'solid') {
      boardVolume = x.volume * (1 + waste);
      if (stock.price !== undefined) cost = (boardVolume / (stock.per === 'boardFoot' ? MM3_PER_BOARD_FOOT : MM3_PER_CUBIC_METER)) * stock.price;
    }
    return { materialId, ...x, stock, sheets, boardVolume, cost };
  });
}

/** Board feet in a volume of mm³ (for files in inches or feet). */
export const boardFeet = (mm3: number) => mm3 / MM3_PER_BOARD_FOOT;
