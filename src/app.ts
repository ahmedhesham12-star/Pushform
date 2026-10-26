import {
  createSession,
  definitionModel,
  matchTypedValues,
  rootModel,
  type CommandError,
  type CommandSession,
  type PushformDocument,
} from './commands';
import { t, type MessageKey } from './i18n';
import {
  edgeCount,
  edgeGroup,
  edgeLength,
  faceArea,
  faceCount,
  getEdge,
  getFace,
  hasEdge,
  hasFace,
  solidVolume,
  type Bounds,
  type Model,
  type Point3,
} from './kernel';
import {
  applyPoint,
  compose,
  definitionBounds,
  getDefinition,
  instanceCount,
  pathDefinition,
  rootDefinition,
  transformBounds,
  union,
  type InstanceId,
} from './scene';
import { saveAutosave } from './storage';
import {
  ACTION_SHORTCUTS,
  createTools,
  isMac,
  selectionMode,
  shortcutFor,
  TOOL_SHORTCUTS,
  type Selection,
  type Tool,
  type ToolContext,
  type ToolId,
} from './tools';
import { ContextMenu, type MenuEntry } from './ui/contextMenu';
import { EntityInfo, type EntityInfoData } from './ui/entityInfo';
import { Outliner } from './ui/outliner';
import { el } from './ui/dom';
import { ICONS } from './ui/icons';
import { Intro } from './ui/intro';
import { MeasurementsBox } from './ui/measurements';
import { StatusBar } from './ui/statusBar';
import { ActionBar, ToolBar, type ToolButtonSpec } from './ui/toolbar';
import { UnitsMenu } from './ui/unitsMenu';
import { defaultPrecision, formatArea, formatLength, formatNumber, formatVolume, parseTypedValues, type LengthUnit } from './units';
import { Viewport, type EdgeHighlight, type Highlight } from './viewport';

/** Characters that start typing into the measurements box while a tool is busy. */
const MEASURE_START = /^[0-9.,\-٠-٩۰-۹]$/;
/** Pointer travel (px) that turns a click into a drag. */
const DRAG_THRESHOLD = 6;

const ERROR_MESSAGES: Partial<Record<string, MessageKey>> = {
  tooSmall: 'error.tooSmall',
  outsideFace: 'error.outsideFace',
  overlapsHole: 'error.overlapsHole',
  notOnPlane: 'error.notOnPlane',
  noSuchFace: 'error.noSuchFace',
  nothingSelected: 'error.nothingSelected',
  noSuchInstance: 'error.noSuchInstance',
};

export class App {
  readonly session: CommandSession;
  readonly viewport: Viewport;
  private readonly selection: Selection = { faces: new Set(), edges: new Set(), instances: new Set(), hovered: null };
  /** The open editing context: instance ids from the root down ([] is the root). */
  private context: readonly InstanceId[] = [];
  private readonly tools: Record<ToolId, Tool>;
  private tool: Tool;
  private readonly status: StatusBar;
  private readonly measure: MeasurementsBox;
  private readonly toolbar: ToolBar<ToolId>;
  private readonly actions: ActionBar;
  private readonly unitsMenu: UnitsMenu;
  private readonly intro = new Intro();
  private readonly menu = new ContextMenu();
  private readonly entityInfo: EntityInfo;
  private readonly outliner: Outliner;
  /**
   * Navigation in progress. A right-button press only starts orbiting once it
   * moves past DRAG_THRESHOLD; released before that, it opens the menu.
   */
  private nav: { mode: 'orbit' | 'pan'; x: number; y: number; startX: number; startY: number; menu: boolean; dragging: boolean } | null = null;
  private down: { x: number; y: number } | null = null;

