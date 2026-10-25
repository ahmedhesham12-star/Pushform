import { t } from '../i18n';
import { el } from './dom';

/**
 * The measurements box: shows live sizes while a tool works and takes typed
 * values. While the user is typing, live updates do not overwrite the input.
 */
export class MeasurementsBox {
  readonly element = el('label', 'vcb');
  readonly input = el('input');
  private readonly label = el('span');
  private typing = false;

  constructor(handlers: { submit(text: string): void; cancel(): void }) {
    this.input.inputMode = 'decimal';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.setAttribute('aria-label', t('measure.inputLabel'));
    this.element.append(this.label, this.input);
    this.input.addEventListener('input', () => {
      this.typing = true;
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.input.value;
        this.typing = false;
        this.input.blur();
        handlers.submit(text);
      } else if (e.key === 'Escape') {
        this.input.blur();
        handlers.cancel();
      }
    });
  }

  set(label: string, value: string): void {
    this.label.textContent = label;
    if (!this.typing) this.input.value = value;
  }

  /** Start typing from a key pressed while the canvas had focus. */
  startTyping(firstChar: string): void {
    this.input.focus();
    this.input.value = firstChar;
    this.typing = true;
  }

  reset(): void {
    this.typing = false;
    this.input.value = '';
  }
}
