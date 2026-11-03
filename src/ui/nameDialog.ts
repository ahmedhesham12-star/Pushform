import { t, type MessageKey } from '../i18n';
import { el } from './dom';

/**
 * A small modal over the view asking for a name, as SketchUp's Create
 * Component: the field starts with a suggestion, selected so typing replaces
 * it. Enter or Create gives the name; Escape or Cancel gives null. Create is
 * off while the field is empty.
 */
export class NameDialog {
  readonly element = el('div', 'name-dialog');
  private readonly box = el('form', 'name-dialog-box');
  private readonly heading = el('h2');
  private readonly label = el('label');
  private readonly input = el('input');
  private readonly create = el('button', 'materials-action name-dialog-create');
  private done: ((name: string | null) => void) | null = null;

  constructor() {
    this.element.hidden = true;
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-modal', 'true');
    this.heading.id = 'name-dialog-heading';
    this.box.setAttribute('aria-labelledby', this.heading.id);
    this.input.id = 'name-dialog-input';
    this.input.spellcheck = false;
    this.input.maxLength = 200;
    this.label.htmlFor = this.input.id;
    this.create.type = 'submit';
    const cancel = el('button', 'materials-action', t('dialog.cancel'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close(null));
    const buttons = el('div', 'name-dialog-buttons');
    buttons.append(cancel, this.create);
    this.box.append(this.heading, this.label, this.input, buttons);
    this.element.append(this.box);
    this.input.addEventListener('input', () => (this.create.disabled = !this.input.value.trim()));
    this.box.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = this.input.value.trim();
      if (name) this.close(name);
    });
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

  /** Ask for a name: `title` and `field` label the dialog, `value` is the suggestion, `action` the button that confirms. */
  open(keys: { title: MessageKey; field: MessageKey; action: MessageKey }, value: string, done: (name: string | null) => void): void {
    this.done = done;
    this.heading.textContent = t(keys.title);
    this.label.textContent = t(keys.field);
    this.create.textContent = t(keys.action);
    this.input.value = value;
    this.create.disabled = !value.trim();
    this.element.hidden = false;
    this.input.focus();
    this.input.select();
  }

  private close(name: string | null): void {
    this.element.hidden = true;
    const done = this.done;
    this.done = null;
    done?.(name);
  }
}