  constructor(root: HTMLElement, doc: PushformDocument) {
    this.session = createSession(doc);

    const top = el('header', 'top');
    const brand = el('div', 'brand');
    brand.innerHTML = ICONS.brand;
    brand.append(el('b', undefined, t('app.name')), el('span', undefined, t('app.tagline')));
    this.unitsMenu = new UnitsMenu((unit, precision) => this.setUnits(unit, precision));
    this.actions = new ActionBar(
      {
        undo: () => this.undo(),
        redo: () => this.redo(),
        zoomToFit: () => this.zoomToFit(),
        clear: () => this.clear(),
      },
      [this.unitsMenu.element],
    );
    top.append(brand, this.actions.element);

    // Shortcuts come from TOOL_SHORTCUTS (SketchUp defaults); Polygon has none, as in SketchUp.
    const key = (id: ToolId) => {
      const k = shortcutFor(id);
      if (k === null) return {};
      return k === ' ' ? { keyLabel: t('key.spaceSymbol'), keyName: t('key.space') } : { keyLabel: k.toUpperCase(), keyName: k.toUpperCase() };
    };
    const toolSpecs: ToolButtonSpec<ToolId>[] = [
      { id: 'select', label: 'tool.select', icon: 'select', ...key('select') },
      { id: 'line', label: 'tool.line', icon: 'line', ...key('line') },
      { id: 'rectangle', label: 'tool.rectangle', icon: 'rectangle', ...key('rectangle') },
      { id: 'circle', label: 'tool.circle', icon: 'circle', ...key('circle') },
      { id: 'polygon', label: 'tool.polygon', icon: 'polygon', ...key('polygon') },
      { id: 'pushPull', label: 'tool.pushPull', icon: 'pushPull', ...key('pushPull') },
      { id: 'erase', label: 'tool.erase', icon: 'erase', ...key('erase') },
      { id: 'orbit', label: 'tool.orbit', icon: 'orbit', ...key('orbit'), group: true },
      { id: 'pan', label: 'tool.pan', icon: 'pan', ...key('pan') },
    ];
    this.toolbar = new ToolBar(toolSpecs, (id) => this.setTool(id));

    const view = el('main', 'view');
    view.append(this.intro.element);

    const footer = el('footer', 'status');
    this.status = new StatusBar(() => this.tool.hint());
    this.measure = new MeasurementsBox({
      submit: (text) => {
        // An operation in progress first, then amending the last one, then idle input (counts).
        if (this.tool.busy() && this.tool.submit) this.tool.submit(text);
        else if (this.session.canAmend) this.amend(text);
        else if (this.tool.acceptsInput?.() && this.tool.submit) this.tool.submit(text);
        else this.status.flash(t('error.nothingToSize'), true);
        this.syncMeasureEditable();
      },
      cancel: () => this.cancel(),
    });
    footer.append(this.status.element, this.measure.element);

    this.entityInfo = new EntityInfo({
      renameDefinition: (definitionId, name) => this.run(this.session.execute('core.renameDefinition', { definitionId, name })),
      renameInstance: (instanceId, name) => this.run(this.session.execute('core.renameInstance', { instanceId, name })),
    });
    this.outliner = new Outliner({
      scene: () => this.session.doc.scene,
      context: () => this.context,
      selected: () => this.selection.instances,
      select: (path, e) => this.selectFromOutliner(path, e),
      selectModel: () => {
        this.setContext([]);
        this.clearSelection();
        this.applyHighlights();
        this.status.hint();
      },
      rename: (instanceId, name) => this.run(this.session.execute('core.renameInstance', { instanceId, name })),
      menu: (path, e) => {
        const id = path.at(-1)!;
        if (!this.selection.instances.has(id) || path.length - 1 !== this.context.length) this.selectFromOutliner(path);
        this.showMenu(e.clientX, e.clientY);
      },
    });
    const panel = el('aside', 'panel');
    panel.append(this.entityInfo.element, this.outliner.element);

    root.append(top, this.toolbar.element, view, panel, footer, this.menu.element);
    this.viewport = new Viewport(view);

    this.tools = createTools(this.toolContext());
    this.tool = this.tools.rectangle;

    this.session.subscribe((e) => {
      saveAutosave(this.session.doc);
      this.refresh();
      if (e.reason === 'execute' || e.reason === 'amend') this.showAmendValues();
      this.syncMeasureEditable();
    });
    this.bindPointer();
    this.bindKeyboard();

    this.refresh();
    this.setTool('rectangle');
    if (!this.isEmpty()) this.zoomToFit();
  }

