import { t, type MessageKey } from '../i18n';
import type { ImportUnit } from '../import';
import { el } from './dom';

const UNITS: readonly ImportUnit[] = ['mm', 'cm', 'm', 'in', 'ft'];

export interface ImportChoice {
  readonly unit: ImportUnit;
  readonly zUp: boolean;
}

export interface ImportQuestion {
  /** The file name. */
  readonly name: string;
  /** Its triangle count, formatted. */
  readonly triangles: string;
  /** The units the file states, or null to ask (then `suggested` is picked). */
  readonly unit: ImportUnit | null;
  readonly suggested: ImportUnit;
  /** Whether Z is up by default; null when the file says (GLB), so it is not asked. */
  readonly zUp: boolean | null;
}

/**
 * Before placing an imported file (milestone 6): its units when it states
 * none and which axis is up, with the real size it will have. Place gives
 * the choice; Escape or Cancel gives null.
 */
export class ImportDialog {
  readonly element = el('div', 'name-dialog');
  private readonly box = el('form', 'name-dialog-box import-dialog');
  private readonly heading = el('h2');
  private readonly body = el('div', 'import-dialog-body');
  private readonly place = el('button', 'materials-action name-dialog-create', t('import.place'));
  private done: ((choice: ImportChoice | null) => void) | null = null;

  constructor() {
    this.element.hidden = true;
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-modal', 'true');
    this.heading.id = 'import-dialog-heading';
    this.box.setAttribute('aria-labelledby', this.heading.id);
    this.place.type = 'submit';
    const cancel = el('button', 'materials-action', t('dialog.cancel'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close(null));
    const buttons = el('div', 'name-dialog-buttons');
    buttons.append(cancel, this.place);
    this.box.append(this.heading, this.body, buttons);
    this.element.append(this.box);
    this.box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close(null);
      }
    });
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** Ask about a file; `size` formats the size it gets with a choice. */
  open(q: ImportQuestion, size: (choice: ImportChoice) => string, done: (choice: ImportChoice | null) => void): void {
    this.done = done;
    this.heading.textContent = t('import.title', { name: q.name });
    let choice: ImportChoice = { unit: q.unit ?? q.suggested, zUp: q.zUp ?? false };
    const sizeText = el('p', 'import-dialog-size');
    const showSize = () => (sizeText.textContent = t('import.size', { size: size(choice) }));
    const rows: HTMLElement[] = [el('p', 'import-dialog-note', t('import.triangles', { count: q.triangles }))];
    if (q.unit) rows.push(el('p', 'import-dialog-note', t('import.fileUnits', { unit: t(`units.name.${q.unit}` as MessageKey) })));
    else {
      const select = el('select');
      select.id = 'import-dialog-units';
      for (const u of UNITS) {
        const o = el('option', undefined, t(`units.name.${u}` as MessageKey));
        o.value = u;
        select.append(o);
      }
      select.value = choice.unit;
      select.addEventListener('change', () => {
        choice = { ...choice, unit: select.value as ImportUnit };
        showSize();
      });
      const label = el('label', undefined, t('import.units'));
      label.htmlFor = select.id;
      rows.push(label, select);
    }
    if (q.zUp !== null) {
      const box = el('input');
      box.type = 'checkbox';
      box.checked = choice.zUp;
      box.addEventListener('change', () => {
        choice = { ...choice, zUp: box.checked };
        showSize();
      });
      const label = el('label', 'import-dialog-check');
      label.append(box, t('import.zUp'));
      rows.push(label);
    }
    rows.push(sizeText);
    showSize();
    this.body.replaceChildren(...rows);
    this.box.onsubmit = (e) => {
      e.preventDefault();
      this.close(choice);
    };
    this.element.hidden = false;
    (this.body.querySelector('select, input') as HTMLElement | null ?? this.place).focus();
  }

  private close(choice: ImportChoice | null): void {
    this.element.hidden = true;
    const done = this.done;
    this.done = null;
    done?.(choice);
  }
}
