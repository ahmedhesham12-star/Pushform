import { t } from '../i18n';
import type { Scene, TagId } from '../scene';
import { el } from './dom';

export interface TagsHost {
  scene(): Scene;
  colorByTag(): boolean;
  add(): void;
  rename(id: TagId, name: string): void;
  setColor(id: TagId, color: string): void;
  setVisible(id: TagId, visible: boolean): void;
  remove(id: TagId): void;
  setColorByTag(on: boolean): void;
}

const EYE =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>';
const EYE_SHUT =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><path d="M2.5 13.5l11-11"/></svg>';
const PLUS = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 2v10M2 7h10"/></svg>';
const CROSS = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Tags, as SketchUp's Tags panel: Untagged first (always shown, never
 * renamed or deleted), then the tags by name. Each row has an eye to show
 * or hide the tag, its color, and its name, which a double-click (or F2)
 * makes editable. "Color by Tag" colors faces by their tag.
 */
export class TagsPanel {
  readonly element = el('section', 'tags');
  private readonly list = el('ul', 'tags-list');
  private readonly byTag = el('input');
  private renaming: TagId | null = null;
  private shown: { tags: Scene['tags'] | null; byTag: boolean } = { tags: null, byTag: false };

  constructor(private readonly host: TagsHost) {
    const heading = el('h2', undefined, t('panel.tags'));
    heading.id = 'tags-heading';
    this.element.setAttribute('aria-labelledby', heading.id);
    const bar = el('div', 'tags-bar');
    const add = this.iconButton(PLUS, t('tags.add'), () => this.host.add());
    add.classList.add('tags-add');
    const label = el('label', 'tags-color-by');
    this.byTag.type = 'checkbox';
    this.byTag.addEventListener('change', () => this.host.setColorByTag(this.byTag.checked));
    label.append(this.byTag, el('span', undefined, t('tags.colorByTag')));
    bar.append(add, label);
    this.list.setAttribute('aria-labelledby', heading.id);
    this.element.append(heading, bar, this.list);
  }

  /** Redraw when the tags or Color by Tag changed (and no name is being edited). */
  sync(): void {
    if (this.renaming) return;
    const tags = this.host.scene().tags;
    const byTag = this.host.colorByTag();
    if (tags === this.shown.tags && byTag === this.shown.byTag) return;
    this.shown = { tags, byTag };
    this.byTag.checked = byTag;
    this.render(tags);
  }

  private render(tags: Scene['tags']): void {
    this.list.replaceChildren(this.untaggedRow());
    const sorted = [...tags].sort(([, a], [, b]) => collator.compare(a.name, b.name));
    for (const [id, tag] of sorted) {
      const li = el('li', 'tags-row');
      if (!tag.visible) li.classList.add('hidden-tag');
      const eye = this.iconButton(tag.visible ? EYE : EYE_SHUT, t(tag.visible ? 'tags.hide' : 'tags.show', { name: tag.name }), () => this.host.setVisible(id, !tag.visible));
      eye.setAttribute('aria-pressed', String(tag.visible));
      const color = el('input', 'tags-swatch');
      color.type = 'color';
      color.value = tag.color;
      color.setAttribute('aria-label', t('tags.color', { name: tag.name }));
      color.addEventListener('change', () => this.host.setColor(id, color.value));
      const name = el('span', 'tags-name', tag.name);
      name.tabIndex = 0;
      name.addEventListener('dblclick', () => this.startRename(id, name, tag.name));
      name.addEventListener('keydown', (e) => {
        if (e.key === 'F2' || e.key === 'Enter') this.startRename(id, name, tag.name);
      });
      const remove = this.iconButton(CROSS, t('tags.delete', { name: tag.name }), () => this.host.remove(id));
      li.append(eye, color, name, remove);
      this.list.append(li);
    }
  }

  /** Untagged: always shown, in the usual face color, and not editable. */
  private untaggedRow(): HTMLLIElement {
    const li = el('li', 'tags-row untagged');
    const eye = this.iconButton(EYE, t('tags.untaggedShown'), () => {});
    eye.disabled = true;
    li.append(eye, el('span', 'tags-swatch untagged-swatch'), el('span', 'tags-name', t('tags.untagged')));
    return li;
  }

  private startRename(id: TagId, name: HTMLElement, old: string): void {
    this.renaming = id;
    const input = el('input', 'tags-input');
    input.value = old;
    input.spellcheck = false;
    input.setAttribute('aria-label', t('tags.rename', { name: old }));
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      this.renaming = null;
      const value = input.value.trim();
      input.replaceWith(name);
      if (commit && value && value !== old) this.host.rename(id, value);
      else this.sync();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
    name.replaceWith(input);
    input.focus();
    input.select();
  }

  private iconButton(svg: string, label: string, run: () => void): HTMLButtonElement {
    const b = el('button', 'icon-button');
    b.type = 'button';
    b.innerHTML = svg;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.addEventListener('click', run);
    return b;
  }
}