  /* ---------- state to view ---------- */

  private refresh(): void {
    const doc = this.session.doc;
    // Undo can remove the group or component being edited: close up to what still exists.
    while (this.context.length && !pathDefinition(doc.scene, this.context)) this.context = this.context.slice(0, -1);
    this.viewport.setUnits(doc.units);
    this.viewport.showScene(doc.scene, this.context);
    this.viewport.setSnapTargets(doc.scene);
    const m = this.contextModel();
    const placed = pathDefinition(doc.scene, this.context)!.instances;
    const s = this.selection;
    for (const f of s.faces) if (!hasFace(m, f)) s.faces.delete(f);
    for (const e of s.edges) if (!hasEdge(m, e)) s.edges.delete(e);
    for (const i of s.instances) if (!placed.has(i)) s.instances.delete(i);
    const h = s.hovered;
    const exists = h && (h.kind === 'face' ? hasFace(m, h.id) : h.kind === 'edge' ? hasEdge(m, h.id) : placed.has(h.id));
    if (h && !exists) s.hovered = null;
    this.applyHighlights();
    this.intro.setVisible(this.isEmpty());
    this.actions.setHistory(this.session.canUndo, this.session.canRedo);
    this.unitsMenu.sync(doc.units);
  }

  /** Geometry of the open editing context. */
  private contextModel(): Model {
    return definitionModel(this.session.doc, this.viewport.frame.definitionId)!;
  }

  private applyHighlights(hoverKind?: Highlight): void {
    const { faces, edges, instances, hovered } = this.selection;
    const kind = hoverKind ?? (this.tool.id === 'erase' ? 'erase' : 'hover');
    this.viewport.paintAll('normal');
    for (const f of faces) this.viewport.paint(f, 'selected');
    const lines = new Map<string, EdgeHighlight>();
    for (const e of edges) lines.set(e, 'selected');
    if (hovered?.kind === 'face' && !faces.has(hovered.id)) this.viewport.paint(hovered.id, kind);
    if (hovered?.kind === 'edge') {
      // Hovering one segment of a curve highlights the whole curve.
      const edgeKind: EdgeHighlight = kind === 'erase' ? 'erase' : 'hover';
      for (const e of edgeGroup(this.contextModel(), hovered.id)) if (!edges.has(e)) lines.set(e, edgeKind);
    }
    this.viewport.highlightEdges(lines);
    const boxes = new Map<InstanceId, EdgeHighlight>();
    for (const i of instances) boxes.set(i, 'selected');
    if (hovered?.kind === 'instance' && !instances.has(hovered.id)) boxes.set(hovered.id, kind === 'erase' ? 'erase' : 'hover');
    this.viewport.highlightInstances(boxes);
    // Every selection change ends here, so the panels follow it.
    this.entityInfo.show(this.entityInfoData());
    this.outliner.sync();
  }

  /** Flash a command's error; a successful command needs no message here. */
  private run(r: { ok: true } | { ok: false; error: CommandError }): void {
    if (!r.ok) this.flashError(r.error);
  }

