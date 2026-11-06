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
 * length. Its material is the one most of its painted face area shows, edge
 * band aside: bands on its side faces band its edges (milestone 6). Identical
 * parts are one row with a quantity. Hardware (milestone 6) is left out with
 * everything inside it, and listed on its own by definition.
 */
import { faceArea, listFaces, solidVolume, type Model } from '../kernel';
import { t } from '../i18n';
import { inheritedMaterial, isEdgeBand, placedInstances, tagShown, type DefinitionId, type GrainAxis, type Instance, type InstanceId, type MaterialId, type Scene, type Stock } from '../scene';
import { layoutBoards, type BoardLayout } from './boardLayouts';
import { bandsOf, cutSize, EDGES, partAxes, partEdges, type Bands } from './edges';
import { DEFAULT_LAYOUT, layoutSheets, type LayoutSettings, type Piece, type SheetLayout } from './sheetLayouts';

/**
 * What can be wrong with a part. `severalBoards` stands for a thick part that
 * is not a solid (a whole cabinet modeled in one group or component): it
 * replaces the thickness and not-a-solid warnings, which would not say what to do.
 */
export type PartWarning = 'severalBoards' | 'thickness' | 'stretched' | 'notSolid' | 'noMaterial';

export interface CutListRow {
  /** What makes these parts one row. */
  readonly key: string;
  /** The part number (1, 2, 3 in list order), shared by its copies, on the diagrams and labels too. */
  readonly number: number;
  readonly name: string;
  readonly quantity: number;
  /** Sizes in mm: length, then width, then thickness. */
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly materialId: MaterialId | null;
  readonly grain: GrainAxis | null;
  /** The edge band on each of its four edges (milestone 6). */
  readonly bands: Bands;
  /** Its length and width before banding: each banded edge's band thickness less. */
  readonly cutLength: number;
  readonly cutWidth: number;
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
  /** For sheet goods: the parts laid out on sheets (its sheet count is what to buy). */
  readonly sheetLayout: SheetLayout | null;
  /** For solid wood with a board length: the parts laid out on boards. */
  readonly boardLayout: BoardLayout | null;
  /** For solid wood: board volume with the waste, in mm³. */
  readonly boardVolume: number | null;
  /** In the file's currency; null without a price. */
  readonly cost: number | null;
}

/** One edge band's total: its banded edges' length, with the waste, and cost. */
export interface BandTotal {
  readonly materialId: MaterialId;
  /** In mm. */
  readonly length: number;
  readonly withWaste: number;
  /** In the file's currency, by the meter; null without a price. */
  readonly cost: number | null;
}

/** Hardware of one definition: how many are placed, and their cost. */
export interface HardwareRow {
  readonly definitionId: DefinitionId;
  readonly name: string;
  readonly manufacturer: string;
  readonly partNumber: string;
  readonly link: string;
  readonly quantity: number;
  /** Per piece, and for all of them; null without a price. */
  readonly price: number | null;
  readonly cost: number | null;
  readonly paths: readonly (readonly InstanceId[])[];
}

export interface CutList {
  readonly rows: readonly CutListRow[];
  /** Hardware by name, each counted where it is placed (not inside other hardware). */
  readonly hardware: readonly HardwareRow[];
  readonly totals: readonly MaterialTotal[];
  /** Per edge band, by name. */
  readonly bands: readonly BandTotal[];
  /** Parts a hidden tag hides that are not listed (0 when hidden parts are listed). */
  readonly hiddenLeftOut: number;
  /** Assemblies (groups and components holding others) with loose faces of their own, which are not parts. */
  readonly looseInAssemblies: readonly { readonly name: string; readonly path: readonly InstanceId[] }[];
}

export interface CutListOptions extends Partial<LayoutSettings> {
  /** Waste as a fraction (0.15 is 15%), added to board volume and edge band (sheets are counted by their layout). */
  readonly waste: number;
  readonly includeHidden: boolean;
  /** Lay parts out at their cut size, before banding. */
  readonly cutSize?: boolean;
}

