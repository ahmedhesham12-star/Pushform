import { t } from '../i18n';

/** Where the editor goes, in canvas pixels: centered on the point, or hanging from it as its top left corner. */
export interface TextEditorPlace {
  readonly x: number;
  readonly y: number;
  readonly corner?: boolean;
}

/**
 * A text field over the canvas for writing a text in place. Enter, or
 * leaving the field, finishes it (Shift+Enter starts a new line); Escape
 * drops the change. `done` gets the text, or null when nothing should change.
 */
export class TextEditor {
  private finishOpen: ((keep: boolean) => void) | null = null;

  constructor(private readonly container: HTMLElement) {}

  get isOpen(): boolean {
    return this.finishOpen !== null;
  }

  open(place: TextEditorPlace, text: string, done: (text: string | null) => void): void {
    this.close();
    const field = document.createElement('textarea');
    field.className = 'text-editor';
    field.value = text;
    field.spellcheck = false;
    field.setAttribute('aria-label', t('text.editor'));
    // Canvas pixels are physical, like the snap marker's.
    field.style.transform = `translate(${place.x}px, ${place.y}px)${place.corner ? '' : ' translate(-50%, -50%)'}`;
    const fit = () => {
      const lines = field.value.split('\n');
      field.rows = Math.max(1, lines.length);
      field.cols = Math.max(8, ...lines.map((l) => l.length + 1));
    };
    let finished = false;
    const finish = (keep: boolean) => {
      if (finished) return;
      finished = true;
      const value = field.value.trim();
      if (this.finishOpen === finish) this.finishOpen = null;
      field.remove();
      done(keep && value ? value : null);
    };
    field.addEventListener('input', fit);
    field.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') finish(false);
      else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finish(true);
      }
    });
    fit();
    this.finishOpen = finish;
    this.container.append(field);
    // Opened from a pointer press, whose default action would move the focus
    // away again: take it once the press is over, and only then let leaving
    // the field finish the text.
    setTimeout(() => {
      if (finished) return;
      field.focus();
      field.select();
      field.addEventListener('blur', () => finish(true));
    });
  }

  /** Finish an open edit as if the field had been left. */
  close(): void {
    this.finishOpen?.(true);
  }
}
