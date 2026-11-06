import { t } from '../i18n';
import { el } from './dom';

export interface LibraryItemInfo {
  readonly id: string;
  readonly name: string;
}

export interface LibraryHost {
  /** The saved items by name, or null while they load. */
  items(): readonly LibraryItemInfo[] | null;
  /** The name the selection would be saved under, or null when it is not one component or imported model. */
  saveName(): string | null;
  save(): void;
  /** Place another copy of an item in the model. */
  insert(id: string): void;
  remove(id: string): void;
}

const CROSS = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>';
/** A second click within this long confirms a removal. */
const CONFIRM_MS = 3000;

/**
 * The personal library (milestone 6), in every workspace: components and
 * imported models saved on this device. Save keeps the selected one; a click
 * on an item places a copy of it in the model. Removing asks for a second
 * click, as it cannot be undone.
 */
export class LibraryPanel {
  readonly element = el('section', 'library');
  private readonly list = el('ul', 'library-list');
  private readonly saveButton = el('button', 'materials-action library-save', t('library.save'));
  private shown: { items: readonly LibraryItemInfo[] | null; name: string | null } | null = null;
  private confirming: { id: string; timer: number } | null = null;

  constructor(private readonly host: LibraryHost) {
    const heading = el('h2', undefined, t('panel.library'));
    heading.id = 'library-heading';
    this.element.setAttribute('aria-labelledby', heading.id);
    this.saveButton.type = 'button';
    this.saveButton.addEventListener('click', () => this.host.save());
    const bar = el('div', 'library-bar');
    bar.append(this.saveButton);
    this.element.append(heading, bar, this.list);
  }

  sync(): void {
    const items = this.host.items();
    const name = this.host.saveName();
    if (this.shown && this.shown.items === items && this.shown.name === name) return;
    this.shown = { items, name };
    this.saveButton.disabled = name === null;
    this.saveButton.title = name === null ? t('library.saveHint') : t('library.saveNamed', { name });
    this.list.replaceChildren();
    if (!items) return;
    if (!items.length) {
      this.list.append(el('li', 'library-empty', t('library.empty')));
      return;
    }
    for (const item of items) {
      const li = el('li', 'library-item');
      const insert = el('button', 'library-insert', item.name);
      insert.type = 'button';
      insert.title = t('library.insert', { name: item.name });
      insert.addEventListener('click', () => this.host.insert(item.id));
      const remove = el('button', 'library-remove');
      remove.type = 'button';
      const asking = this.confirming?.id === item.id;
      if (asking) remove.textContent = t('library.confirmRemove');
      else remove.innerHTML = CROSS;
      remove.setAttribute('aria-label', asking ? t('library.confirmRemove') : t('library.remove', { name: item.name }));
      remove.addEventListener('click', () => this.removeClicked(item.id));
      li.append(insert, remove);
      this.list.append(li);
    }
  }

  private removeClicked(id: string): void {
    const asking = this.confirming;
    if (asking) clearTimeout(asking.timer);
    this.confirming = null;
    if (asking?.id === id) this.host.remove(id);
    else {
      this.confirming = {
        id,
        timer: window.setTimeout(() => {
          this.confirming = null;
          this.redraw();
        }, CONFIRM_MS),
      };
    }
    this.redraw();
  }

  private redraw(): void {
    this.shown = null;
    this.sync();
  }
}