/** A thickness this close (mm) to the stock's matches it. */
const THICKNESS_TOLERANCE = 0.05;
/** A part that is not a solid and thicker than this (mm), or than its material's stock, is taken for several boards in one. */
const BOARD_THICKNESS = 50;
const MM3_PER_BOARD_FOOT = 25.4 ** 3 * 144;
const MM3_PER_CUBIC_METER = 1e9;

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
  // Hardware is placed, not cut: it and everything inside it are left out of the parts.
  const isHardware = (i: Instance) => !!scene.definitions.get(i.definitionId)?.hardware;
  const shown = placedInstances(scene, scene.rootId, undefined, [], options.includeHidden ? undefined : hidden);
  const placed = placedInstances(scene, scene.rootId, undefined, [], (i) => (!options.includeHidden && hidden(i)) || isHardware(i));
  const hardware = hardwareRows(scene, shown);
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
    const grain = def.grain ?? null;
    const axes = faces.length ? partAxes(def.model, grain, p.world) : null;
    if (!axes) continue;
    const [length, width, thickness] = axes.sizes;
    const stretched = axes.stretched;
    const bands = bandsOf(partEdges(scene, def.model, axes));
    const cut = cutSize(scene, length, width, bands);

    // The material most of the part's painted face area shows (its own paint, else what is passed
    // down); unpainted faces do not count, so edges painted on their own still give the part its material.
    // Edge band is not what a part is made of: banded faces do not count, and a band passed down is none.
    const passed = inheritedMaterial(scene, p.path);
    const inherited = isEdgeBand(scene, passed) ? undefined : passed;
    const area = new Map<MaterialId | null, number>();
    for (const f of faces) {
      const own = f.paint?.front;
      if (isEdgeBand(scene, own)) continue;
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
    const banding = EDGES.map((e) => bands[e] ?? '').join(',');
    const key = [identity, name, round(length), round(width), round(thickness), materialId ?? '', grain ?? '', banding, warnings.join(',')].join('|');
    const row = rows.get(key);
    if (row) row.paths.push(p.path);
    else rows.set(key, { key, number: 0, name, length, width, thickness, materialId, grain, bands, cutLength: cut.length, cutWidth: cut.width, warnings, paths: [p.path] });
  }

  const materialName = (id: MaterialId | null) => (id ? scene.materials.get(id)!.name : null);
  const out: CutListRow[] = [...rows.values()]
    .map((r) => ({ ...r, quantity: r.paths.length }))
    .sort((a, b) => order(materialName(a.materialId), materialName(b.materialId)) || collator.compare(a.name, b.name) || b.length - a.length)
    .map((r, i) => ({ ...r, number: i + 1 }));

  let hiddenLeftOut = 0;
  if (!options.includeHidden) {
    const all = placedInstances(scene, scene.rootId, undefined, [], isHardware);
    const listed = new Set(placed.map((p) => p.path.join('/')));
    hiddenLeftOut = all.filter((p) => !listed.has(p.path.join('/')) && isPart(scene, p.instance.definitionId)).length;
  }
  const layout: LayoutSettings = {
    kerf: options.kerf ?? DEFAULT_LAYOUT.kerf,
    trim: options.trim ?? DEFAULT_LAYOUT.trim,
    guillotine: options.guillotine ?? DEFAULT_LAYOUT.guillotine,
    firstCut: options.firstCut ?? DEFAULT_LAYOUT.firstCut,
    minOffcut: options.minOffcut ?? DEFAULT_LAYOUT.minOffcut,
  };
  return { rows: out, hardware, totals: totals(scene, out, options.waste, layout, options.cutSize ?? false), bands: bandTotals(scene, out, options.waste), hiddenLeftOut, looseInAssemblies };
}

/** Hardware by definition among the placed instances, not counting hardware inside hardware. */
function hardwareRows(scene: Scene, placed: ReturnType<typeof placedInstances>): HardwareRow[] {
  const by = new Map<DefinitionId, (readonly InstanceId[])[]>();
  const outer = new Set<string>();
  for (const p of placed) {
    const def = scene.definitions.get(p.instance.definitionId)!;
    if (!def.hardware) continue;
    if (p.path.some((_, k) => outer.has(p.path.slice(0, k).join('/')))) continue;
    outer.add(p.path.join('/'));
    by.set(def.id, [...(by.get(def.id) ?? []), p.path]);
  }
  return [...by]
    .map(([definitionId, paths]) => {
      const def = scene.definitions.get(definitionId)!;
      const h = def.hardware!;
      const quantity = paths.length;
      return { definitionId, name: def.name, manufacturer: h.manufacturer, partNumber: h.partNumber, link: h.link, quantity, price: h.price, cost: h.price === null ? null : h.price * quantity, paths };
    })
    .sort((a, b) => collator.compare(a.name, b.name));
}