  /** What Entity Info shows for the current selection. */
  private entityInfoData(): EntityInfoData {
    const { faces, edges, instances } = this.selection;
    if (!faces.size && !edges.size && !instances.size) return { kind: 'none' };
    const doc = this.session.doc;
    const count = (n: number) => formatNumber(n);
    if (instances.size) {
      const id = [...instances][0]!;
      const i = pathDefinition(doc.scene, this.context)?.instances.get(id);
      const def = i && doc.scene.definitions.get(i.definitionId);
      if (instances.size === 1 && !faces.size && !edges.size && i && def && def.kind !== 'root') {
        // Volume is only shown for geometry without nested groups or components.
        const volume = def.instances.size ? null : solidVolume(def.model);
        return {
          kind: 'instance',
          type: def.kind,
          definitionId: def.id,
          instanceId: id,
          definitionName: def.name,
          instanceName: i.name,
          copies: instanceCount(doc.scene, def.id),
          volume: def.instances.size ? null : volume === null ? t('info.notSolid') : formatVolume(volume, doc.units),
        };
      }
      return { kind: 'mixed', title: t('info.items', { count: count(faces.size + edges.size + instances.size) }) };
    }
    const m = this.contextModel();
    const title =
      faces.size && edges.size
        ? t('info.facesAndEdges', { faces: count(faces.size), edges: count(edges.size) })
        : faces.size
          ? faces.size === 1
            ? t('info.face')
            : t('info.faces', { count: count(faces.size) })
          : edges.size === 1
            ? t('info.edge')
            : t('info.edges', { count: count(edges.size) });
    const area = faces.size ? formatArea([...faces].reduce((s, f) => s + faceArea(m, f), 0), doc.units) : null;
    const length = edges.size ? formatLength([...edges].reduce((s, e) => s + edgeLength(m, e), 0), doc.units) : null;
    return { kind: 'geometry', title, area, length };
  }

  /**
   * Select the instance at the end of `path` from the Outliner: its parent
   * becomes the open context, and the click's modifiers apply as in the
   * viewport (without an event, it replaces the selection).
   */
  private selectFromOutliner(path: readonly InstanceId[], e?: MouseEvent): void {
    if (this.tool.id !== 'select') this.setTool('select');
    this.setContext(path.slice(0, -1));
    const id = path.at(-1)!;
    const mode = e ? selectionMode(e, isMac()) : 'replace';
    if (mode === 'replace') this.clearSelection();
    const on = mode === 'remove' ? false : mode === 'toggle' ? !this.selection.instances.has(id) : true;
    if (on) this.selection.instances.add(id);
    else this.selection.instances.delete(id);
    this.applyHighlights();
    this.status.hint();
  }

  /** Open or close editing contexts so that `path` is the open one. Clears the selection. */
  private setContext(path: readonly InstanceId[]): void {
    if (path.length === this.context.length && path.every((id, i) => id === this.context[i])) return;
    if (!pathDefinition(this.session.doc.scene, path)) return;
    this.cancel(true);
    this.context = [...path];
    this.clearSelection();
    this.refresh();
    this.measure.set(this.tool.measurementLabel(), '');
    this.status.hint();
  }

  /** Open a group or component placed in the current context for editing. */
  private openContext(instanceId: InstanceId): void {
    this.setContext([...this.context, instanceId]);
  }

  private clearSelection(): void {
    this.selection.faces.clear();
    this.selection.edges.clear();
    this.selection.instances.clear();
    this.selection.hovered = null;
  }

  private hasSelection(): boolean {
    return this.selection.faces.size + this.selection.edges.size + this.selection.instances.size > 0;
  }

  private toolContext(): ToolContext {
    return {
      session: this.session,
      viewport: this.viewport,
      selection: this.selection,
      units: () => this.session.doc.units,
      applyHighlights: (kind) => this.applyHighlights(kind),
      showCommitted: () => this.refresh(),
      showPreview: (doc) => this.viewport.showScene(doc.scene, this.context),
      closeContext: (path) => this.setContext(path),
      contextPath: () => this.context,
      setMeasurement: (label, value) => this.measure.set(label, value),
      hint: () => {
        this.status.hint();
        this.syncMeasureEditable();
      },
      flash: (message, isError) => this.status.flash(message, isError),
      flashError: (error) => this.flashError(error),
      cancel: (quiet) => this.cancel(quiet),
    };
  }

  private flashError(error: CommandError): void {
    const key = ERROR_MESSAGES[error.code];
    this.status.flash(key ? t(key) : t('error.generic', { code: error.code }), true);
  }

  /* ---------- actions ---------- */

