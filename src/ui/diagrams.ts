import type { CutListSettings } from '../commands';
import { placedSize, type BoardLayout, type CutList, type CutListRow, type MaterialTotal, type SheetLayout } from '../cutlist';
import { localeTag, t, tCount } from '../i18n';
import type { Scene } from '../scene';
import { formatLength, formatNumber, parseLength, type UnitSettings } from '../units';
import { el } from './dom';

export interface DiagramsHost {
  units(): UnitSettings;
  settings(): CutListSettings;
  setSettings(patch: Partial<CutListSettings>): void;
  flash(message: string, isError?: boolean): void;
}

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The largest each diagram setting may be, in mm (as the command accepts). */
const LIMITS = { kerf: 50, trim: 200, minOffcut: 999 } as const;
/** Boards have no width in their layout; they are drawn this deep (mm) to be seen. */
const BOARD_DEPTH = 140;
/**
 * How large a drawing shows on screen, in pixels: a sheet's height (as in the
 * stylesheet) and about a board's width. Text is sized to read at that scale,
 * in pixels; printed, the drawings are larger, and so is the text.
 */
const SHEET_PX = 280;
const BOARD_PX = 900;
const NUMBER_PX = 15;
const SIZE_PX = 11;

const percent = (fraction: number) => formatNumber(fraction * 100, 0);

/**
 * The Diagrams view of the Cut List panel (milestone 6): the settings of the
 * cutting diagrams, then per material its sheets (or boards) drawn to scale,
 * each part with its cut list number and size, the leftovers kept as offcuts,
 * the use of each sheet, and the parts that do not fit. Each sheet is its own
 * page when printed.
 */
export class DiagramsView {
  readonly controls = el('div', 'cutlist-settings cutlist-controls diagrams-settings');
  readonly body = el('div', 'diagrams');
  private readonly fields: Record<keyof typeof LIMITS, HTMLInputElement> = { kerf: el('input'), trim: el('input'), minOffcut: el('input') };
  private readonly guillotine = el('input');
  private readonly firstCut = el('select');

