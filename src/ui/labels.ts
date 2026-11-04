import type { CutListSettings } from '../commands';
import { LABEL_PRESETS, labelSheet, MAX_LABEL_COLUMNS, MAX_LABEL_ROWS, PAGE_SIZES, partLabels, type CutList, type LabelSettings, type LabelSheet, type PartLabel } from '../cutlist';
import { t, tCount } from '../i18n';
import type { Scene } from '../scene';
import { formatLength, formatNumber, type UnitSettings } from '../units';
import { el } from './dom';
import { edgeMarks } from './edgeMarks';

export interface LabelsHost {
  units(): UnitSettings;
  settings(): CutListSettings;
  /** The label sheet, a setting of the device. */
  labelSettings(): LabelSettings;
  setLabelSettings(settings: LabelSettings): void;
}

const SVG = 'http://www.w3.org/2000/svg';

/** An arrow along the label's length: the part's grain runs this way. */
function grainArrow(): SVGSVGElement {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 36 10');
  s.setAttribute('class', 'label-grain');
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', t('labels.grain'));
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M2 5H33M27 1.5 33 5 27 8.5');
  s.append(path);
  return s;
}

/**
 * The Labels view of the Cut List panel (milestone 6): the label sheet to
 * print on, then the sheets themselves, one label per part placed. Each
 * label: the part number and copy ("3, 2 of 6"), name, assembly, size,
 * material, its banded edges, and a grain arrow along its length. Sheets are
 * laid out in mm, so they print at size.
 */
export class LabelsView {
  readonly controls = el('div', 'cutlist-settings cutlist-controls labels-settings');
  readonly body = el('div', 'labels');
  private readonly preset = el('select');
  private readonly page = el('select');
  private readonly columns = el('input');
  private readonly rows = el('input');
  private readonly custom = el('span', 'labels-custom');

  constructor(private readonly host: LabelsHost) {
    for (const p of LABEL_PRESETS) {
      const o = el('option', undefined, t(`labels.preset.${p}`));
      o.value = p;
      this.preset.append(o);
    }
    this.preset.addEventListener('change', () => this.set({ preset: this.preset.value as LabelSettings['preset'] }));
    const layout = el('label');
    layout.append(el('span', undefined, t('labels.layout')), this.preset);
    for (const p of ['a4', 'letter'] as const) {
      const o = el('option', undefined, t(`labels.page.${p}`));
      o.value = p;
      this.page.append(o);
    }
    this.page.addEventListener('change', () => this.set({ page: this.page.value as LabelSettings['page'] }));
    const page = el('label');
    page.append(el('span', undefined, t('labels.page')), this.page);
    const count = (input: HTMLInputElement, label: string, key: 'columns' | 'rows', max: number) => {
      input.type = 'number';
      input.min = '1';
      input.max = String(max);
      input.addEventListener('change', () => {
        const n = Number(input.value);
        if (Number.isInteger(n) && n >= 1 && n <= max) this.set({ [key]: n });
        else input.value = String(this.host.labelSettings()[key]);
      });
      const l = el('label');
      l.append(el('span', undefined, label), input);
      return l;
    };
    this.custom.append(page, count(this.columns, t('labels.columns'), 'columns', MAX_LABEL_COLUMNS), count(this.rows, t('labels.rows'), 'rows', MAX_LABEL_ROWS));
    this.controls.append(layout, this.custom);
  }

  private set(patch: Partial<LabelSettings>): void {
    this.host.setLabelSettings({ ...this.host.labelSettings(), ...patch });
  }

  render(scene: Scene, list: CutList): void {
    const settings = this.host.labelSettings();
    this.preset.value = settings.preset;
    this.page.value = settings.page;
    this.columns.value = String(settings.columns);
    this.rows.value = String(settings.rows);
    this.custom.hidden = settings.preset !== 'custom';

    this.body.replaceChildren();
    const labels = partLabels(scene, list, { cutSize: this.host.settings().cutSize });
    if (!labels.length) {
      this.body.append(el('p', 'cutlist-empty', t('cutlist.empty')));
      return;
    }
    const sheet = labelSheet(settings);
    const perPage = sheet.columns * sheet.rows;
    const sheets = Math.ceil(labels.length / perPage);
    const count = t('labels.count', { labels: tCount('labels.labelCount', labels.length, formatNumber(labels.length)), sheets: tCount('labels.sheetCount', sheets, formatNumber(sheets)) });
    this.body.append(el('p', 'cutlist-note labels-count', count));
    for (let i = 0; i < labels.length; i += perPage) this.body.append(this.sheetPage(scene, sheet, labels.slice(i, i + perPage)));
  }

  /** One sheet of labels at its real size: a grid of labels inside the sheet's margins. */
  private sheetPage(scene: Scene, sheet: LabelSheet, labels: readonly PartLabel[]): HTMLElement {
    const size = PAGE_SIZES[sheet.page];
    const page = el('div', `label-page label-page-${sheet.page}`);
    const s = page.style;
    s.inlineSize = `${size.width}mm`;
    // A hair under the paper's height, so rounding never spills an empty page after it.
    s.blockSize = `${size.height - 0.2}mm`;
    s.paddingBlockStart = `${sheet.margin.top}mm`;
    s.paddingInlineStart = `${sheet.margin.start}mm`;
    s.gridTemplateColumns = `repeat(${sheet.columns}, ${sheet.label.width}mm)`;
    s.gridAutoRows = `${sheet.label.height}mm`;
    s.columnGap = `${sheet.gap.x}mm`;
    s.rowGap = `${sheet.gap.y}mm`;
    // Text sized to the label: about eight lines fit its height.
    s.setProperty('--label-font', `${Math.min(3.4, sheet.label.height / 8)}mm`);
    for (const l of labels) page.append(this.label(scene, l));
    return page;
  }

  private label(scene: Scene, l: PartLabel): HTMLElement {
    const units = this.host.units();
    const label = el('div', 'part-label');
    const head = el('div', 'label-head');
    head.append(el('span', 'label-number', formatNumber(l.number)), el('span', 'label-copy', t('labels.copy', { copy: formatNumber(l.copy), count: formatNumber(l.count) })));
    label.setAttribute('aria-label', t('labels.number', { number: formatNumber(l.number), copy: formatNumber(l.copy), count: formatNumber(l.count) }));
    const text = el('div', 'label-text');
    text.append(head, el('div', 'label-name', l.name));
    if (l.assembly) text.append(el('div', 'label-line', l.assembly));
    const size = t('labels.size', { length: formatLength(l.length, units), width: formatLength(l.width, units), thickness: formatLength(l.thickness, units) });
    text.append(el('div', 'label-line', l.cutSize ? t('labels.cutSize', { size }) : size));
    text.append(el('div', 'label-line', l.materialId ? (scene.materials.get(l.materialId)?.name ?? '') : t('cutlist.noMaterial')));
    const marks = el('div', 'label-marks');
    marks.append(edgeMarks(l.bands, scene));
    if (l.grain) marks.append(grainArrow());
    label.append(text, marks);
    return label;
  }
}