  /** End the current operation. Quiet skips re-showing the committed model (a commit follows). */
  private cancel(quiet = false): void {
    const hadOperation = this.tool.reset();
    this.viewport.clearPreview();
    this.viewport.hideMarker();
    this.measure.reset();
    if (!quiet) this.showIdleMeasurement();
    if (hadOperation && !quiet) this.refresh();
    this.status.hint();
    this.syncMeasureEditable();
  }

  /** What the measurements box shows when no operation is in progress. */
  private showIdleMeasurement(): void {
    this.measure.set(this.tool.measurementLabel(), this.tool.idleMeasurement?.() ?? '');
  }

  /** Whether typed input has somewhere to go: an operation, an amend, or the tool's idle input. */
  private acceptsTyping(): boolean {
    return this.tool.busy() || this.session.canAmend || !!this.tool.acceptsInput?.();
  }

  /** The measurements box takes input only when typing has somewhere to go. */
  private syncMeasureEditable(): void {
    this.measure.setEditable(this.acceptsTyping());
  }

  setTool(id: ToolId): void {
    this.session.clearAmend();
    this.cancel();
    this.tool = this.tools[id];
    if (id !== 'select') this.clearSelection();
    this.selection.hovered = null;
    this.applyHighlights();
    this.toolbar.setActive(id);
    this.showIdleMeasurement();
    this.viewport.canvas.style.cursor = this.tool.cursor;
    this.status.hint();
    this.syncMeasureEditable();
  }

  private undo(): void {
    if (!this.session.canUndo) return;
    this.cancel(true);
    this.session.undo();
  }

  private redo(): void {
    if (!this.session.canRedo) return;
    this.cancel(true);
    this.session.redo();
  }

  private zoomToFit(): void {
    const scene = this.session.doc.scene;
    this.viewport.zoomToFit(definitionBounds(scene, scene.rootId));
  }

  private clear(): void {
    if (this.isEmpty()) return;
    this.cancel(true);
    this.clearSelection();
    if (this.session.execute('core.clearModel', {}).ok) this.status.flash(t('message.cleared'));
  }

  /** Erase the selected faces, edges and instances in one step. */
  private deleteSelected(): void {
    const faceIds = [...this.selection.faces];
    const edgeIds = [...this.selection.edges];
    const instanceIds = [...this.selection.instances];
    if (!faceIds.length && !edgeIds.length && !instanceIds.length) return;
    this.clearSelection();
    const r = this.session.execute('core.erase', { definitionId: this.viewport.frame.definitionId, faceIds, edgeIds, instanceIds });
    if (r.ok) this.status.flash(t('message.erased'));
    else this.flashError(r.error);
  }

  private isEmpty(): boolean {
    const m = rootModel(this.session.doc);
    return faceCount(m) === 0 && edgeCount(m) === 0 && rootDefinition(this.session.doc.scene).instances.size === 0;
  }

  /* ---------- groups and components ---------- */

  /** The selection as command input, in the open context. */
  private selectionInput() {
    return {
      definitionId: this.viewport.frame.definitionId,
      faceIds: [...this.selection.faces],
      edgeIds: [...this.selection.edges],
      instanceIds: [...this.selection.instances],
    };
  }

  /** Select exactly these faces and instances of the open context. */
  private selectOnly(faces: readonly string[], instances: readonly InstanceId[]): void {
    this.clearSelection();
    for (const f of faces) this.selection.faces.add(f);
    for (const i of instances) this.selection.instances.add(i);
    this.applyHighlights();
    this.status.hint();
  }

  /** Make the selection a group or a component, and select the new instance. */
  private makeInstance(kind: 'group' | 'component'): void {
    if (!this.hasSelection()) return this.status.flash(t('error.nothingSelected'), true);
    this.cancel(true);
    const input = this.selectionInput();
    const r = kind === 'group' ? this.session.execute('core.makeGroup', input) : this.session.execute('core.makeComponent', input);
    if (!r.ok) return this.flashError(r.error);
    this.selectOnly([], [r.output.instanceId]);
    const name = getDefinition(this.session.doc.scene, r.output.definitionId)?.name ?? '';
    this.status.flash(kind === 'group' ? t('message.groupMade') : t('message.componentMade', { name }));
  }

