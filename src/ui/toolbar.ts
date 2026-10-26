import { t, type MessageKey } from '../i18n';
import { el } from './dom';
import { ICONS, type IconName } from './icons';

export interface ToolButtonSpec<Id extends string> {
  id: Id;
  label: MessageKey;
  icon: IconName;
  /** Label for the shortcut key shown on the button; omitted for tools without one. */
  keyLabel?: string;
  /** Name of the key for the tooltip. */
  keyName?: string;
  /** Start a new group (separator before this button). */
  group?: boolean;
}

/** The tool palette: icon buttons in two columns, named by their tooltips. */
export class ToolBar<Id extends string> {
  readonly element = el('nav', 'tools');
  private readonly buttons = new Map<Id, HTMLButtonElement>();

  constructor(specs: readonly ToolButtonSpec<Id>[], onSelect: (id: Id) => void) {
    this.element.setAttribute('aria-label', t('toolbar.label'));
    for (const s of specs) {
      if (s.group) this.element.append(el('hr'));
      const b = el('button');
      b.type = 'button';
      b.title = s.keyName ? t('action.withShortcut', { name: t(s.label), key: s.keyName }) : t(s.label);
      b.setAttribute('aria-label', t(s.label));
      b.setAttribute('aria-pressed', 'false');
      if (s.keyLabel) b.append(el('kbd', undefined, s.keyLabel));
      b.insertAdjacentHTML('beforeend', ICONS[s.icon]);
      b.addEventListener('click', () => onSelect(s.id));
      this.element.append(b);
      this.buttons.set(s.id, b);
    }
  }

  setActive(id: Id): void {
    for (const [bid, b] of this.buttons) b.setAttribute('aria-pressed', String(bid === id));
  }
}

export interface ActionHandlers {
  undo(): void;
  redo(): void;
  zoomToFit(): void;
  clear(): void;
}

/** Undo, redo, zoom to fit and clear, in the top bar. */
export class ActionBar {
  readonly element = el('div', 'actions');
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;

  constructor(handlers: ActionHandlers, before: HTMLElement[] = []) {
    const button = (label: MessageKey, onClick: () => void, key?: MessageKey) => {
      const b = el('button', undefined, t(label));
      b.type = 'button';
      if (key) b.title = t('action.withShortcut', { name: t(label), key: t(key) });
      b.addEventListener('click', onClick);
      return b;
    };
    this.undoButton = button('action.undo', handlers.undo, 'key.undo');
    this.redoButton = button('action.redo', handlers.redo, 'key.redo');
    this.element.append(
      ...before,
      this.undoButton,
      this.redoButton,
      button('action.zoomFit', handlers.zoomToFit, 'key.zoomFit'),
      button('action.clear', handlers.clear),
    );
  }

  setHistory(canUndo: boolean, canRedo: boolean): void {
    this.undoButton.disabled = !canUndo;
    this.redoButton.disabled = !canRedo;
  }
}
