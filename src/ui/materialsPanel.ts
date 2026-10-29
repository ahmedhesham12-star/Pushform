import { STARTER_MATERIALS, starterName, type StarterMaterial } from '../commands';
import { t } from '../i18n';
import type { Material, MaterialId, Scene, Texture } from '../scene';
import type { PaintChoice } from '../tools';
import { formatLength, parseLength, type UnitSettings } from '../units';
import { el } from './dom';

export interface MaterialsHost {
  scene(): Scene;
  units(): UnitSettings;
  /** The Paint Bucket's material. */
  current(): PaintChoice;
  /** Make a material the Paint Bucket's, and pick the Paint Bucket. */
  choose(choice: PaintChoice): void;
  add(): void;
  rename(id: MaterialId, name: string): void;
  setColor(id: MaterialId, color: string): void;
  setTexture(id: MaterialId, texture: Texture | null): void;
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

const STARTERS = Object.keys(STARTER_MATERIALS) as StarterMaterial[];
const same = (a: PaintChoice, b: PaintChoice) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Materials, as SketchUp's Materials panel: Default (no paint) and the
 * model's own materials ("In Model"), then the starter set not yet in it.
 * Clicking a swatch makes it the Paint Bucket's material and picks the
 * Paint Bucket. Below, the chosen model material can be renamed, recolored,
 * given an image with its tile size, duplicated or deleted.
 */
export class MaterialsPanel {
  readonly element = el('section', 'materials');
  private readonly inModel = el('div', 'materials-swatches');
  private readonly starters = el('div', 'materials-swatches');
  private readonly editor = el('div', 'materials-editor');
  private shown: { materials: Scene['materials'] | null; current: string; unit: string } = { materials: null, current: '', unit: '' };

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

  /** Redraw when the materials, the current material or the units changed, unless a field is being edited. */
  sync(): void {
    if (this.element.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement) return;
    const materials = this.host.scene().materials;
    const current = JSON.stringify(this.host.current());
    const unit = JSON.stringify(this.host.units());
    if (materials === this.shown.materials && current === this.shown.current && unit === this.shown.unit) return;
    this.shown = { materials, current, unit };
    this.render(materials);
  }

  private render(materials: Scene['materials']): void {
    const current = this.host.current();
    this.inModel.replaceChildren(this.swatch({ materialId: null }, t('materials.default'), null, current));
    for (const [id, m] of materials) this.inModel.append(this.swatch({ materialId: id }, m.name, m, current));
    const names = new Set([...materials.values()].map((m) => m.name));
    this.starters.replaceChildren(
      ...STARTERS.filter((k) => !names.has(starterName(k))).map((k) => this.swatch({ starter: k }, starterName(k), { name: starterName(k), color: STARTER_MATERIALS[k].color }, current)),
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