  /** Explode the selected instances; their contents become the selection. */
  private explodeSelected(): void {
    const instanceIds = [...this.selection.instances];
    if (!instanceIds.length) return;
    this.cancel(true);
    const r = this.session.execute('core.explode', { instanceIds });
    if (!r.ok) return this.flashError(r.error);
    this.selectOnly(r.output.faceIds, r.output.instanceIds);
    this.status.flash(t('message.exploded'));
  }

  private makeUniqueSelected(): void {
    const instanceIds = [...this.selection.instances];
    if (!instanceIds.length) return;
    const r = this.session.execute('core.makeUnique', { instanceIds });
    if (!r.ok) return this.flashError(r.error);
    const id = r.output.definitionIds[0];
    if (!id) return this.status.flash(t('message.alreadyUnique'));
    this.status.flash(t('message.madeUnique', { name: getDefinition(this.session.doc.scene, id)?.name ?? '' }));
  }

  /** Whether a selected component shares its definition with copies that are not selected. */
  private canMakeUnique(): boolean {
    const scene = this.session.doc.scene;
    const placed = pathDefinition(scene, this.context)!.instances;
    const counts = new Map<string, number>();
    for (const id of this.selection.instances) {
      const i = placed.get(id);
      if (i) counts.set(i.definitionId, (counts.get(i.definitionId) ?? 0) + 1);
    }
    return [...counts].some(([d, n]) => scene.definitions.get(d)?.kind === 'component' && instanceCount(scene, d) > n);
  }

  /** World bounds of the selected faces, edges and instances. */
  private selectionBounds(): Bounds | null {
    const frame = this.viewport.frame;
    const m = this.contextModel();
    const scene = this.session.doc.scene;
    const placed = pathDefinition(scene, this.context)!.instances;
    let b: Bounds | null = null;
    const add = (p: Point3) => {
      const w = applyPoint(frame.world, p);
      b = union(b, { min: w, max: w });
    };
    for (const f of this.selection.faces) for (const p of getFace(m, f)?.outer ?? []) add(p);
    for (const e of this.selection.edges) {
      const v = getEdge(m, e);
      if (v) [v.a, v.b].forEach(add);
    }
    for (const id of this.selection.instances) {
      const i = placed.get(id);
      if (i) b = union(b, transformBounds(compose(frame.world, i.transform), definitionBounds(scene, i.definitionId)));
    }
    return b;
  }

  /**
   * The right-click menu in the viewport. Right-clicking something that is
   * not selected selects it first, as in SketchUp; the items act on the selection.
   */
  private openContextMenu(e: PointerEvent): void {
    this.viewport.setPointer(e);
    const hit = this.viewport.pick();
    if (hit && hit.kind !== 'outside') {
      const set = hit.kind === 'edge' ? this.selection.edges : hit.kind === 'face' ? this.selection.faces : this.selection.instances;
      if (!set.has(hit.id)) {
        this.clearSelection();
        for (const id of hit.kind === 'edge' ? edgeGroup(this.contextModel(), hit.id) : [hit.id]) set.add(id);
        this.applyHighlights();
        this.status.hint();
      }
    }
    this.showMenu(e.clientX, e.clientY);
  }

