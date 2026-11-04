import type { CutListSettings } from '../commands';
import { boardFeet, cutList, warningText, type CutList, type CutListRow, type MaterialTotal } from '../cutlist';
import { localeTag, t, tCount, type MessageKey } from '../i18n';
import type { InstanceId, MaterialId, Scene } from '../scene';
import { formatArea, formatLength, formatNumber, isImperial, type UnitSettings } from '../units';
import { DiagramsView } from './diagrams';
import { el } from './dom';

export interface CutListHost {
  scene(): Scene;
  units(): UnitSettings;
  settings(): CutListSettings;
  setSettings(patch: Partial<CutListSettings>): void;
  /** Select and show the parts of a row. */
  select(paths: readonly (readonly InstanceId[])[]): void;
  /** Open a material in the Materials panel (to fix its stock thickness). */
  showMaterial(id: MaterialId): void;
  exportCsv(): void;
  close(): void;
  /** Say something in the status bar (a setting that could not be read). */
  flash(message: string, isError?: boolean): void;
}

type View = 'parts' | 'diagrams';
type Column = 'number' | 'name' | 'quantity' | 'length' | 'width' | 'thickness' | 'material' | 'grain';
const COLUMNS: readonly { id: Column; label: MessageKey; numeric?: true }[] = [
  { id: 'number', label: 'cutlist.number', numeric: true },
  { id: 'name', label: 'cutlist.part' },
  { id: 'quantity', label: 'cutlist.quantity', numeric: true },
  { id: 'length', label: 'cutlist.length', numeric: true },
  { id: 'width', label: 'cutlist.width', numeric: true },
  { id: 'thickness', label: 'cutlist.thickness', numeric: true },
  { id: 'material', label: 'cutlist.material' },
  { id: 'grain', label: 'cutlist.grain' },
];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The cut list, over the view: parts grouped by material, with sortable
 * columns (number, name, quantity, length, width, thickness, material,
 * grain), warnings, and per material the area, the sheets or boards its
 * layout uses, board volume with the waste, and cost. A click on a row
 * selects its parts. The settings
 * (waste, currency, hidden parts) are saved in the file. CSV and Print.
 * The Diagrams view (milestone 6) shows the cutting diagrams instead; Print
 * prints the view shown.
 */
export class CutListPanel {
  readonly element = el('section', 'cutlist');
  private readonly body = el('div', 'cutlist-body');
  private readonly waste = el('input');
  private readonly currency = el('input');
  private readonly hidden = el('input');
  private readonly diagrams: DiagramsView;
  private readonly settings = el('div', 'cutlist-settings cutlist-controls');
  private readonly tabs = new Map<View, HTMLButtonElement>();
  private view: View = 'parts';
  private sort: { column: Column; descending: boolean } = { column: 'name', descending: false };
  private shown: { scene: Scene | null; key: string } = { scene: null, key: '' };

  constructor(private readonly host: CutListHost) {
    const heading = el('h2', undefined, t('panel.cutList'));
    heading.id = 'cutlist-heading';
    this.element.setAttribute('aria-labelledby', heading.id);
    this.element.hidden = true;
    const head = el('div', 'cutlist-head');
    const buttons = el('div', 'cutlist-buttons cutlist-controls');
    for (const [label, run] of [
      [t('cutlist.exportCsv'), () => this.host.exportCsv()],
      [t('cutlist.print'), () => this.print()],
      [t('cutlist.close'), () => this.host.close()],
    ] as const) {
      const b = el('button', 'materials-action', label);
      b.type = 'button';
      b.addEventListener('click', run);
      buttons.append(b);
    }
    const tabs = el('div', 'cutlist-tabs cutlist-controls');
    tabs.setAttribute('role', 'tablist');
    for (const [view, label] of [
      ['parts', t('cutlist.view.parts')],
      ['diagrams', t('cutlist.view.diagrams')],
    ] as const) {
      const b = el('button', 'cutlist-tab', label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => this.setView(view));
      this.tabs.set(view, b);
      tabs.append(b);
    }
    head.append(heading, tabs, buttons);

    const settings = this.settings;
    const field = (label: string, input: HTMLInputElement) => {
      const l = el('label');
      l.append(el('span', undefined, label), input);
      settings.append(l);
    };
    this.waste.inputMode = 'decimal';
    this.waste.size = 4;
    this.waste.addEventListener('change', () => {
      const n = Number(this.waste.value.replace(',', '.').replace('%', '').trim());
      if (!Number.isFinite(n) || n < 0 || n > 900) {
        this.waste.value = formatNumber(this.host.settings().waste * 100, 0);
        return this.host.flash(t('error.typeWaste'), true);
      }
      this.host.setSettings({ waste: n / 100 });
    });
    field(t('cutlist.waste'), this.waste);
    this.currency.size = 4;
    this.currency.maxLength = 3;
    this.currency.placeholder = t('cutlist.currencyNone');
    this.currency.addEventListener('change', () => {
      const v = this.currency.value.trim().toUpperCase();
      if (v && !/^[A-Z]{3}$/.test(v)) {
        this.currency.value = this.host.settings().currency ?? '';
        return this.host.flash(t('error.typeCurrency'), true);
      }
      this.host.setSettings({ currency: v || null });
    });
    field(t('cutlist.currency'), this.currency);
    this.hidden.type = 'checkbox';
    this.hidden.addEventListener('change', () => this.host.setSettings({ includeHidden: this.hidden.checked }));
    const h = el('label', 'cutlist-check');
    h.append(this.hidden, el('span', undefined, t('cutlist.includeHidden')));
    settings.append(h);
    this.diagrams = new DiagramsView(host);
    this.element.append(head, settings, this.diagrams.controls, this.body, this.diagrams.body);
    this.setView('parts');
  }

