import { STARTER_MATERIALS, starterName, type StarterMaterial } from '../commands';
import { t } from '../i18n';
import type { Material, MaterialId, Scene, Stock, Texture } from '../scene';
import type { PaintChoice } from '../tools';
import { formatLength, formatNumber, parseLength, type UnitSettings } from '../units';
import { el } from './dom';

export interface MaterialsHost {
  scene(): Scene;
  units(): UnitSettings;
  /** The starter materials the file's workspace offers. */
  starters(): readonly StarterMaterial[];
  /** Whether materials show what they are bought as (the Woodworking workspace). */
  stock(): boolean;
  /** The Paint Bucket's material. */
  current(): PaintChoice;
  /** Make a material the Paint Bucket's, and pick the Paint Bucket. */
  choose(choice: PaintChoice): void;
  add(): void;
  rename(id: MaterialId, name: string): void;
  setColor(id: MaterialId, color: string): void;
  setTexture(id: MaterialId, texture: Texture | null): void;
  /** What the material is bought as, for the cut list; null for paint only. */
  setStock(id: MaterialId, stock: Stock | null): void;
  duplicate(id: MaterialId): void;
  remove(id: MaterialId): void;
  /** Say something in the status bar (an image that could not be read). */
  flash(message: string, isError?: boolean): void;
}

const PLUS = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 2v10M2 7h10"/></svg>';
/** Images larger than this (px, longest side) are scaled down before they go in the file. */
export const MAX_TEXTURE_SIZE = 2048;
/** How wide one tile of a new texture is, in mm; its height follows the image. */
const DEFAULT_TILE = 600;

const same = (a: PaintChoice, b: PaintChoice) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Materials, as SketchUp's Materials panel: Default (no paint) and the
 * model's own materials ("In Model"), then the workspace's starter set not
 * yet in it. Clicking a swatch makes it the Paint Bucket's material and
 * picks the Paint Bucket. Below, the chosen model material can be renamed,
 * recolored, given an image with its tile size, duplicated or deleted, and
 * in the Woodworking workspace given its stock.
 */
export class MaterialsPanel {
  readonly element = el('section', 'materials');
  private readonly inModel = el('div', 'materials-swatches');
  private readonly starters = el('div', 'materials-swatches');
  private readonly editor = el('div', 'materials-editor');
  private shown: { materials: Scene['materials'] | null; current: string; unit: string; offer: string } = { materials: null, current: '', unit: '', offer: '' };

  constructor(private readonly host: MaterialsHost) {
    const heading = el('h2', undefined, t('panel.materials'));
    heading.id = 'materials-heading';
    this.element.setAttribute('aria-labelledby', heading.id);
    const bar = el('div', 'materials-bar');
    const add = el('button', 'icon-button materials-add');
    add.type = 'button';
    add.innerHTML = PLUS;
    add.setAttribute('aria-label', t('materials.add'));
    add.title = t('materials.add');
    add.addEventListener('click', () => this.host.add());
    bar.append(add, el('span', 'materials-current'));
    this.element.append(heading, bar, el('h3', undefined, t('materials.inModel')), this.inModel, this.editor, el('h3', undefined, t('materials.starters')), this.starters);
  }

  /** Put the cursor in the chosen material's thickness field, when it has stock. */
  focusThickness(): void {
    this.sync();
    const label = [...this.editor.querySelectorAll('.materials-field')].find((f) => f.firstChild?.textContent === t('materials.thickness'));
    const input = label?.querySelector('input');
    input?.focus();
    input?.select();
  }

  /** Redraw when the materials, the current material or the units changed, unless a field is being edited. */
  sync(): void {
    if (this.element.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement) return;
    const materials = this.host.scene().materials;
    const current = JSON.stringify(this.host.current());
    const unit = JSON.stringify(this.host.units());
    const offer = JSON.stringify([this.host.starters(), this.host.stock()]);
    if (materials === this.shown.materials && current === this.shown.current && unit === this.shown.unit && offer === this.shown.offer) return;
    this.shown = { materials, current, unit, offer };
    this.render(materials);
  }

