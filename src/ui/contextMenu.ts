import { t } from '../i18n';
import { el } from './dom';

export interface MenuItem {
  readonly label: string;
  /** Key shown at the end of the item, already translated. */
  readonly shortcut?: string;
  readonly enabled: boolean;
  readonly run: () => void;
}

/** A menu entry, or null for a separator. */
export type MenuEntry = MenuItem | null;

/**
 * The right-click menu. It opens at the pointer inside the viewport and
 * closes on Escape, Tab, a click outside it, or after an item runs. Arrow
 * keys, Home and End move between enabled items.
 */
export class ContextMenu {
  readonly element = el('div', 'context-menu');
  private buttons: HTMLButtonElement[] = [];

  constructor() {
    this.element.setAttribute('role', 'menu');
    this.element.setAttribute('aria-label', t('menu.label'));
    this.element.hidden = true;
    this.element.addEventListener('keydown', (e) => this.key(e));
    this.element.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (this.isOpen && !this.element.contains(e.target as Node)) this.close();
      },
      true,
    );
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** Open at (x, y) in pixels inside the menu's positioned container. */
  open(x: number, y: number, entries: readonly MenuEntry[]): void {
    this.element.replaceChildren();
    this.buttons = [];
    for (const entry of entries) {
      if (!entry) {
        const sep = el('div', 'context-menu-separator');
        sep.setAttribute('role', 'separator');
        this.element.append(sep);
        continue;
      }
      const b = el('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.disabled = !entry.enabled;
      b.append(el('span', undefined, entry.label));
      if (entry.shortcut) b.append(el('kbd', undefined, entry.shortcut));
      b.addEventListener('click', () => {
        this.close();
        entry.run();
      });
      this.element.append(b);
      this.buttons.push(b);
    }
    this.element.hidden = false;
    // Keep the menu inside its container; in a right-to-left layout it opens toward the start side.
    const parent = this.element.offsetParent as HTMLElement | null;
    const w = this.element.offsetWidth;
    const h = this.element.offsetHeight;
    const maxX = (parent?.clientWidth ?? window.innerWidth) - w - 4;
    const maxY = (parent?.clientHeight ?? window.innerHeight) - h - 4;
    const rtl = getComputedStyle(this.element).direction === 'rtl';
    const left = Math.max(4, Math.min(rtl ? x - w : x, maxX));
    const top = Math.max(4, Math.min(y, maxY));
    this.element.style.transform = `translate(${left}px, ${top}px)`;
    this.focusItem(0, 1);
  }

  close(): void {
    if (!this.isOpen) return;
    this.element.hidden = true;
    this.element.replaceChildren();
    this.buttons = [];
  }

  /** Focus the first enabled item from index `from`, stepping by `step` and wrapping. */
  private focusItem(from: number, step: 1 | -1): void {
    const n = this.buttons.length;
    for (let i = 0; i < n; i++) {
      const b = this.buttons[(((from + i * step) % n) + n) % n]!;
      if (!b.disabled) return b.focus();
    }
    this.element.tabIndex = -1;
    this.element.focus();
  }

  private key(e: KeyboardEvent): void {
    const current = this.buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') this.focusItem(current + 1, 1);
    else if (e.key === 'ArrowUp') this.focusItem(current < 0 ? this.buttons.length - 1 : current - 1, -1);
    else if (e.key === 'Home') this.focusItem(0, 1);
    else if (e.key === 'End') this.focusItem(this.buttons.length - 1, -1);
    else if (e.key === 'Escape' || e.key === 'Tab') this.close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
}