/** Each edge band's banded edges, end to end: a length edge is the part's length, a width edge its width. */
function bandTotals(scene: Scene, rows: readonly CutListRow[], waste: number): BandTotal[] {
  const by = new Map<MaterialId, number>();
  for (const r of rows) {
    for (const e of EDGES) {
      const id = r.bands[e];
      if (id) by.set(id, (by.get(id) ?? 0) + (e.startsWith('length') ? r.length : r.width) * r.quantity);
    }
  }
  return [...by]
    .map(([materialId, length]) => {
      const stock = scene.materials.get(materialId)!.stock;
      const withWaste = length * (1 + waste);
      return { materialId, length, withWaste, cost: stock?.price === undefined ? null : (withWaste / 1000) * stock.price };
    })
    .sort((a, b) => collator.compare(scene.materials.get(a.materialId)!.name, scene.materials.get(b.materialId)!.name));
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** Materials by name, parts with no material last. */
const order = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : collator.compare(a, b));

function isPart(scene: Scene, definitionId: string): boolean {
  const def = scene.definitions.get(definitionId);
  return !!def && !def.instances.size && listFaces(def.model).length > 0;
}

/**
 * Recent layouts by their inputs: the cut list is recomputed after every
 * edit, and laying out hundreds of parts takes a good part of a second, while
 * most edits leave a material's parts as they were.
 */
const layouts = new Map<string, SheetLayout | BoardLayout>();
const LAYOUTS_KEPT = 32;
function cached<L extends SheetLayout | BoardLayout>(key: unknown, make: () => L): L {
  const k = JSON.stringify(key);
  const hit = layouts.get(k) as L | undefined;
  if (hit) return hit;
  const made = make();
  layouts.set(k, made);
  if (layouts.size > LAYOUTS_KEPT) layouts.delete(layouts.keys().next().value!);
  return made;
}

/**
 * Totals per material, in the order of the rows: area, volume, the sheet or
 * board layout (of the cut sizes when `cut`), board volume with the waste,
 * and cost (sheets by the layout's count, solid wood by volume).
 */
function totals(scene: Scene, rows: readonly CutListRow[], waste: number, layout: LayoutSettings, cut: boolean): MaterialTotal[] {
  const by = new Map<MaterialId | null, { quantity: number; area: number; volume: number; pieces: Piece[] }>();
  for (const r of rows) {
    const x = by.get(r.materialId) ?? { quantity: 0, area: 0, volume: 0, pieces: [] };
    x.quantity += r.quantity;
    x.area += r.length * r.width * r.quantity;
    x.volume += r.length * r.width * r.thickness * r.quantity;
    const [length, width] = cut ? [r.cutLength, r.cutWidth] : [r.length, r.width];
    for (let copy = 1; copy <= r.quantity; copy++) x.pieces.push({ number: r.number, copy, length, width });
    by.set(r.materialId, x);
  }
  return [...by].map(([materialId, { pieces, ...x }]) => {
    const stock = materialId ? scene.materials.get(materialId)!.stock : undefined;
    let sheetLayout: SheetLayout | null = null;
    let boardLayout: BoardLayout | null = null;
    let boardVolume: number | null = null;
    let cost: number | null = null;
    if (stock?.kind === 'sheet') {
      sheetLayout = cached(['s', pieces, stock.length, stock.width, stock.grain, layout], () => layoutSheets(pieces, stock, layout));
      if (stock.price !== undefined) cost = sheetLayout.sheets.length * stock.price;
    } else if (stock?.kind === 'solid') {
      const board = stock.length;
      if (board !== undefined) boardLayout = cached(['b', pieces, board, layout], () => layoutBoards(pieces, board, layout));
      boardVolume = x.volume * (1 + waste);
      if (stock.price !== undefined) cost = (boardVolume / (stock.per === 'boardFoot' ? MM3_PER_BOARD_FOOT : MM3_PER_CUBIC_METER)) * stock.price;
    }
    return { materialId, ...x, stock, sheetLayout, boardLayout, boardVolume, cost };
  });
}

/** Board feet in a volume of mm³ (for files in inches or feet). */
export const boardFeet = (mm3: number) => mm3 / MM3_PER_BOARD_FOOT;