  private render(materials: Scene['materials']): void {
    const current = this.host.current();
    this.inModel.replaceChildren(this.swatch({ materialId: null }, t('materials.default'), null, current));
    for (const [id, m] of materials) this.inModel.append(this.swatch({ materialId: id }, m.name, m, current));
    const names = new Set([...materials.values()].map((m) => m.name));
    this.starters.replaceChildren(
      ...this.host
        .starters()
        .filter((k) => !names.has(starterName(k)))
        .map((k) => this.swatch({ starter: k }, starterName(k), { name: starterName(k), color: STARTER_MATERIALS[k]!.color }, current)),
    );
    const chosen = 'materialId' in current && current.materialId !== null ? materials.get(current.materialId) : undefined;
    const name = chosen ? chosen.name : 'starter' in current ? starterName(current.starter) : t('materials.default');
    this.element.querySelector('.materials-current')!.textContent = t('materials.current', { name });
    this.editor.replaceChildren();
    if (chosen && 'materialId' in current && current.materialId) this.edit(current.materialId, chosen);
  }

  private swatch(choice: PaintChoice, name: string, m: Material | null, current: PaintChoice): HTMLButtonElement {
    const b = el('button', 'materials-swatch');
    b.type = 'button';
    b.title = name;
    b.setAttribute('aria-label', name);
    b.setAttribute('aria-pressed', String(same(choice, current)));
    const chip = el('span', 'materials-chip');
    if (!m) chip.classList.add('materials-default');
    else if (m.texture) chip.style.backgroundImage = `url("data:${m.texture.mime};base64,${m.texture.data}")`;
    else chip.style.backgroundColor = m.color;
    b.append(chip, el('span', 'materials-name', name));
    b.addEventListener('click', () => this.host.choose(choice));
    return b;
  }

