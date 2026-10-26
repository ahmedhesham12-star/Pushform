import { t } from '../i18n';
import { instanceCount, type Instance, type InstanceId, type Scene } from '../scene';
import { el } from './dom';

export interface OutlinerHost {
  scene(): Scene;
  /** The open editing context ([] is the root). */
  context(): readonly InstanceId[];
  /** Selected instances; they are always placed in the open context. */
  selected(): ReadonlySet<InstanceId>;
  /** Select the instance at the end of `path` (opening its parent when needed), with click modifiers. */
  select(path: readonly InstanceId[], e: MouseEvent): void;
  /** Close every context and clear the selection. */
  selectModel(): void;
  rename(instanceId: InstanceId, name: string): void;
  /** Select the instance at the end of `path` unless it is selected, then open the context menu. */
  menu(path: readonly InstanceId[], e: MouseEvent): void;
}

const CHEVRON =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 2.5 7.5 6 4 9.5"/></svg>';
const GROUP_ICON =
  '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2" y="2" width="10" height="10" stroke-dasharray="2 1.5"/></svg>';
const COMPONENT_ICON =
  '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2" y="2" width="4.2" height="4.2"/><rect x="7.8" y="2" width="4.2" height="4.2"/><rect x="2" y="7.8" width="4.2" height="4.2"/><rect x="7.8" y="7.8" width="4.2" height="4.2"/></svg>';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The scene as a tree: the model, then its groups and components, nested.
 * Components show how many copies the model has. Click selects (Shift and
 * Ctrl as in the viewport), double-click or F2 renames, right-click opens the
 * context menu. The group or component being edited is marked.
 */
export class Outliner {
  readonly element = el('section', 'outliner');
  private readonly tree = el('ul', 'outliner-tree');
  private readonly collapsed = new Set<string>();
  private renaming: InstanceId | null = null;
  /** What the tree shows; scenes are immutable, so identity tells whether they changed. */
  private shown: { scene: Scene | null; key: string } = { scene: null, key: '' };

  constructor(private readonly host: OutlinerHost) {
    const heading = el('h2', undefined, t('panel.outliner'));
    heading.id = 'outliner-heading';
    this.tree.setAttribute('role', 'tree');
    this.tree.setAttribute('aria-labelledby', heading.id);
    this.element.append(heading, this.tree);
  }

  /** Redraw when the scene, the context or the selection changed (and no name is being edited). */
  sync(): void {
    if (this.renaming) return;
    const scene = this.host.scene();
    const key = [...this.host.context(), '|', ...this.host.selected()].join(',');
    if (scene === this.shown.scene && key === this.shown.key) return;
    this.shown = { scene, key };
    this.render();
  }

  private render(): void {
    const scene = this.host.scene();
    const context = this.host.context();
    const root = scene.definitions.get(scene.rootId)!;
    const model = this.row(t('outliner.model'), '', null, 0, false, context.length === 0);
    model.button.addEventListener('click', () => this.host.selectModel());
    const items = [model.li];
    for (const li of this.children(scene, root.instances, [], 1)) items.push(li);
    this.tree.replaceChildren(...items);
  }

  private children(scene: Scene, instances: ReadonlyMap<InstanceId, Instance>, parent: readonly InstanceId[], depth: number): HTMLLIElement[] {
    const context = this.host.context();
    const inContext = parent.length === context.length && parent.every((id, i) => id === context[i]);
    const selected = this.host.selected();
    const sorted = [...instances.values()].sort((a, b) => collator.compare(this.label(scene, a).text, this.label(scene, b).text));
    const out: HTMLLIElement[] = [];
    for (const i of sorted) {
      const path = [...parent, i.id];
      const key = path.join('/');
      const def = scene.definitions.get(i.definitionId)!;
      const open = path.length === context.length && path.every((id, k) => id === context[k]);
      const label = this.label(scene, i);
      const count = def.kind === 'component' ? t('outliner.count', { count: instanceCount(scene, def.id) }) : '';
      const row = this.row(label.text, label.detail, def.kind === 'component' ? COMPONENT_ICON : GROUP_ICON, depth, inContext && selected.has(i.id), open, count);
      const hasChildren = def.instances.size > 0;
      // The open context and its parents stay expanded.
      const onOpenPath = path.length <= context.length && path.every((id, k) => id === context[k]);
      const expanded = hasChildren && (onOpenPath || !this.collapsed.has(key));
      const setExpanded = (on: boolean) => {
        if (on) this.collapsed.delete(key);
        else this.collapsed.add(key);
        this.render();
      };
      if (hasChildren) {
        row.li.setAttribute('aria-expanded', String(expanded));
        row.toggle.innerHTML = CHEVRON;
        row.toggle.setAttribute('aria-label', t(expanded ? 'outliner.collapse' : 'outliner.expand'));
        row.toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        });
      }
      row.button.addEventListener('click', (e) => this.host.select(path, e));
      row.button.addEventListener('dblclick', () => this.startRename(row.button, i));
      row.button.addEventListener('keydown', (e) => {
        const rtl = getComputedStyle(row.button).direction === 'rtl';
        const open = rtl ? 'ArrowLeft' : 'ArrowRight';
        const close = rtl ? 'ArrowRight' : 'ArrowLeft';
        if (e.key === 'F2') this.startRename(row.button, i);
        else if (hasChildren && (e.key === open || e.key === close)) setExpanded(e.key === open);
        else return;
        e.preventDefault();
        e.stopPropagation();
      });
      row.button.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.host.menu(path, e);
      });
      out.push(row.li);
      if (expanded) {
        const group = el('ul');
        group.setAttribute('role', 'group');
        group.append(...this.children(scene, def.instances, path, depth + 1));
        row.li.append(group);
      }
    }
    return out;
  }

  /** The instance name, or the component's name, or "Group"; with the definition name as detail when named. */
  private label(scene: Scene, i: Instance): { text: string; detail: string } {
    const def = scene.definitions.get(i.definitionId)!;
    const kindName = def.kind === 'component' ? def.name : t('scene.group');
    return i.name ? { text: i.name, detail: kindName } : { text: kindName, detail: '' };
  }

  private row(text: string, detail: string, icon: string | null, depth: number, selected: boolean, open: boolean, count = '') {
    const li = el('li');
    li.setAttribute('role', 'treeitem');
    li.setAttribute('aria-selected', String(selected));
    li.style.setProperty('--depth', String(depth));
    const line = el('div', 'outliner-row');
    if (selected) line.classList.add('selected');
    if (open) line.classList.add('open');
    const toggle = el('button', 'outliner-toggle');
    toggle.type = 'button';
    toggle.tabIndex = -1;
    const button = el('button');
    button.type = 'button';
    if (icon) {
      const i = el('span', 'outliner-icon');
      i.innerHTML = icon;
      button.append(i);
    }
    button.append(el('span', 'outliner-name', text));
    if (detail) button.append(el('span', 'outliner-detail', detail));
    if (count) button.append(el('span', 'outliner-count', count));
    line.append(toggle, button);
    li.append(line);
    return { li, button, toggle };
  }

  /** Inline name editing: Enter or leaving the field renames, Escape cancels. */
  private startRename(button: HTMLButtonElement, i: Instance): void {
    this.renaming = i.id;
    const input = el('input', 'outliner-input');
    input.value = i.name;
    input.setAttribute('aria-label', t('outliner.rename'));
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      this.renaming = null;
      if (commit && input.value.trim() !== i.name) this.host.rename(i.id, input.value.trim());
      this.shown = { scene: null, key: '' };
      this.sync();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    button.replaceWith(input);
    input.focus();
    input.select();
  }
}
