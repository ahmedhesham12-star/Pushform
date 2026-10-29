import { el } from './dom';

const CHEVRON =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 2.5 7.5 6 4 9.5"/></svg>';

/**
 * The panel tray at the end of the window: Entity Info, Outliner, Tags and
 * the panels to come, one under another. A click on a panel's heading folds
 * it shut or opens it again; which are shut is kept on this device.
 */
export class Tray {
  readonly element = el('aside', 'panel');

  constructor(
    private readonly folded: ReadonlySet<string>,
    private readonly onFold: (folded: ReadonlySet<string>) => void,
  ) {}

  /** Add a panel: a section whose first child is its h2 heading. `name` keeps its folded state. */
  add(name: string, section: HTMLElement): void {
    const heading = section.querySelector('h2')!;
    const button = el('button', 'panel-toggle');
    button.type = 'button';
    button.innerHTML = CHEVRON;
    button.append(...[...heading.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE));
    heading.prepend(button);
    const set = (open: boolean) => {
      section.classList.toggle('folded', !open);
      button.setAttribute('aria-expanded', String(open));
    };
    set(!this.folded.has(name));
    button.addEventListener('click', () => {
      const open = section.classList.contains('folded');
      set(open);
      const folded = new Set([...this.element.querySelectorAll<HTMLElement>('[data-panel].folded')].map((s) => s.dataset.panel!));
      this.onFold(folded);
    });
    section.dataset.panel = name;
    this.element.append(section);
  }
}
