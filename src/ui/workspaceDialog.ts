import { WORKSPACES, type Workspace } from '../commands';
import { t, type MessageKey } from '../i18n';
import { el } from './dom';

/**
 * Asks what a new model is for (File > New, and once on the first run):
 * Woodworking, Architecture or General, each with a line on what it offers.
 * A choice gives the workspace; Escape or Cancel gives null.
 */
export class WorkspaceDialog {
  readonly element = el('div', 'name-dialog');
  private readonly box = el('div', 'name-dialog-box workspace-dialog');
  private readonly choices = new Map<Workspace, HTMLButtonElement>();
  private done: ((workspace: Workspace | null) => void) | null = null;

  constructor() {
    this.element.hidden = true;
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-modal', 'true');
    const heading = el('h2', undefined, t('workspace.chooseTitle'));
    heading.id = 'workspace-dialog-heading';
    const prompt = el('p', 'workspace-prompt', t('workspace.choosePrompt'));
    prompt.id = 'workspace-dialog-prompt';
    this.box.setAttribute('aria-labelledby', heading.id);
    this.box.setAttribute('aria-describedby', prompt.id);
    const list = el('div', 'workspace-choices');
    for (const w of WORKSPACES) {
      const b = el('button', 'workspace-choice');
      b.type = 'button';
      b.append(el('b', undefined, t(`workspace.${w}` as MessageKey)), el('span', undefined, t(`workspace.${w}.about` as MessageKey)));
      b.addEventListener('click', () => this.close(w));
      list.append(b);
      this.choices.set(w, b);
    }
    const cancel = el('button', 'materials-action', t('dialog.cancel'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close(null));
    const buttons = el('div', 'name-dialog-buttons');
    buttons.append(cancel);
    this.box.append(heading, prompt, list, buttons);
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

  /** Ask which workspace; `current` (the last one chosen) has the focus, so Enter keeps it. */
  open(current: Workspace, done: (workspace: Workspace | null) => void): void {
    this.done = done;
    this.element.hidden = false;
    this.choices.get(current)!.focus();
  }

  private close(workspace: Workspace | null): void {
    this.element.hidden = true;
    const done = this.done;
    this.done = null;
    done?.(workspace);
  }
}
