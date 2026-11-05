import { el } from './dom';

const FLASH_MS = 3500;

/** Status line: shows the active tool's hint, or a short message that times out. */
export class StatusBar {
  readonly element = el('p', 'status-text');
  private flashTimer = 0;

  constructor(private readonly currentHint: () => string) {
    this.element.setAttribute('aria-live', 'polite');
  }

  /** Show the active tool's hint, unless a message is still showing. */
  hint(): void {
    if (this.flashTimer) return;
    this.element.className = 'status-text';
    this.element.textContent = this.currentHint();
  }

  /** Show the active tool's hint now, in place of a message still showing. */
  showHint(): void {
    clearTimeout(this.flashTimer);
    this.flashTimer = 0;
    this.hint();
  }

  flash(message: string, isError = false): void {
    clearTimeout(this.flashTimer);
    this.element.textContent = message;
    this.element.className = isError ? 'status-text err' : 'status-text';
    this.flashTimer = window.setTimeout(() => {
      this.flashTimer = 0;
      this.hint();
    }, FLASH_MS);
  }
}