  /** The context menu for the current selection, at client coordinates. */
  private showMenu(x: number, y: number): void {
    const scene = this.session.doc.scene;
    const placed = pathDefinition(scene, this.context)!.instances;
    const any = this.hasSelection();
    const onlyOne = this.selection.instances.size === 1 && !this.selection.faces.size && !this.selection.edges.size;
    const single = onlyOne ? [...this.selection.instances][0]! : null;
    const singleKind = single ? scene.definitions.get(placed.get(single)?.definitionId ?? '')?.kind : undefined;
    const contextKind = this.context.length ? pathDefinition(scene, this.context)!.kind : undefined;
    const entries: MenuEntry[] = [
      { label: t('menu.makeComponent'), shortcut: t('key.makeComponent'), enabled: any, run: () => this.makeInstance('component') },
      { label: t('menu.makeGroup'), enabled: any, run: () => this.makeInstance('group') },
      null,
      {
        label: t(singleKind === 'component' ? 'menu.editComponent' : 'menu.editGroup'),
        enabled: single !== null,
        run: () => single && this.openContext(single),
      },
      {
        label: t(contextKind === 'component' ? 'menu.closeComponent' : 'menu.closeGroup'),
        shortcut: t('key.escape'),
        enabled: contextKind !== undefined,
        run: () => this.setContext(this.context.slice(0, -1)),
      },
      { label: t('menu.explode'), enabled: this.selection.instances.size > 0, run: () => this.explodeSelected() },
      { label: t('menu.makeUnique'), enabled: this.canMakeUnique(), run: () => this.makeUniqueSelected() },
      null,
      { label: t('menu.delete'), shortcut: t('key.delete'), enabled: any, run: () => this.deleteSelected() },
      {
        label: t('menu.zoomSelection'),
        enabled: any,
        run: () => {
          const b = this.selectionBounds();
          if (b) this.viewport.zoomToFit(b);
        },
      },
    ];
    this.menu.open(x, y, entries);
  }

  /** Typed values after a finished command replace that command's amendable inputs. */
  private amend(text: string): void {
    const target = this.session.amendTarget();
    if (!target) return;
    const def = this.session.registry.get(target.commandId);
    const parsed = parseTypedValues(text, this.session.doc.units.unit);
    const matched = parsed.ok ? matchTypedValues(target.fields, parsed) : null;
    const r = matched?.ok ? this.session.amend(matched.value) : null;
    if (r?.ok) {
      this.status.flash(t('message.amended', { command: def?.title() ?? target.commandId, values: this.amendValuesText() }));
      return;
    }
    if (r && !['amendValueCount', 'amendValueInvalid', 'invalidInput'].includes(r.error.code)) {
      return this.flashError(r.error);
    }
    this.status.flash(def?.amendHint?.() ?? t('error.typeValues', { count: target.fields.length }), true);
  }

  /** Current amendable values, formatted in the file's units. */
  private amendValuesText(): string {
    const target = this.session.amendTarget();
    if (!target) return '';
    const units = this.session.doc.units;
    return target.values
      .map((v, i) => {
        const field = target.fields[i]!;
        if (field.kind === 'count') return t('measure.count', { count: formatNumber(Math.abs(v)) });
        return formatLength(field.mode === 'positive' ? Math.abs(v) : v, units);
      })
      .join(t('measure.listSeparator'));
  }

  /** After a command, show what typing would amend. */
  private showAmendValues(): void {
    if (this.session.canAmend) this.measure.set(this.tool.measurementLabel(), this.amendValuesText());
  }

  private setUnits(unit: LengthUnit, precision: number | null): void {
    this.session.execute('core.setDisplayUnits', { unit, precision: precision ?? defaultPrecision(unit) });
    this.measure.set(this.tool.measurementLabel(), '');
  }

  /* ---------- input ---------- */

