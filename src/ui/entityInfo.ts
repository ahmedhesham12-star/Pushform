import { t } from '../i18n';
import type { DefinitionId, InstanceId } from '../scene';
import { el } from './dom';

/** What Entity Info shows; the app builds it from the selection. Values are already formatted. */
export type EntityInfoData =
  | { kind: 'none' }
  | {
      kind: 'instance';
      type: 'group' | 'component';
      definitionId: DefinitionId;
      instanceId: InstanceId;
      definitionName: string;
      instanceName: string;
      /** Instances of the definition in the whole model. */
      copies: number;
      /** Formatted volume, "not a solid", or null when it does not apply (nested groups). */
      volume: string | null;
      /** Its scale along its red, green and blue axes, formatted; null when it is not scaled. */
      scale: string | null;
      /** Scaled more one way than another, so its parts no longer have their real size. */
      stretched: boolean;
    }
  | { kind: 'dimension'; length: string }
  | { kind: 'text'; text: string }
  | {
      kind: 'selection';
      /** How many items are selected. */
      total: string;
      /** How many of each type (groups, components, faces, edges), the ones present only. */
      counts: readonly { label: string; count: string }[];
      /** Total area of the selected faces and length of the selected edges, when there are any. */
      area: string | null;
      length: string | null;
    };

export interface EntityInfoHost {
  renameDefinition(id: DefinitionId, name: string): void;
  renameInstance(id: InstanceId, name: string): void;
}

/**
 * Details of the selection. For a single group or component the names are
 * editable: Enter or leaving the field renames, Escape restores the name.
 */
export class EntityInfo {
  readonly element = el('section', 'entity-info');
  private readonly body = el('dl');
  private shown = '';

  constructor(private readonly host: EntityInfoHost) {
    const heading = el('h2', undefined, t('panel.entityInfo'));
    heading.id = 'entity-info-heading';
    this.element.setAttribute('aria-labelledby', heading.id);
    this.element.append(heading, this.body);
  }

  show(data: EntityInfoData): void {
    const key = JSON.stringify(data);
    if (key === this.shown) return;
    this.shown = key;
    this.body.replaceChildren();
    switch (data.kind) {
      case 'none':
        this.body.append(el('dd', 'entity-info-empty', t('info.none')));
        break;
      case 'instance':
        this.row(t('info.type'), t(data.type === 'component' ? 'scene.component' : 'scene.group'));
        if (data.type === 'component') {
          this.input(t('info.definition'), data.definitionName, (name) => this.host.renameDefinition(data.definitionId, name), false);
          this.row(t('info.copies'), t('info.copiesValue', { count: data.copies }));
        }
        this.input(t('info.instance'), data.instanceName, (name) => this.host.renameInstance(data.instanceId, name), true);
        if (data.volume) this.row(t('info.volume'), data.volume);
        if (data.scale) this.row(t('info.scale'), data.scale);
        if (data.stretched) this.body.append(el('dd', 'entity-info-warning', t('info.stretched')));
        break;
      case 'dimension':
        this.row(t('info.type'), t('info.dimension'));
        this.row(t('info.length'), data.length);
        break;
      case 'text':
        this.row(t('info.type'), t('info.text'));
        this.row(t('info.textValue'), data.text);
        break;
      case 'selection':
        this.row(t('info.selected'), data.total);
        for (const c of data.counts) this.row(c.label, c.count);
        if (data.area) this.row(t('info.area'), data.area);
        if (data.length) this.row(t('info.length'), data.length);
        break;
    }
  }

  private row(label: string, value: string): void {
    this.body.append(el('dt', undefined, label), el('dd', undefined, value));
  }

  /** A name field. `allowEmpty` lets an instance lose its name; a definition always keeps one. */
  private input(label: string, value: string, commit: (name: string) => void, allowEmpty: boolean): void {
    const id = `entity-info-${this.body.children.length}`;
    const dt = el('dt');
    const lab = el('label', undefined, label);
    lab.htmlFor = id;
    dt.append(lab);
    const input = el('input');
    input.id = id;
    input.value = value;
    input.spellcheck = false;
    const apply = () => {
      const name = input.value.trim();
      if (name === value || (!name && !allowEmpty)) {
        input.value = value;
        return;
      }
      commit(name);
    };
    input.addEventListener('change', apply);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') {
        input.value = value;
        input.blur();
      }
    });
    const dd = el('dd');
    dd.append(input);
    this.body.append(dt, dd);
  }
}
