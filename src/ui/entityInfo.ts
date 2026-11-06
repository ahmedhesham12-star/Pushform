import { EDGES, type Edge } from '../cutlist';
import { t, type MessageKey } from '../i18n';
import type { DefinitionId, GrainAxis, InstanceId, MaterialId } from '../scene';
import { el } from './dom';

/** The select's value for Untagged; tag ids never take this form. */
const UNTAGGED = '-';

/** The Tag field: the tags to choose from, and the selection's tag. */
export interface TagField {
  /** A tag id, null for Untagged, or undefined when the selected items are on different tags. */
  readonly value?: string | null;
  /** Every tag, by name; Untagged is added first. */
  readonly options: readonly { id: string; name: string }[];
}

/** A part's edge banding: each edge's side faces and band, and the edge bands to choose from (a material id, or a starter band's value). */
export interface EdgesField {
  readonly edges: Readonly<Record<Edge, { readonly faceIds: readonly string[]; readonly band: MaterialId | null }>>;
  readonly options: readonly { value: string; name: string }[];
}

const TYPE_NAMES = { group: 'scene.group', component: 'scene.component', mesh: 'scene.mesh' } as const;

/** What Entity Info shows; the app builds it from the selection. Values are already formatted. */
export type EntityInfoData =
  | { kind: 'none' }
  | {
      kind: 'instance';
      type: 'group' | 'component' | 'mesh';
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
      tag: TagField;
      /** The name of its material, or Default. */
      material: string;
      /** Its grain direction for the cut list (shared by component copies); null for the longest side; absent outside the Woodworking workspace. */
      grain?: GrainAxis | null;
      /** Its edge banding, for a part in the Woodworking workspace, or 'assembly' for one holding parts; absent otherwise. */
      edges?: EdgesField | 'assembly';
      /** A reference mesh's triangle count, formatted. */
      triangles?: string;
    }
  | { kind: 'dimension'; length: string; tag: TagField }
  | { kind: 'text'; text: string; tag: TagField }
  | {
      kind: 'selection';
      /** How many items are selected. */
      total: string;
      /** How many of each type (groups, components, faces, edges), the ones present only. */
      counts: readonly { label: string; count: string }[];
      /** Total area of the selected faces and length of the selected edges, when there are any. */
      area: string | null;
      length: string | null;
      /** The Tag field when groups, components, guides or annotations are selected. */
      tag: TagField | null;
      /** Only loose geometry is selected, which stays Untagged. */
      looseOnly: boolean;
    };

export interface EntityInfoHost {
  renameDefinition(id: DefinitionId, name: string): void;
  renameInstance(id: InstanceId, name: string): void;
  /** Put the selected groups, components, guides and annotations on a tag (null: Untagged). */
  setTag(id: string | null): void;
  /** Set a definition's grain direction (null: the longest side). */
  setGrain(definitionId: DefinitionId, grain: GrainAxis | null): void;
  /** Band one edge of the selected part with an edge band (an option's value), or take the band off (null). */
  setEdgeBand(edge: Edge, band: string | null): void;
  /** Outline side faces of the selected part in the view, or stop (null). */
  previewEdge(faceIds: readonly string[] | null): void;
}

/**
 * Details of the selection. For a single group or component the names are
 * editable: Enter or leaving the field renames, Escape restores the name.
 */