  /** Show the parts list or the cutting diagrams. */
  setView(view: View): void {
    this.view = view;
    for (const [v, b] of this.tabs) b.setAttribute('aria-selected', String(v === view));
    this.body.hidden = view !== 'parts';
    this.diagrams.controls.hidden = this.diagrams.body.hidden = view !== 'diagrams';
    this.sync();
  }

  get open(): boolean {
    return !this.element.hidden;
  }

  setOpen(on: boolean): void {
    this.element.hidden = !on;
    if (on) this.sync();
  }

  /** Recompute and redraw when the scene, the settings or the units changed (only while open). */
  sync(): void {
    if (!this.open) return;
    const scene = this.host.scene();
    const settings = this.host.settings();
    const key = JSON.stringify([settings, this.host.units(), this.sort, this.view]);
    if (scene === this.shown.scene && key === this.shown.key) return;
    this.shown = { scene, key };
    if (document.activeElement !== this.waste) this.waste.value = formatNumber(settings.waste * 100, 0);
    if (document.activeElement !== this.currency) this.currency.value = settings.currency ?? '';
    this.hidden.checked = settings.includeHidden;
    const list = cutList(scene, settings);
    if (this.view === 'diagrams') this.diagrams.render(scene, list);
    else this.render(scene, list);
  }