  /** Fields for the chosen model material. */
  private edit(id: MaterialId, m: Material): void {
    const field = (label: string, input: HTMLElement) => {
      const row = el('label', 'materials-field');
      row.append(el('span', undefined, label), input);
      this.editor.append(row);
    };
    const name = el('input');
    name.value = m.name;
    name.spellcheck = false;
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (v && v !== m.name) this.host.rename(id, v);
      else name.value = m.name;
    });
    field(t('materials.name'), name);
    const color = el('input');
    color.type = 'color';
    color.value = m.color;
    color.addEventListener('change', () => this.host.setColor(id, color.value));
    field(t('materials.color'), color);

    const file = el('input');
    file.type = 'file';
    file.accept = 'image/png,image/jpeg';
    file.hidden = true;
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (f) void this.loadImage(id, f);
    });
    const image = el('button', 'materials-action', t(m.texture ? 'materials.replaceImage' : 'materials.addImage'));
    image.type = 'button';
    image.addEventListener('click', () => file.click());
    this.editor.append(file);
    const actions = el('div', 'materials-actions');
    actions.append(image);
    if (m.texture) {
      const remove = el('button', 'materials-action', t('materials.removeImage'));
      remove.type = 'button';
      remove.addEventListener('click', () => this.host.setTexture(id, null));
      actions.append(remove);
    }
    this.editor.append(actions);
    if (m.texture) {
      const tex = m.texture;
      const units = this.host.units();
      const tile = el('input');
      tile.value = formatLength(tex.width, units);
      tile.spellcheck = false;
      tile.addEventListener('change', () => {
        const r = parseLength(tile.value, units.unit);
        if (!r.ok || r.mm <= 0) {
          tile.value = formatLength(tex.width, units);
          return this.host.flash(t('error.typeTileSize'), true);
        }
        // The height follows, so the image keeps its proportions.
        this.host.setTexture(id, { ...tex, width: r.mm, height: (r.mm * tex.height) / tex.width });
      });
      field(t('materials.tileWidth'), tile);
    }
    if (this.host.stock()) this.stockFields(id, m.stock);
    const more = el('div', 'materials-actions');
    for (const [label, run] of [
      [t('materials.duplicate'), () => this.host.duplicate(id)],
      [t('materials.delete'), () => this.host.remove(id)],
    ] as const) {
      const b = el('button', 'materials-action', label);
      b.type = 'button';
      b.addEventListener('click', run);
      more.append(b);
    }
    this.editor.append(more);
  }

  /**
   * What the material is bought as: none (paint only), sheet goods, solid
   * wood or edge band, with a thickness (common ones suggested), the sheet
   * size or band width, a price and whether it has a grain. Every change sets
   * the whole stock.
   */
  private stockFields(id: MaterialId, stock: Stock | undefined): void {
    const units = this.host.units();
    const length = (mm: number) => formatLength(mm, units);
    const row = (label: string, input: HTMLElement) => {
      const r = el('label', 'materials-field');
      r.append(el('span', undefined, label), input);
      this.editor.append(r);
    };
    const kind = el('select');
    for (const [value, key] of [
      ['none', 'materials.stockNone'],
      ['sheet', 'materials.stockSheet'],
      ['solid', 'materials.stockSolid'],
      ['band', 'materials.stockBand'],
    ] as const) {
      const o = el('option', undefined, t(key));
      o.value = value;
      kind.append(o);
    }
    kind.value = stock?.kind ?? 'none';
    kind.addEventListener('change', () => {
      const imperial = units.unit === 'in' || units.unit === 'in-frac' || units.unit === 'ft-in';
      // A board's thickness carries over between sheet goods and solid wood; a band's is far thinner.
      const board = stock && stock.kind !== 'band' ? stock : undefined;
      if (kind.value === 'sheet') this.host.setStock(id, { kind: 'sheet', thickness: board?.thickness ?? 18, length: 2440, width: 1220, grain: board?.grain ?? false });
      else if (kind.value === 'solid') this.host.setStock(id, { kind: 'solid', thickness: board?.thickness ?? 18, length: 2400, per: imperial ? 'boardFoot' : 'cubicMeter', grain: true });
      else if (kind.value === 'band') this.host.setStock(id, { kind: 'band', thickness: 1, width: 22 });
      else this.host.setStock(id, null);
    });
    row(t('materials.stock'), kind);
    if (!stock) return;
    /** A length field: typed in the file's units, set when it reads as a positive length. */
    const lengthField = (label: string, value: number, set: (mm: number) => Stock, list?: string) => {
      const input = el('input');
      input.value = length(value);
      input.spellcheck = false;
      if (list) input.setAttribute('list', list);
      input.addEventListener('change', () => {
        const r = parseLength(input.value, units.unit);
        if (!r.ok || r.mm <= 0) {
          input.value = length(value);
          return this.host.flash(t('error.typeLength'), true);
        }
        this.host.setStock(id, set(r.mm));
      });
      row(label, input);
    };
    // Common sheet thicknesses: 12, 15, 18 and 25 mm, 1/2" and 3/4"; and band thicknesses.
    const list = el('datalist');
    list.id = `materials-thicknesses-${id}`;
    for (const mm of stock.kind === 'band' ? [0.4, 0.6, 1, 2] : [12, 15, 18, 25, 12.7, 19.05]) {
      const o = el('option');
      o.value = mm === 12.7 ? '1/2"' : mm === 19.05 ? '3/4"' : `${mm}mm`;
      list.append(o);
    }
    this.editor.append(list);
    lengthField(t('materials.thickness'), stock.thickness, (mm) => ({ ...stock, thickness: mm }), list.id);
    if (stock.kind === 'sheet') {
      lengthField(t('materials.sheetLength'), stock.length, (mm) => ({ ...stock, length: mm }));
      lengthField(t('materials.sheetWidth'), stock.width, (mm) => ({ ...stock, width: mm }));
    } else if (stock.kind === 'band') {
      lengthField(t('materials.bandWidth'), stock.width, (mm) => ({ ...stock, width: mm }));
    } else {
      // The board length for the cutting diagrams; empty leaves solid wood out of them.
      const board = el('input');
      const shown = () => (stock.length === undefined ? '' : length(stock.length));
      board.value = shown();
      board.placeholder = t('materials.boardLengthNone');
      board.spellcheck = false;
      board.addEventListener('change', () => {
        const { length: _old, ...rest } = stock;
        if (!board.value.trim()) return this.host.setStock(id, rest);
        const r = parseLength(board.value, units.unit);
        if (!r.ok || r.mm <= 0) {
          board.value = shown();
          return this.host.flash(t('error.typeLength'), true);
        }
        this.host.setStock(id, { ...rest, length: r.mm });
      });
      row(t('materials.boardLength'), board);
    }
    const price = el('input');
    price.inputMode = 'decimal';
    price.value = stock.price === undefined ? '' : formatNumber(stock.price, 2);
    price.addEventListener('change', () => {
      const text = price.value.trim();
      const { price: _old, ...rest } = stock;
      if (!text) return this.host.setStock(id, rest);
      const n = Number(text.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) {
        price.value = stock.price === undefined ? '' : formatNumber(stock.price, 2);
        return this.host.flash(t('error.typePrice'), true);
      }
      this.host.setStock(id, { ...rest, price: n });
    });
    row(t(stock.kind === 'sheet' ? 'materials.pricePerSheet' : stock.kind === 'band' ? 'materials.pricePerMeter' : 'materials.price'), price);
    if (stock.kind === 'solid') {
      const per = el('select');
      for (const [value, key] of [
        ['cubicMeter', 'materials.perCubicMeter'],
        ['boardFoot', 'materials.perBoardFoot'],
      ] as const) {
        const o = el('option', undefined, t(key));
        o.value = value;
        per.append(o);
      }
      per.value = stock.per;
      per.addEventListener('change', () => this.host.setStock(id, { ...stock, per: per.value as 'boardFoot' | 'cubicMeter' }));
      row(t('materials.pricePer'), per);
    }
    if (stock.kind === 'band') return;
    const grain = el('input');
    grain.type = 'checkbox';
    grain.checked = stock.grain;
    grain.addEventListener('change', () => this.host.setStock(id, { ...stock, grain: grain.checked }));
    const g = el('label', 'materials-check');
    g.append(grain, el('span', undefined, t('materials.grain')));
    this.editor.append(g);
  }

  /** Read an image, scale it down past MAX_TEXTURE_SIZE, and set it on a material with a tile DEFAULT_TILE wide. */
  private async loadImage(id: MaterialId, file: File): Promise<void> {
    const mime = file.type === 'image/jpeg' ? 'image/jpeg' : file.type === 'image/png' ? 'image/png' : null;
    if (!mime) return this.host.flash(t('error.imageType'), true);
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image'));
        img.src = url;
      });
      const { naturalWidth: w, naturalHeight: h } = image;
      let data = url.slice(url.indexOf(',') + 1);
      const k = MAX_TEXTURE_SIZE / Math.max(w, h);
      if (k < 1) {
        const canvas = el('canvas');
        canvas.width = Math.round(w * k);
        canvas.height = Math.round(h * k);
        canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
        const scaled = canvas.toDataURL(mime, 0.9);
        data = scaled.slice(scaled.indexOf(',') + 1);
      }
      this.host.setTexture(id, { data, mime, width: DEFAULT_TILE, height: (DEFAULT_TILE * h) / w });
    } catch {
      this.host.flash(t('error.imageUnreadable'), true);
    }
  }
}