export class EntityInfo {
  readonly element = el('section', 'entity-info');
  private readonly body = el('dl');
  private shown = '';
  private previewing = false;

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
    // The rows go, and with them the pointer that was over one.
    this.preview(null);
    this.body.replaceChildren();
    switch (data.kind) {
      case 'none':
        this.body.append(el('dd', 'entity-info-empty', t('info.none')));
        break;
      case 'instance':
        this.row(t('info.type'), t(TYPE_NAMES[data.type]));
        if (data.type !== 'group') {
          this.input(t('info.definition'), data.definitionName, (name) => this.host.renameDefinition(data.definitionId, name), false);
          this.row(t('info.copies'), t('info.copiesValue', { count: data.copies }));
        }
        this.input(t('info.instance'), data.instanceName, (name) => this.host.renameInstance(data.instanceId, name), true);
        this.tagRow(data.tag);
        this.row(t('info.material'), data.material);
        if (data.grain !== undefined) this.grainRow(data.definitionId, data.grain);
        if (data.edges) this.edgeRows(data.edges);
        if (data.triangles) this.row(t('info.triangles'), data.triangles);
        if (data.volume) this.row(t('info.volume'), data.volume);
        if (data.scale) this.row(t('info.scale'), data.scale);
        if (data.stretched) this.body.append(el('dd', 'entity-info-warning', t('info.stretched')));
        break;
      case 'dimension':
        this.row(t('info.type'), t('info.dimension'));
        this.row(t('info.length'), data.length);
        this.tagRow(data.tag);
        break;
      case 'text':
        this.row(t('info.type'), t('info.text'));
        this.row(t('info.textValue'), data.text);
        this.tagRow(data.tag);
        break;
      case 'selection':
        this.row(t('info.selected'), data.total);
        for (const c of data.counts) this.row(c.label, c.count);
        if (data.area) this.row(t('info.area'), data.area);
        if (data.length) this.row(t('info.length'), data.length);
        if (data.tag) this.tagRow(data.tag);
        if (data.looseOnly) this.body.append(el('dd', 'entity-info-hint', t('info.looseUntagged')));
        break;
    }
  }

  /** The grain direction menu: the longest side, or along one of the part's own axes. */
  private grainRow(definitionId: DefinitionId, grain: GrainAxis | null): void {
    const id = `entity-info-${this.body.children.length}`;
    const dt = el('dt');
    const lab = el('label', undefined, t('info.grain'));
    lab.htmlFor = id;
    dt.append(lab);
    const select = el('select');
    select.id = id;
    for (const [value, key] of [
      ['', 'info.grainLongest'],
      ['red', 'cutlist.grain.red'],
      ['green', 'cutlist.grain.green'],
      ['blue', 'cutlist.grain.blue'],
    ] as const) {
      const o = el('option', undefined, t(key));
      o.value = value;
      select.append(o);
    }
    select.value = grain ?? '';
    select.addEventListener('change', () => this.host.setGrain(definitionId, (select.value || null) as GrainAxis | null));
    const dd = el('dd');
    dd.append(select);
    this.body.append(dt, dd);
  }

  /**
   * The band on each of the part's four edges, or a hint when the file has no
   * edge band yet. Pointing at a row, or into its menu, outlines that edge.
   */
  private edgeRows(field: EdgesField | 'assembly'): void {
    this.body.append(el('dt', 'entity-info-section', t('info.edgeBanding')));
    if (field === 'assembly') {
      this.body.append(el('dd', 'entity-info-hint', t('info.edgesAssembly')));
      return;
    }
    if (!field.options.length) {
      this.body.append(el('dd', 'entity-info-hint', t('info.edgesNone')));
      return;
    }
    for (const edge of EDGES) {
      const { faceIds, band } = field.edges[edge];
      const id = `entity-info-${this.body.children.length}`;
      const dt = el('dt');
      const lab = el('label', undefined, t(`cutlist.edge.${edge}` as MessageKey));
      lab.htmlFor = id;
      dt.append(lab);
      const select = el('select');
      select.id = id;
      const option = (value: string, text: string) => {
        const o = el('option', undefined, text);
        o.value = value;
        return o;
      };
      select.append(option('', t('info.edgeNone')), ...field.options.map((o) => option(o.value, o.name)));
      select.value = band ?? '';
      // A part with no straight face at this edge (a rounded end) has nothing to band there.
      select.disabled = !faceIds.length;
      if (!faceIds.length) select.title = t('info.edgeMissing');
      select.addEventListener('change', () => this.host.setEdgeBand(edge, select.value || null));
      const dd = el('dd');
      dd.append(select);
      for (const part of [dt, dd]) {
        part.addEventListener('pointerenter', () => this.preview(faceIds));
        part.addEventListener('pointerleave', () => this.preview(null));
      }
      select.addEventListener('focus', () => this.preview(faceIds));
      select.addEventListener('blur', () => this.preview(null));
      this.body.append(dt, dd);
    }
  }

  private preview(faceIds: readonly string[] | null): void {
    if (!faceIds && !this.previewing) return;
    this.previewing = !!faceIds?.length;
    this.host.previewEdge(faceIds?.length ? faceIds : null);
  }

  /** A menu of tags; picking one puts the selection on it. */
  private tagRow(field: TagField): void {
    const id = `entity-info-${this.body.children.length}`;
    const dt = el('dt');
    const lab = el('label', undefined, t('info.tag'));
    lab.htmlFor = id;
    dt.append(lab);
    const select = el('select');
    select.id = id;
    const option = (value: string, text: string) => {
      const o = el('option', undefined, text);
      o.value = value;
      return o;
    };
    if (field.value === undefined) {
      const mixed = option('', t('info.tagMixed'));
      mixed.disabled = true;
      select.append(mixed);
    }
    select.append(option(UNTAGGED, t('tags.untagged')), ...field.options.map((o) => option(o.id, o.name)));
    select.value = field.value === undefined ? '' : (field.value ?? UNTAGGED);
    select.addEventListener('change', () => this.host.setTag(select.value === UNTAGGED ? null : select.value));
    const dd = el('dd');
    dd.append(select);
    this.body.append(dt, dd);
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