  private bindPointer(): void {
    const canvas = this.viewport.canvas;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Middle-drag orbits, as in SketchUp; keep the browser from starting autoscroll.
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      // Ctrl-click on a Mac is a right click.
      const menuButton = e.button === 2 || (e.button === 0 && e.ctrlKey && isMac());
      const navButton = e.button === 1 || menuButton;
      if (navButton || (e.button === 0 && this.tool.navigation)) {
        const mode = navButton ? (e.shiftKey ? 'pan' : 'orbit') : this.tool.navigation!;
        this.nav = { mode, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, menu: menuButton, dragging: !menuButton };
        if (!menuButton) canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      // A click in the viewport starts a new action, so typed values no longer amend the last one.
      // Navigation (middle or right drag, wheel, orbit and pan tools) keeps amending available.
      this.session.clearAmend();
      this.down = { x: e.clientX, y: e.clientY };
      this.viewport.setPointer(e);
      this.tool.down?.(e);
      this.syncMeasureEditable();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (this.nav) {
        if (!this.nav.dragging) {
          if (Math.hypot(e.clientX - this.nav.startX, e.clientY - this.nav.startY) <= DRAG_THRESHOLD) return;
          this.nav.dragging = true;
          canvas.style.cursor = 'grabbing';
        }
        const dx = e.clientX - this.nav.x;
        const dy = e.clientY - this.nav.y;
        this.nav.x = e.clientX;
        this.nav.y = e.clientY;
        if (this.nav.mode === 'orbit') this.viewport.camera.orbit(dx, dy);
        else this.viewport.camera.pan(dx, dy, canvas.clientHeight);
        return;
      }
      this.viewport.setPointer(e);
      this.tool.move?.(e);
    });

    canvas.addEventListener('pointerup', (e) => {
      if (this.nav) {
        const menuClick = this.nav.menu && !this.nav.dragging;
        this.nav = null;
        canvas.style.cursor = this.tool.cursor;
        // A short right click (no drag) opens the menu, unless an operation is in progress.
        if (menuClick && !this.tool.busy()) this.openContextMenu(e);
        return;
      }
      if (this.down) {
        const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > DRAG_THRESHOLD;
        this.down = null;
        if (moved) {
          this.viewport.setPointer(e);
          this.tool.dragEnd?.();
        }
      }
      this.syncMeasureEditable();
    });

    // Double-clicking a group or component with the Select tool opens it for editing.
    canvas.addEventListener('dblclick', (e) => {
      if (this.tool.id !== 'select') return;
      this.viewport.setPointer(e);
      const hit = this.viewport.pick();
      if (hit?.kind === 'instance') this.openContext(hit.id);
    });

    canvas.addEventListener('pointerleave', () => {
      if (this.tool.busy() || this.tool.active?.()) return;
      if (this.selection.hovered) {
        this.selection.hovered = null;
        this.applyHighlights();
      }
      this.viewport.hideMarker();
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.viewport.setPointer(e);
        const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
        const anchor = this.viewport.pickPoint() ?? this.viewport.groundPoint();
        this.viewport.camera.zoomAt(dy, anchor);
        this.viewport.hideMarker();
      },
      { passive: false },
    );
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.target === this.measure.input) return;
      // Leave keys alone while typing a name in the panels.
      if (e.target instanceof HTMLInputElement) return;
      // The open menu handles its own keys.
      if (this.menu.isOpen) return;
      // Leave keys alone in other form controls (the units menu).
      if (e.target instanceof HTMLSelectElement) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        this.redo();
        return;
      }
      if (mod || e.altKey) return;
      if (this.tool.key?.(e)) {
        e.preventDefault();
        return;
      }
      if (MEASURE_START.test(e.key) && this.acceptsTyping()) {
        e.preventDefault();
        this.measure.startTyping(e.key);
        return;
      }
      if (e.key === 'Escape') {
        if (this.tool.busy() || this.tool.active?.()) this.cancel();
        else if (this.hasSelection()) {
          this.clearSelection();
          this.applyHighlights();
          this.measure.set(this.tool.measurementLabel(), '');
          this.status.hint();
        } else if (this.context.length) this.setContext(this.context.slice(0, -1));
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.hasSelection()) {
        e.preventDefault();
        this.deleteSelected();
        return;
      }
      if (e.shiftKey && k === 'z') {
        this.zoomToFit();
        return;
      }
      if (ACTION_SHORTCUTS[k] === 'makeComponent' && !e.shiftKey) {
        e.preventDefault();
        this.makeInstance('component');
        return;
      }
      const id = TOOL_SHORTCUTS[k];
      if (id && !e.shiftKey) {
        e.preventDefault();
        this.setTool(id);
      }
    });
  }
}