  constructor(private readonly host: DiagramsHost) {
    const labels: Record<keyof typeof LIMITS, string> = { kerf: t('diagrams.kerf'), trim: t('diagrams.trim'), minOffcut: t('diagrams.minOffcut') };
    for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
      const input = this.fields[key];
      input.size = 6;
      input.spellcheck = false;
      input.addEventListener('change', () => this.setLength(key));
      const l = el('label');
      l.append(el('span', undefined, labels[key]), input);
      this.controls.append(l);
    }
    this.guillotine.type = 'checkbox';
    this.guillotine.addEventListener('change', () => this.host.setSettings({ guillotine: this.guillotine.checked }));
    const g = el('label', 'cutlist-check');
    g.append(this.guillotine, el('span', undefined, t('diagrams.guillotine')));
    this.controls.append(g);
    for (const value of ['best', 'length', 'width'] as const) {
      const o = el('option', undefined, t(`diagrams.firstCut.${value}`));
      o.value = value;
      this.firstCut.append(o);
    }
    this.firstCut.addEventListener('change', () => this.host.setSettings({ firstCut: this.firstCut.value as CutListSettings['firstCut'] }));
    const f = el('label');
    f.append(el('span', undefined, t('diagrams.firstCut')), this.firstCut);
    this.controls.append(f);
  }

  private setLength(key: keyof typeof LIMITS): void {
    const units = this.host.units();
    const input = this.fields[key];
    const r = parseLength(input.value, units.unit);
    if (!r.ok || r.mm < 0 || r.mm > LIMITS[key]) {
      input.value = formatLength(this.host.settings()[key], units);
      return this.host.flash(t('error.typeDiagramLength', { max: formatLength(LIMITS[key], units) }), true);
    }
    this.host.setSettings({ [key]: r.mm });
  }

  /** Show the settings and draw every material's layout. */
  render(scene: Scene, list: CutList): void {
    const units = this.host.units();
    const settings = this.host.settings();
    for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[])
      if (document.activeElement !== this.fields[key]) this.fields[key].value = formatLength(settings[key], units);
    this.guillotine.checked = settings.guillotine;
    this.firstCut.value = settings.firstCut;
    this.firstCut.disabled = !settings.guillotine;

    this.body.replaceChildren();
    const rows = new Map(list.rows.map((r) => [r.number, r]));
    const laidOut = list.totals.filter((x) => x.sheetLayout || x.boardLayout);
    for (const total of laidOut) this.body.append(this.material(scene, total, rows, units));
    const left = list.totals.filter((x) => !x.sheetLayout && !x.boardLayout);
    const name = (x: MaterialTotal) => (x.materialId ? scene.materials.get(x.materialId)!.name : t('cutlist.noMaterial'));
    if (!laidOut.length) this.body.append(el('p', 'cutlist-empty', t(list.rows.length ? 'diagrams.none' : 'cutlist.empty')));
    if (left.length && list.rows.length) this.body.append(el('p', 'cutlist-note', t('diagrams.notLaidOut', { materials: new Intl.ListFormat(localeTag()).format(left.map(name)) })));
  }

  private material(scene: Scene, total: MaterialTotal, rows: ReadonlyMap<number, CutListRow>, units: UnitSettings): HTMLElement {
    const material = scene.materials.get(total.materialId!)!;
    const stock = material.stock!;
    const length = (mm: number) => formatLength(mm, units);
    const section = el('section', 'diagrams-material');
    section.append(el('h3', undefined, material.name));
    const sheets = total.sheetLayout;
    const boards = total.boardLayout;
    const summary =
      stock.kind === 'sheet'
        ? [t('diagrams.sheetStock', { thickness: length(stock.thickness), length: length(stock.length), width: length(stock.width) })]
        : [t('diagrams.boardStock', { thickness: length(stock.thickness), length: length(stock.length!) })];
    if (sheets) summary.push(tCount('cutlist.sheets', sheets.sheets.length, formatNumber(sheets.sheets.length), { used: percent(sheets.utilization) }));
    if (boards) summary.push(tCount('cutlist.boards', boards.boards.length, formatNumber(boards.boards.length), { used: percent(boards.utilization) }));
    if (stock.grain && stock.kind === 'sheet') summary.push(t('diagrams.grain'));
    section.append(el('p', 'diagrams-summary', summary.join(t('cutlist.separator'))));

    const tooLarge = (sheets ?? boards)!.tooLarge;
    if (tooLarge.length) {
      const counts = new Map<number, number>();
      for (const p of tooLarge) counts.set(p.number, (counts.get(p.number) ?? 0) + 1);
      const items = [...counts].map(([number, count]) => t('diagrams.partCount', { number: formatNumber(number), name: rows.get(number)?.name ?? '', count: formatNumber(count) }));
      section.append(el('p', 'cutlist-note cutlist-warning', t('diagrams.tooLarge', { parts: new Intl.ListFormat(localeTag()).format(items) })));
    }
    if (sheets) sheets.sheets.forEach((s, i) => section.append(this.sheetPage(material.name, s, i, sheets, stock as { length: number; width: number }, rows, units)));
    if (boards) boards.boards.forEach((b, i) => section.append(this.boardPage(material.name, b, i, boards, stock.length!, rows, units)));
    return section;
  }

  /** One sheet: caption, the drawing, its parts and its offcuts. */
  private sheetPage(
    name: string,
    sheet: SheetLayout['sheets'][number],
    index: number,
    layout: SheetLayout,
    size: { length: number; width: number },
    rows: ReadonlyMap<number, CutListRow>,
    units: UnitSettings,
  ): HTMLElement {
    const caption = t('diagrams.sheetOf', { index: formatNumber(index + 1), count: formatNumber(layout.sheets.length) });
    const page = this.page(name, caption, t('diagrams.used', { used: percent(sheet.utilization) }));
    const trim = this.host.settings().trim;
    const drawing = svg('svg', { viewBox: `0 0 ${size.length} ${size.width}`, class: 'diagram', role: 'img', 'aria-label': `${name}, ${caption}` });
    drawing.append(svg('rect', { x: 0, y: 0, width: size.length, height: size.width, class: 'diagram-stock' }));
    const px = SHEET_PX / size.width;
    if (trim > 0) drawing.append(svg('rect', { x: trim, y: trim, width: size.length - 2 * trim, height: size.width - 2 * trim, class: 'diagram-trim' }));
    for (const o of sheet.offcuts) {
      drawing.append(svg('rect', { x: o.x, y: o.y, width: o.length, height: o.width, class: 'diagram-offcut' }));
      this.dimensions(drawing, o.x, o.y, o.length, o.width, o.length, o.width, px, units, 'diagram-offcut-text');
    }
    for (const p of sheet.pieces) {
      const [w, h] = placedSize(p);
      this.part(drawing, p.number, p.x, p.y, w, h, p.rotated ? [p.width, p.length] : [p.length, p.width], px, units);
    }
    page.append(drawing, this.partsTable(sheet.pieces, rows, units));
    if (sheet.offcuts.length) {
      const sizes = sheet.offcuts.map((o) => t('diagrams.size', { length: formatLength(o.length, units), width: formatLength(o.width, units) }));
      page.append(el('p', 'diagrams-offcuts', t('diagrams.offcuts', { sizes: new Intl.ListFormat(localeTag(), { type: 'unit' }).format(sizes) })));
    }
    return page;
  }

  /** One board: parts end to end, drawn at a fixed depth, and what is left at its end. */
  private boardPage(
    name: string,
    board: BoardLayout['boards'][number],
    index: number,
    layout: BoardLayout,
    length: number,
    rows: ReadonlyMap<number, CutListRow>,
    units: UnitSettings,
  ): HTMLElement {
    const caption = t('diagrams.boardOf', { index: formatNumber(index + 1), count: formatNumber(layout.boards.length) });
    const page = this.page(name, caption, t('diagrams.used', { used: percent(board.utilization) }));
    page.classList.add('diagram-board-page');
    const drawing = svg('svg', { viewBox: `0 0 ${length} ${BOARD_DEPTH}`, class: 'diagram diagram-board', role: 'img', 'aria-label': `${name}, ${caption}` });
    drawing.append(svg('rect', { x: 0, y: 0, width: length, height: BOARD_DEPTH, class: 'diagram-stock' }));
    for (const p of board.pieces) this.part(drawing, p.number, p.x, 0, p.length, BOARD_DEPTH, [p.length, null], BOARD_PX / length, units);
    page.append(drawing, this.partsTable(board.pieces, rows, units));
    if (board.offcut > 0) page.append(el('p', 'diagrams-offcuts', t('diagrams.offcuts', { sizes: formatLength(board.offcut, units) })));
    return page;
  }

  private page(name: string, caption: string, used: string): HTMLElement {
    const page = el('figure', 'diagram-page');
    const head = el('figcaption');
    head.append(el('strong', undefined, name), el('span', undefined, caption), el('span', undefined, used));
    page.append(head);
    return page;
  }

  /**
   * A part: its rectangle, its number in the middle (smaller in a narrow
   * part), and its sizes along the edges where they fit. `px` is the
   * drawing's pixels per mm on screen.
   */
  private part(drawing: SVGSVGElement, number: number, x: number, y: number, w: number, h: number, sizes: [number, number | null], px: number, units: UnitSettings): void {
    const g = svg('g', { class: 'diagram-part' });
    g.append(svg('rect', { x, y, width: w, height: h }));
    const font = Math.min(NUMBER_PX / px, Math.min(w, h) * 0.7);
    g.append(svg('text', { x: x + w / 2, y: y + h / 2, 'font-size': font, class: 'diagram-number' }, formatNumber(number)));
    drawing.append(g);
    this.dimensions(drawing, x, y, w, h, sizes[0], sizes[1], px, units, 'diagram-size');
  }

  /** Sizes written inside a rectangle: the first along its top, the second up its start side, each only where it fits. */
  private dimensions(drawing: SVGSVGElement, x: number, y: number, w: number, h: number, along: number, across: number | null, px: number, units: UnitSettings, cls: string): void {
    const font = SIZE_PX / px;
    // Room for the text and a margin, and across the rectangle for both sizes and the number between them.
    const fits = (text: string, room: number) => text.length * font * 0.6 < room - font && font * 3.2 < Math.min(w, h);
    const a = formatLength(along, units);
    if (fits(a, w)) drawing.append(svg('text', { x: x + w / 2, y: y + font * 1.1, 'font-size': font, class: cls }, a));
    if (across === null) return;
    const b = formatLength(across, units);
    if (fits(b, h)) {
      const cx = x + font * 1.1;
      const cy = y + h / 2;
      drawing.append(svg('text', { x: cx, y: cy, 'font-size': font, class: cls, transform: `rotate(-90 ${cx} ${cy})` }, b));
    }
  }

  /** The parts on one sheet or board: number, name, size, and how many. */
  private partsTable(pieces: readonly { number: number }[], rows: ReadonlyMap<number, CutListRow>, units: UnitSettings): HTMLElement {
    const counts = new Map<number, number>();
    for (const p of pieces) counts.set(p.number, (counts.get(p.number) ?? 0) + 1);
    const table = el('table', 'diagrams-parts');
    const head = el('tr');
    for (const [label, numeric] of [
      [t('cutlist.number'), true],
      [t('cutlist.part'), false],
      [t('cutlist.length'), true],
      [t('cutlist.width'), true],
      [t('cutlist.quantity'), true],
    ] as const) {
      const th = el('th', numeric ? 'numeric' : undefined, label);
      th.scope = 'col';
      head.append(th);
    }
    const thead = el('thead');
    thead.append(head);
    const tbody = el('tbody');
    for (const [number, count] of [...counts].sort((a, b) => a[0] - b[0])) {
      const r = rows.get(number)!;
      const tr = el('tr');
      for (const [text, numeric] of [
        [formatNumber(number), true],
        [r.name, false],
        [formatLength(r.length, units), true],
        [formatLength(r.width, units), true],
        [formatNumber(count), true],
      ] as const)
        tr.append(el('td', numeric ? 'numeric' : undefined, text));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    return table;
  }
}