  private render(scene: Scene, list: CutList): void {
    const units = this.host.units();
    const length = (mm: number) => formatLength(mm, units);
    const materialName = (id: string | null) => (id ? scene.materials.get(id)!.name : t('cutlist.noMaterial'));
    this.body.replaceChildren();
    if (!list.rows.length) {
      this.body.append(el('p', 'cutlist-empty', t('cutlist.empty')));
    } else {
      const table = el('table');
      const head = el('tr');
      for (const c of COLUMNS) {
        const th = el('th');
        th.scope = 'col';
        const b = el('button', 'cutlist-sort', t(c.label));
        b.type = 'button';
        const active = this.sort.column === c.id;
        th.setAttribute('aria-sort', active ? (this.sort.descending ? 'descending' : 'ascending') : 'none');
        b.addEventListener('click', () => {
          this.sort = { column: c.id, descending: active ? !this.sort.descending : false };
          this.sync();
        });
        th.append(b);
        if (c.numeric) th.classList.add('numeric');
        head.append(th);
      }
      const warnings = el('th', 'cutlist-plain', t('cutlist.warnings'));
      warnings.scope = 'col';
      head.append(warnings);
      const thead = el('thead');
      thead.append(head);
      table.append(thead);
      for (const total of list.totals) {
        const tbody = el('tbody');
        const group = el('tr', 'cutlist-group');
        const th = el('th', undefined, materialName(total.materialId));
        th.scope = 'rowgroup';
        th.colSpan = COLUMNS.length + 1;
        group.append(th);
        tbody.append(group);
        for (const r of this.sorted(list.rows.filter((x) => x.materialId === total.materialId), materialName)) {
          const tr = el('tr', 'cutlist-row');
          tr.tabIndex = 0;
          const cells = [formatNumber(r.number), r.name, formatNumber(r.quantity), length(r.length), length(r.width), length(r.thickness), materialName(r.materialId), r.grain ? t(`cutlist.grain.${r.grain}` as MessageKey) : ''];
          cells.forEach((text, i) => {
            const td = el('td', COLUMNS[i]!.numeric ? 'numeric' : undefined);
            const materialId = r.materialId;
            // With a thickness off its stock, the material name opens it, to fix the stock's thickness.
            if (COLUMNS[i]!.id === 'material' && materialId && r.warnings.includes('thickness')) {
              const b = el('button', 'cutlist-material', text);
              b.type = 'button';
              b.title = t('cutlist.editMaterial', { name: text });
              b.addEventListener('click', (e) => {
                e.stopPropagation();
                this.host.showMaterial(materialId);
              });
              b.addEventListener('keydown', (e) => e.stopPropagation());
              td.append(b);
            } else td.textContent = text;
            tr.append(td);
          });
          const w = el('td', r.warnings.length ? 'cutlist-warning' : undefined, warningText(r, scene, units));
          tr.append(w);
          tr.addEventListener('click', () => this.host.select(r.paths));
          tr.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              this.host.select(r.paths);
            }
          });
          tbody.append(tr);
        }
        const sum = el('tr', 'cutlist-total');
        const td = el('td', undefined, this.totalText(total, units));
        td.colSpan = COLUMNS.length + 1;
        sum.append(td);
        tbody.append(sum);
        table.append(tbody);
      }
      this.body.append(table);
      const cost = list.totals.reduce<number | null>((s, x) => (x.cost === null ? s : (s ?? 0) + x.cost), null);
      if (cost !== null) this.body.append(el('p', 'cutlist-grand', t('cutlist.totalCost', { cost: this.money(cost) })));
    }
    if (list.rows.some((r) => r.warnings.includes('severalBoards'))) this.body.append(el('p', 'cutlist-note cutlist-tip', t('cutlist.tip.severalBoards')));
    if (list.hiddenLeftOut) this.body.append(el('p', 'cutlist-note', tCount('cutlist.hiddenLeftOut', list.hiddenLeftOut, formatNumber(list.hiddenLeftOut))));
    for (const a of list.looseInAssemblies) this.body.append(el('p', 'cutlist-note cutlist-warning', t('cutlist.looseInAssembly', { name: a.name })));
  }

  /** Rows of one material in the chosen order (by name, then length, when values tie). */
  private sorted(rows: readonly CutListRow[], materialName: (id: string | null) => string): CutListRow[] {
    const { column, descending } = this.sort;
    const value = (r: CutListRow): string | number =>
      column === 'name' ? r.name : column === 'material' ? materialName(r.materialId) : column === 'grain' ? (r.grain ?? '') : r[column];
    return [...rows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
      return (descending ? -c : c) || collator.compare(a.name, b.name) || b.length - a.length;
    });
  }

  /** "12 parts · 1.88 m² · 1 sheet (63% used) · 58.00": what a material needs, with the sheets or boards its layout uses. */
  private totalText(total: MaterialTotal, units: UnitSettings): string {
    const parts = [tCount('cutlist.parts', total.quantity, formatNumber(total.quantity))];
    // Sheet areas read best in m² (ft² for imperial files), whatever the length unit.
    if (total.stock?.kind !== 'solid') parts.push(formatArea(total.area, isImperial(units.unit) ? { unit: 'ft-in', precision: units.precision } : { unit: 'm', precision: 2 }));
    const percent = (f: number) => formatNumber(f * 100, 0);
    const sheets = total.sheetLayout;
    if (sheets) parts.push(tCount('cutlist.sheets', sheets.sheets.length, formatNumber(sheets.sheets.length), { used: percent(sheets.utilization) }));
    const boards = total.boardLayout;
    if (boards) parts.push(tCount('cutlist.boards', boards.boards.length, formatNumber(boards.boards.length), { used: percent(boards.utilization) }));
    if (total.boardVolume !== null) {
      parts.push(
        isImperial(units.unit)
          ? t('cutlist.boardFeet', { value: formatNumber(boardFeet(total.boardVolume), 2) })
          : t('cutlist.cubicMeters', { value: formatNumber(total.boardVolume / 1e9, 4) }),
      );
    }
    if (total.cost !== null) parts.push(this.money(total.cost));
    const tooLarge = (sheets?.tooLarge.length ?? 0) + (boards?.tooLarge.length ?? 0);
    if (tooLarge) parts.push(tCount('cutlist.tooLarge', tooLarge, formatNumber(tooLarge)));
    return parts.join(t('cutlist.separator'));
  }

  /** A cost in the file's currency, or a plain number with two decimals when it has none. */
  private money(value: number): string {
    const currency = this.host.settings().currency;
    if (!currency) return formatNumber(value, 2);
    try {
      return new Intl.NumberFormat(localeTag(), { style: 'currency', currency }).format(value);
    } catch {
      return `${formatNumber(value, 2)} ${currency}`;
    }
  }

  /**
   * The browser's print of the view shown (print to PDF makes a PDF): a copy
   * of it in a page of its own, so it runs over as many pages as it needs,
   * each diagram on a landscape page.
   */
  private print(): void {
    const root = el('div', `print-root print-${this.view}`);
    root.append(el('h1', undefined, t(this.view === 'parts' ? 'panel.cutList' : 'diagrams.title')), (this.view === 'parts' ? this.body : this.diagrams.body).cloneNode(true));
    document.body.append(root);
    document.body.classList.add('printing');
    const done = () => {
      document.body.classList.remove('printing');
      root.remove();
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  }
}
