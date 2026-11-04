import {
  createSession,
  cutListSettings,
  defaultComponentName,
  definitionModel,
  documentFromText,
  documentToText,
  newDocument,
  matchTypedValues,
  rootModel,
  showsWoodworking,
  WORKSPACE_STARTERS,
  WORKSPACE_TOOL_GROUPS,
  WORKSPACES,
  type CommandError,
  type CommandSession,
  type MakeInstanceOutput,
  type PushformDocument,
  type ToolGroup,
  type Workspace,
} from './commands';
import { cutList, toCsv } from './cutlist';
import { browserRegion, t, tCount, type MessageKey } from './i18n';
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
  listEdges,
  listFaces,
  solidVolume,
  type Bounds,
  type Model,
  type Point3,
} from './kernel';
import {
  applyPoint,
  multiply,
  definitionBounds,
  determinant,
  dimensionLength,
  getDefinition,
  instanceCount,
  pathDefinition,
  rootDefinition,
  shownBounds,
  tagShown,
  transformBounds,
  union,
  type InstanceId,
} from './scene';
import { baseName, openFile, saveFile, type FileHandle, type FileType } from './files';
import { loadViewSettings, saveAutosave, saveFileState, saveViewSettings, type FileState } from './storage';
import {
  ACTION_SHORTCUTS,
  arrayBeforeCopy,
  createTools,
  isMac,
  selectionMode,
  shortcutFor,
  TOOL_SHORTCUTS,
  type PaintChoice,
  type Selection,
  type Tool,
  type ToolContext,
  type ToolId,
} from './tools';
import { ContextMenu, type MenuEntry } from './ui/contextMenu';
import { EntityInfo, type EntityInfoData, type TagField } from './ui/entityInfo';
import { CutListPanel } from './ui/cutListPanel';
import { NameDialog } from './ui/nameDialog';
import { WorkspaceDialog } from './ui/workspaceDialog';
import { applyTheme, THEMES, type Theme } from './ui/theme';
import { flipMessage } from './ui/messages';
import { MaterialsPanel } from './ui/materialsPanel';
import { TagsPanel } from './ui/tagsPanel';
import { Tray } from './ui/tray';
import { TextEditor } from './ui/textEditor';
import { Outliner } from './ui/outliner';
import { el } from './ui/dom';
import { ICONS } from './ui/icons';
import { Intro } from './ui/intro';
import { MeasurementsBox } from './ui/measurements';
import { StatusBar } from './ui/statusBar';
import { ActionBar, ToolBar, type ToolButtonSpec } from './ui/toolbar';
import { UnitsMenu } from './ui/unitsMenu';
import { defaultPrecision, formatAngle, formatArea, formatLength, formatNumber, formatVolume, parseTypedValues, type LengthUnit } from './units';
import { Viewport, type EdgeHighlight, type Highlight } from './viewport';

/** The .pushform file type, for the open and save dialogs. */
const PUSHFORM_FILE = (): FileType => ({ description: t('file.typePushform'), mime: 'application/json', extension: '.pushform' });

/** Characters that start typing into the measurements box while a tool is busy. */
const MEASURE_START = /^[0-9.,\-٠-٩۰-۹x×*/]$/i;
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
  offsetTooLarge: 'error.offsetTooLarge',
  offsetNotChain: 'error.offsetNotChain',
  moveCrosses: 'error.moveCrosses',
  explodeWouldSkew: 'error.explodeWouldSkew',
  scaleWouldSkew: 'error.scaleWouldSkew',
  scaleTooSmall: 'error.scaleTooSmall',
  arcRadiusTooSmall: 'error.arcRadiusTooSmall',
  tooClose: 'error.tooClose',
  looseGeometryUntagged: 'info.looseUntagged',
  noSuchTag: 'error.noSuchTag',
  noSuchMaterial: 'error.noSuchMaterial',
};

export class App {
  readonly session: CommandSession;
  readonly viewport: Viewport;
  private readonly selection: Selection = {
    faces: new Set(),
    edges: new Set(),
    instances: new Set(),
    guides: new Set(),
    annotations: new Set(),
    hovered: null,
  };
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
  private readonly textEditor: TextEditor;
  /** The open file: its name without extension (null until saved or opened) and where Save writes. */
  private fileName: string | null;
  private fileHandle: FileHandle | null = null;
  /** The document as last saved or opened; null when the current one has never been saved. */
  private savedDoc: PushformDocument | null;
  private readonly fileLabel = el('span', 'file-name');
  private readonly entityInfo: EntityInfo;
  private readonly outliner: Outliner;
  private readonly tags: TagsPanel;
  private readonly materials: MaterialsPanel;
  private readonly tray: Tray;
  /** What the Paint Bucket paints with (the Materials panel chooses it); Default (no paint) to start. */
  private paintChoice: PaintChoice = { materialId: null };
  private readonly cutListPanel: CutListPanel;
  /** Asks for a new component's name, as SketchUp's Create Component. */
  private readonly nameDialog = new NameDialog();
  /** Asks what a new model is for. */
  private readonly workspaceDialog = new WorkspaceDialog();
  private readonly fileButton = el('button', 'file-button', t('file.menu'));
  /** The Cut List button in the top bar, shown in the Woodworking workspace. */
  private readonly cutListButton = el('button', 'file-button', t('cutlist.open'));
  /** The workspace whose panels and tools are shown. */
  private shownWorkspace: Workspace | null = null;
  /** Parts of the chosen cut list row outside the open context, marked with boxes until the selection changes. */
  private marked: (readonly InstanceId[])[] = [];
  /**
   * Navigation in progress. A right-button press only starts orbiting once it
   * moves past DRAG_THRESHOLD; released before that, it opens the menu.
   */
  private nav: { mode: 'orbit' | 'pan'; x: number; y: number; startX: number; startY: number; menu: boolean; dragging: boolean } | null = null;
  private down: { x: number; y: number } | null = null;
  /** Click count of the last press, from the browser (it follows the system's double-click time). */
  private clicks = 1;

  constructor(root: HTMLElement, doc: PushformDocument, file: FileState = { name: null, unsaved: false }) {
    this.session = createSession(doc);
    this.fileName = file.name;
    this.savedDoc = file.unsaved ? null : doc;

    const top = el('header', 'top');
    const brand = el('div', 'brand');
    brand.innerHTML = ICONS.brand;
    brand.append(el('b', undefined, t('app.name')), el('span', undefined, t('app.tagline')));
    const fileButton = this.fileButton;
    fileButton.type = 'button';
    fileButton.setAttribute('aria-haspopup', 'menu');
    fileButton.addEventListener('click', () => {
      const r = fileButton.getBoundingClientRect();
      this.menu.open(r.left, r.bottom + 2, this.fileMenu());
    });
    const viewButton = el('button', 'file-button', t('view.menu'));
    viewButton.type = 'button';
    viewButton.setAttribute('aria-haspopup', 'menu');
    viewButton.addEventListener('click', () => {
      const r = viewButton.getBoundingClientRect();
      this.menu.open(r.left, r.bottom + 2, this.viewMenu());
    });
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
    const cutListButton = this.cutListButton;
    cutListButton.type = 'button';
    cutListButton.addEventListener('click', () => this.setCutListOpen(!this.cutListPanel.open));
    top.append(brand, fileButton, viewButton, cutListButton, this.fileLabel, this.actions.element);

    // Shortcuts come from TOOL_SHORTCUTS (SketchUp defaults); Polygon has none, as in SketchUp.
    const key = (id: ToolId) => {
      const k = shortcutFor(id);
      if (k === null) return {};
      return k === ' ' ? { keyLabel: t('key.spaceSymbol'), keyName: t('key.space') } : { keyLabel: k.toUpperCase(), keyName: k.toUpperCase() };
    };
    // Grouped as in SketchUp's large tool set: select and erase, draw, arcs, edit, construction, view.
    const spec = (id: ToolId, group: ToolGroup): ToolButtonSpec<ToolId> => ({ id, label: `tool.${id}`, icon: id, group, ...key(id) });
    const toolSpecs: ToolButtonSpec<ToolId>[] = [
      spec('select', 'select'),
      spec('erase', 'select'),
      spec('paintBucket', 'select'),
      spec('line', 'draw'),
      spec('rectangle', 'draw'),
      spec('circle', 'draw'),
      spec('polygon', 'draw'),
      spec('arc', 'arcs'),
      spec('centerArc', 'arcs'),
      spec('threePointArc', 'arcs'),
      spec('pie', 'arcs'),
      spec('pushPull', 'edit'),
      spec('offset', 'edit'),
      spec('move', 'edit'),
      spec('rotate', 'edit'),
      spec('scale', 'edit'),
      spec('tape', 'construction'),
      spec('protractor', 'construction'),
      spec('dimension', 'construction'),
      spec('text', 'construction'),
      spec('orbit', 'view'),
      spec('pan', 'view'),
    ];
    this.toolbar = new ToolBar(toolSpecs, (id) => this.setTool(id));

    const view = el('main', 'view');
    view.append(this.intro.element);
    this.cutListPanel = new CutListPanel({
      scene: () => this.session.doc.scene,
      units: () => this.session.doc.units,
      settings: () => cutListSettings(this.session.doc),
      setSettings: (patch) => this.run(this.session.execute('core.setCutListSettings', patch)),
      select: (paths) => this.selectParts(paths),
      showMaterial: (materialId) => this.showMaterial(materialId),
      exportCsv: () => void this.exportCutList(),
      close: () => this.setCutListOpen(false),
      flash: (message, isError) => this.status.flash(message, isError),
    });
    view.append(this.cutListPanel.element, this.nameDialog.element, this.workspaceDialog.element);

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
      setTag: (tagId) => this.tagSelected(tagId),
      setGrain: (definitionId, grain) => this.run(this.session.execute('core.setGrain', { definitionId, grain })),
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
    this.tags = new TagsPanel({
      scene: () => this.session.doc.scene,
      colorByTag: () => this.viewport.colorsByTag,
      add: () => this.run(this.session.execute('core.addTag', {})),
      rename: (tagId, name) => this.run(this.session.execute('core.renameTag', { tagId, name })),
      setColor: (tagId, color) => this.run(this.session.execute('core.setTagColor', { tagId, color })),
      setVisible: (tagId, visible) => this.run(this.session.execute('core.setTagVisible', { tagId, visible })),
      remove: (tagId) => this.run(this.session.execute('core.deleteTag', { tagId })),
      setColorByTag: (on) => this.setColorByTag(on),
    });
    this.materials = new MaterialsPanel({
      scene: () => this.session.doc.scene,
      units: () => this.session.doc.units,
      starters: () => WORKSPACE_STARTERS[this.session.doc.workspace],
      stock: () => showsWoodworking(this.session.doc.workspace),
      current: () => this.paintChoice,
      choose: (choice) => {
        this.setPaintChoice(choice);
        if (this.tool.id !== 'paintBucket') this.setTool('paintBucket');
      },
      add: () => {
        const r = this.session.execute('core.addMaterial', {});
        if (r.ok) this.setPaintChoice({ materialId: r.output.materialId });
      },
      rename: (materialId, name) => this.run(this.session.execute('core.renameMaterial', { materialId, name })),
      setColor: (materialId, color) => this.run(this.session.execute('core.setMaterialColor', { materialId, color })),
      setTexture: (materialId, texture) => this.run(this.session.execute('core.setMaterialTexture', { materialId, texture })),
      setStock: (materialId, stock) => this.run(this.session.execute('core.setMaterialStock', { materialId, stock })),
      duplicate: (materialId) => {
        const r = this.session.execute('core.duplicateMaterial', { materialId });
        if (r.ok) this.setPaintChoice({ materialId: r.output.materialId });
      },
      remove: (materialId) => this.run(this.session.execute('core.deleteMaterial', { materialId })),
      flash: (message, isError) => this.status.flash(message, isError),
    });
    const view0 = loadViewSettings();
    const tray = (this.tray = new Tray(new Set(view0.collapsed), (folded) => saveViewSettings({ ...loadViewSettings(), collapsed: [...folded] })));
    tray.add('entityInfo', this.entityInfo.element);
    tray.add('outliner', this.outliner.element);
    tray.add('tags', this.tags.element);
    tray.add('materials', this.materials.element);

    root.append(top, this.toolbar.element, view, tray.element, footer, this.menu.element);
    this.viewport = new Viewport(view);
    this.textEditor = new TextEditor(view);
    // Highlights are drawn in the theme's colors: draw them again when it changes.
    this.viewport.onThemeChange = () => this.applyHighlights();
    this.viewport.setGuidesVisible(view0.guides);
    this.viewport.setColorByTag(view0.colorByTag);

    this.tools = createTools(this.toolContext());
    this.tool = this.tools.rectangle;

    this.session.subscribe((e) => {
      void saveAutosave(this.session.doc);
      this.syncFile();
      this.refresh();
      if (e.reason === 'execute' || e.reason === 'amend') this.showAmendValues();
      this.syncMeasureEditable();
    });
    this.bindPointer();
    this.bindKeyboard();
    // Closing or reloading with unsaved changes asks first (the autosave still keeps them).
    window.addEventListener('beforeunload', (e) => {
      if (this.unsaved()) e.preventDefault();
    });
    this.syncFile();

    this.refresh();
    this.setTool('rectangle');
    if (!this.isEmpty()) this.zoomToFit();
  }

  /* ---------- state to view ---------- */

  private refresh(): void {
    const doc = this.session.doc;
    // Undo can remove the group or component being edited: close up to what still exists.
    while (this.context.length && !pathDefinition(doc.scene, this.context)) this.context = this.context.slice(0, -1);
    this.syncWorkspace();
    this.viewport.setUnits(doc.units);
    this.viewport.showScene(doc.scene, this.context);
    this.viewport.setSnapTargets(doc.scene);
    const m = this.contextModel();
    const { instances: placed, guides, annotations } = pathDefinition(doc.scene, this.context)!;
    const s = this.selection;
    for (const f of s.faces) if (!hasFace(m, f)) s.faces.delete(f);
    for (const e of s.edges) if (!hasEdge(m, e)) s.edges.delete(e);
    // What a hidden tag hides cannot stay selected.
    const shown = (x: { readonly tag?: string } | undefined) => !!x && tagShown(doc.scene, x.tag);
    for (const i of s.instances) if (!shown(placed.get(i))) s.instances.delete(i);
    for (const g of s.guides) if (!shown(guides.get(g))) s.guides.delete(g);
    for (const a of s.annotations) if (!shown(annotations.get(a))) s.annotations.delete(a);
    const h = s.hovered;
    const exists = h && { face: () => hasFace(m, h.id), edge: () => hasEdge(m, h.id), guide: () => shown(guides.get(h.id)), annotation: () => shown(annotations.get(h.id)), instance: () => shown(placed.get(h.id)) }[h.kind]();
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
    this.viewport.highlightInstances(boxes, this.marked);
    const guides = new Map<string, EdgeHighlight>();
    for (const g of this.selection.guides) guides.set(g, 'selected');
    if (hovered?.kind === 'guide' && !guides.has(hovered.id)) guides.set(hovered.id, kind === 'erase' ? 'erase' : 'hover');
    this.viewport.highlightGuides(guides);
    const dims = new Map<string, EdgeHighlight>();
    for (const a of this.selection.annotations) dims.set(a, 'selected');
    if (hovered?.kind === 'annotation' && !dims.has(hovered.id)) dims.set(hovered.id, kind === 'erase' ? 'erase' : 'hover');
    this.viewport.highlightAnnotations(dims);
    // Every selection change ends here, so the panels follow it.
    this.entityInfo.show(this.entityInfoData());
    this.outliner.sync();
    this.tags.sync();
    // A material undone or deleted cannot stay the Paint Bucket's.
    const c = this.paintChoice;
    if ('materialId' in c && c.materialId !== null && !this.session.doc.scene.materials.has(c.materialId)) this.paintChoice = { materialId: null };
    this.materials.sync();
    this.cutListPanel.sync();
  }

  private setPaintChoice(choice: PaintChoice): void {
    this.paintChoice = choice;
    this.materials.sync();
  }

  /** Flash a command's error; a successful command needs no message here. */
  private run(r: { ok: true } | { ok: false; error: CommandError }): void {
    if (!r.ok) this.flashError(r.error);
  }

  /** What Entity Info shows for the current selection. */
  private entityInfoData(): EntityInfoData {
    const { faces, edges, instances, guides, annotations } = this.selection;
    if (!faces.size && !edges.size && !instances.size && !guides.size && !annotations.size) return { kind: 'none' };
    const doc = this.session.doc;
    const count = (n: number) => formatNumber(n);
    if (annotations.size === 1 && !faces.size && !edges.size && !instances.size && !guides.size) {
      const a = pathDefinition(doc.scene, this.context)?.annotations.get([...annotations][0]!);
      if (a?.kind === 'dimension') return { kind: 'dimension', length: formatLength(dimensionLength(a), doc.units), tag: this.tagField([a]) };
      if (a) return { kind: 'text', text: a.text, tag: this.tagField([a]) };
    }
    if (instances.size) {
      const id = [...instances][0]!;
      const i = pathDefinition(doc.scene, this.context)?.instances.get(id);
      const def = i && doc.scene.definitions.get(i.definitionId);
      if (instances.size === 1 && !faces.size && !edges.size && !guides.size && !annotations.size && i && def && def.kind !== 'root') {
        // Volume is only shown for geometry without nested groups or components.
        // A scaled instance holds that much more (or less): the volume grows with the scale's determinant.
        const local = def.instances.size ? null : solidVolume(def.model);
        const volume = local === null ? null : local * Math.abs(determinant(i.transform));
        const [sx, sy, sz] = i.transform.scale;
        const size = (v: number) => formatNumber(v, 2);
        const scaled = sx !== 1 || sy !== 1 || sz !== 1;
        const even = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) <= 1e-9 * Math.abs(a);
        return {
          kind: 'instance',
          type: def.kind,
          definitionId: def.id,
          instanceId: id,
          definitionName: def.name,
          instanceName: i.name,
          copies: instanceCount(doc.scene, def.id),
          volume: def.instances.size ? null : volume === null ? t('info.notSolid') : formatVolume(volume, doc.units),
          // Red, green and blue are the instance's own x, z and y.
          scale: scaled ? t('info.scaleValue', { red: size(sx), green: size(sz), blue: size(sy) }) : null,
          stretched: !even(sx, sy) || !even(sx, sz),
          tag: this.tagField([i]),
          material: i.material ? (doc.scene.materials.get(i.material)?.name ?? t('materials.default')) : t('materials.default'),
          ...(showsWoodworking(doc.workspace) ? { grain: def.grain ?? null } : {}),
        };
      }
    }
    // Several items: how many of each type, with total area and length of the faces and edges.
    const placed = pathDefinition(doc.scene, this.context)?.instances;
    const kinds = [...instances].map((id) => doc.scene.definitions.get(placed?.get(id)?.definitionId ?? '')?.kind);
    const groups = kinds.filter((k) => k === 'group').length;
    const components = kinds.filter((k) => k === 'component').length;
    const counts = [
      { label: t('info.groups'), count: groups },
      { label: t('info.components'), count: components },
      { label: t('info.faces'), count: faces.size },
      { label: t('info.edges'), count: edges.size },
      { label: t('info.guides'), count: guides.size },
      { label: t('info.dimensions'), count: annotations.size },
    ]
      .filter((c) => c.count > 0)
      .map((c) => ({ label: c.label, count: count(c.count) }));
    const m = this.contextModel();
    const area = faces.size ? formatArea([...faces].reduce((s, f) => s + faceArea(m, f), 0), doc.units) : null;
    const length = edges.size ? formatLength([...edges].reduce((s, e) => s + edgeLength(m, e), 0), doc.units) : null;
    const taggable = this.taggableSelection();
    return {
      kind: 'selection',
      total: count(faces.size + edges.size + instances.size + guides.size + annotations.size),
      counts,
      area,
      length,
      tag: taggable.length ? this.tagField(taggable) : null,
      looseOnly: !taggable.length,
    };
  }

  /** The selected groups, components, guides and annotations: what can carry a tag. */
  private taggableSelection(): { readonly tag?: string }[] {
    const def = pathDefinition(this.session.doc.scene, this.context);
    if (!def) return [];
    const pick = <T>(ids: Iterable<string>, items: ReadonlyMap<string, T>) => [...ids].map((id) => items.get(id)).filter((x): x is T => !!x);
    const { instances, guides, annotations } = this.selection;
    return [...pick(instances, def.instances), ...pick(guides, def.guides), ...pick(annotations, def.annotations)];
  }

  /** The Tag field for some items: their common tag (undefined when they differ) and every tag by name. */
  private tagField(items: readonly { readonly tag?: string }[]): TagField {
    const tags = this.session.doc.scene.tags;
    const first = items[0]?.tag ?? null;
    const options = [...tags].map(([id, x]) => ({ id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return items.every((x) => (x.tag ?? null) === first) ? { value: first, options } : { options };
  }

  /** Ctrl+A: everything in the open context (switching to the Select tool). */
  private selectAll(): void {
    if (this.tool.id !== 'select') this.setTool('select');
    const m = this.contextModel();
    this.clearSelection();
    for (const f of listFaces(m)) this.selection.faces.add(f.id);
    for (const e of listEdges(m)) this.selection.edges.add(e.id);
    const scene = this.session.doc.scene;
    const context = pathDefinition(scene, this.context)!;
    const shown = <T extends { readonly tag?: string }>(items: ReadonlyMap<string, T>) => [...items].filter(([, x]) => tagShown(scene, x.tag)).map(([id]) => id);
    for (const i of shown(context.instances)) this.selection.instances.add(i);
    if (this.viewport.guidesVisible) for (const g of shown(context.guides)) this.selection.guides.add(g);
    for (const a of shown(context.annotations)) this.selection.annotations.add(a);
    this.applyHighlights();
    this.measure.set(this.tool.measurementLabel(), '');
    this.status.hint();
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
    this.marked = [];
    this.selection.faces.clear();
    this.selection.edges.clear();
    this.selection.instances.clear();
    this.selection.guides.clear();
    this.selection.annotations.clear();
    this.selection.hovered = null;
  }

  private hasSelection(): boolean {
    const { faces, edges, instances, guides, annotations } = this.selection;
    return faces.size + edges.size + instances.size + guides.size + annotations.size > 0;
  }

  /** Whether faces, edges, instances, dimensions or text are selected (what grouping acts on). */
  private hasGroupable(): boolean {
    const { faces, edges, instances, annotations } = this.selection;
    return faces.size + edges.size + instances.size + annotations.size > 0;
  }

  private toolContext(): ToolContext {
    return {
      session: this.session,
      paint: { current: () => this.paintChoice, set: (choice) => this.setPaintChoice(choice) },
      viewport: this.viewport,
      selection: this.selection,
      units: () => this.session.doc.units,
      applyHighlights: (kind) => this.applyHighlights(kind),
      showCommitted: () => this.refresh(),
      showPreview: (doc) => this.viewport.showPreviewScene(doc.scene),
      openContext: (id) => this.openContext(id),
      closeContext: (path) => this.setContext(path),
      contextPath: () => this.context,
      setMeasurement: (label, value) => this.measure.set(label, value),
      setMeasurementLabel: (label) => this.measure.setLabel(label),
      editText: (place, text, done) => this.textEditor.open(place, text, done),
      hint: () => {
        this.status.hint();
        this.syncMeasureEditable();
        this.applyCursor();
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
    this.applyCursor();
  }

  /** The tool's cursor, which can change with its state (a plus while Move copies); navigation keeps its own. */
  private applyCursor(): void {
    if (!this.nav) this.viewport.canvas.style.cursor = this.tool.cursor;
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
    if (!this.tools[id].keepsSelection) this.clearSelection();
    this.selection.hovered = null;
    this.applyHighlights();
    this.toolbar.setActive(id);
    this.showIdleMeasurement();
    this.applyCursor();
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
    this.viewport.zoomToFit(shownBounds(scene, this.context));
  }

  private clear(): void {
    const root = rootDefinition(this.session.doc.scene);
    if (this.isEmpty() && !root.guides.size && !root.annotations.size) return;
    this.cancel(true);
    this.clearSelection();
    if (this.session.execute('core.clearModel', {}).ok) this.status.flash(t('message.cleared'));
  }

  /** Erase the selected faces, edges, instances, guides and dimensions in one step. */
  private deleteSelected(): void {
    const faceIds = [...this.selection.faces];
    const edgeIds = [...this.selection.edges];
    const instanceIds = [...this.selection.instances];
    const guideIds = [...this.selection.guides];
    const annotationIds = [...this.selection.annotations];
    if (!this.hasSelection()) return;
    this.clearSelection();
    const r = this.session.execute('core.erase', { definitionId: this.viewport.frame.definitionId, faceIds, edgeIds, instanceIds, guideIds, annotationIds });
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
      annotationIds: [...this.selection.annotations],
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
  /** Make Group at once; Make Component after its name is given (or the suggested Component#n kept). */
  private makeInstance(kind: 'group' | 'component'): void {
    if (!this.hasGroupable()) return this.status.flash(t('error.nothingSelected'), true);
    this.cancel(true);
    if (kind === 'group') return this.finishInstance(kind, this.session.execute('core.makeGroup', this.selectionInput()));
    const keys = { title: 'dialog.componentTitle', field: 'dialog.componentName', action: 'dialog.create' } as const;
    this.nameDialog.open(keys, defaultComponentName(this.session.doc.scene), (name) => {
      if (name !== null) this.finishInstance(kind, this.session.execute('core.makeComponent', { ...this.selectionInput(), name }));
    });
  }

  private finishInstance(kind: 'group' | 'component', r: { ok: true; output: MakeInstanceOutput } | { ok: false; error: CommandError }): void {
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
      if (i) b = union(b, transformBounds(multiply(frame.world, i.transform), definitionBounds(scene, i.definitionId)));
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
      const { edges, faces, instances, guides, annotations } = this.selection;
      const sets = { edge: edges, face: faces, instance: instances, guide: guides, annotation: annotations };
      const set = sets[hit.kind];
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
    const geometry = this.hasGroupable();
    const { instances, faces, edges, guides, annotations } = this.selection;
    const onlyOne = instances.size === 1 && !faces.size && !edges.size && !guides.size && !annotations.size;
    const single = onlyOne ? [...this.selection.instances][0]! : null;
    const singleKind = single ? scene.definitions.get(placed.get(single)?.definitionId ?? '')?.kind : undefined;
    const contextKind = this.context.length ? pathDefinition(scene, this.context)!.kind : undefined;
    const entries: MenuEntry[] = [
      { label: t('menu.makeComponent'), shortcut: t('key.makeComponent'), enabled: geometry, run: () => this.makeInstance('component') },
      { label: t('menu.makeGroup'), enabled: geometry, run: () => this.makeInstance('group') },
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
      { label: t('menu.tag'), enabled: any, run: () => this.tagMenu(x, y) },
      { label: t('menu.paintBack'), enabled: faces.size > 0, run: () => this.paintBack() },
      null,
      { label: t('menu.delete'), shortcut: t('key.delete'), enabled: any, run: () => this.deleteSelected() },
      this.deleteGuidesEntry(),
      ...this.flipEntries(singleKind),
      null,
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

  /** Flip along red, green or blue: a lone group or component along its own axes, as SketchUp words it. */
  private flipEntries(lone: string | undefined): MenuEntry[] {
    const enabled = this.selection.faces.size + this.selection.edges.size + this.selection.instances.size + this.selection.annotations.size > 0;
    const keys = {
      group: ['menu.flipGroupRed', 'menu.flipGroupGreen', 'menu.flipGroupBlue'],
      component: ['menu.flipComponentRed', 'menu.flipComponentGreen', 'menu.flipComponentBlue'],
    } as const;
    const labels = lone === 'group' || lone === 'component' ? keys[lone] : (['menu.flipRed', 'menu.flipGreen', 'menu.flipBlue'] as const);
    return (['red', 'green', 'blue'] as const).map((axis, k) => ({ label: t(labels[k]!), enabled, run: () => this.flipSelected(axis) }));
  }

  private flipSelected(axis: 'red' | 'green' | 'blue'): void {
    this.cancel(true);
    const { faces, edges, instances, annotations } = this.selection;
    const count = faces.size + edges.size + instances.size + annotations.size;
    // A lone group or component flips along its own axis, as the menu said.
    const scene = this.session.doc.scene;
    const only = count === 1 && instances.size === 1 ? pathDefinition(scene, this.context)?.instances.get([...instances][0]!) : undefined;
    const kind = only && scene.definitions.get(only.definitionId)?.kind;
    const lone = kind === 'group' || kind === 'component' ? kind : null;
    const r = this.session.execute('core.flip', { ...this.selectionInput(), axis });
    if (!r.ok) return this.flashError(r.error);
    this.status.flash(flipMessage(axis, lone, count));
    // Loose geometry can come back with new ids when it lands on other geometry.
    this.clearSelection();
    for (const f of r.output.faceIds) this.selection.faces.add(f);
    for (const e of r.output.edgeIds) this.selection.edges.add(e);
    for (const i of r.output.instanceIds) this.selection.instances.add(i);
    for (const a of r.output.annotationIds) this.selection.annotations.add(a);
    this.applyHighlights();
  }

  /** Paint the backs of the selected faces with the Paint Bucket's material (right-click Paint Back). */
  private paintBack(): void {
    const r = this.session.execute('core.paint', { definitionId: this.viewport.frame.definitionId, faceIds: [...this.selection.faces], sides: ['back'], ...this.paintChoice });
    if (!r.ok) return this.flashError(r.error);
    if ('starter' in this.paintChoice) this.setPaintChoice({ materialId: r.output.materialId });
  }

  /* ---------- cut list ---------- */

  private setCutListOpen(on: boolean): void {
    this.cutListPanel.setOpen(on);
    if (!on && this.marked.length) {
      this.marked = [];
      this.applyHighlights();
    }
  }

  /**
   * Select the parts of a cut list row. When they all sit in one group (or the
   * model), that context opens and they are selected; otherwise the context
   * holding most of them, and the others are marked with boxes.
   */
  private selectParts(paths: readonly (readonly InstanceId[])[]): void {
    if (!paths.length) return;
    const parents = new Map<string, (readonly InstanceId[])[]>();
    for (const p of paths) {
      const key = p.slice(0, -1).join('/');
      parents.set(key, [...(parents.get(key) ?? []), p]);
    }
    const [, here] = [...parents].sort((a, b) => b[1].length - a[1].length)[0]!;
    if (this.tool.id !== 'select') this.setTool('select');
    this.setContext(here[0]!.slice(0, -1));
    this.clearSelection();
    for (const p of here) this.selection.instances.add(p.at(-1)!);
    this.marked = paths.filter((p) => !here.includes(p));
    this.applyHighlights();
    const count = formatNumber(here.length);
    this.status.flash(this.marked.length ? t('cutlist.selectedElsewhere', { count, elsewhere: formatNumber(this.marked.length) }) : tCount('cutlist.selected', here.length, count));
  }

  /** Open a material in the Materials panel (from the cut list, to fix its stock thickness), without changing tool. */
  private showMaterial(materialId: string): void {
    this.setPaintChoice({ materialId });
    this.tray.open('materials');
    this.materials.focusThickness();
  }

  /** Save the cut list as CSV. */
  private async exportCutList(): Promise<void> {
    const name = this.fileName ?? t('file.untitled');
    const doc = this.session.doc;
    const settings = cutListSettings(doc);
    const type: FileType = { description: t('file.typeCsv'), mime: 'text/csv', extension: '.csv' };
    try {
      const text = toCsv(cutList(doc.scene, settings), doc.scene, doc.units);
      const r = await saveFile(text, type, `${name}${t('cutlist.fileSuffix')}${type.extension}`);
      if (r) this.status.flash(t('message.exported', { name: r.name }));
    } catch {
      this.status.flash(t('error.fileWrite'), true);
    }
  }

  /* ---------- tags ---------- */

  /** The right-click Tag menu: Untagged and every tag, the selection's own tag greyed. */
  private tagMenu(x: number, y: number): void {
    const items = this.taggableSelection();
    if (!items.length) return this.status.flash(t('info.looseUntagged'));
    const field = this.tagField(items);
    const entry = (id: string | null, label: string): MenuEntry => ({ label, enabled: field.value !== id, run: () => this.tagSelected(id) });
    this.menu.open(x, y, [entry(null, t('tags.untagged')), ...field.options.map((o) => entry(o.id, o.name))]);
  }

  /** Put the selected groups, components, guides and annotations on a tag. Loose geometry stays Untagged, and the status bar says so. */
  private tagSelected(tagId: string | null): void {
    const { faces, edges, instances, guides, annotations } = this.selection;
    const r = this.session.execute('core.setTag', {
      definitionId: this.viewport.frame.definitionId,
      instanceIds: [...instances],
      guideIds: [...guides],
      annotationIds: [...annotations],
      faceIds: [...faces],
      edgeIds: [...edges],
      tagId,
    });
    if (!r.ok) return r.error.code === 'looseGeometryUntagged' ? this.status.flash(t('info.looseUntagged')) : this.flashError(r.error);
    if (r.output.looseSkipped) this.status.flash(t('info.looseUntagged'));
  }

  /** Color faces by their tag on this device. */
  private setColorByTag(on: boolean): void {
    this.viewport.setColorByTag(on);
    saveViewSettings({ ...loadViewSettings(), colorByTag: on });
    this.applyHighlights();
  }

  /* ---------- view ---------- */

  private viewMenu(): MenuEntry[] {
    const shown = this.viewport.guidesVisible;
    const byTag = this.viewport.colorsByTag;
    return [
      { label: t(shown ? 'view.hideGuides' : 'view.showGuides'), enabled: true, run: () => this.setGuidesVisible(!shown) },
      this.deleteGuidesEntry(),
      null,
      { label: t(byTag ? 'view.plainColors' : 'view.colorByTag'), enabled: true, run: () => this.setColorByTag(!byTag) },
      null,
      ...THEMES.map((theme): MenuEntry => ({ label: t(`view.theme.${theme}`), enabled: true, checked: theme === loadViewSettings().theme, run: () => this.setTheme(theme) })),
      ...(showsWoodworking(this.session.doc.workspace)
        ? [null, { label: t(this.cutListPanel.open ? 'cutlist.hide' : 'cutlist.open'), enabled: true, run: () => this.setCutListOpen(!this.cutListPanel.open) }]
        : []),
    ];
  }

  /** Light, Dark or the system's theme, on this device. */
  private setTheme(theme: Theme): void {
    saveViewSettings({ ...loadViewSettings(), theme });
    applyTheme(document.documentElement, theme);
  }

  private deleteGuidesEntry(): MenuEntry {
    const count = pathDefinition(this.session.doc.scene, this.context)?.guides.size ?? 0;
    return { label: t('menu.deleteGuides'), enabled: count > 0, run: () => this.deleteGuides() };
  }

  /** Show or hide guides on this device; hidden guides cannot be selected, so they leave the selection. */
  private setGuidesVisible(on: boolean): void {
    this.viewport.setGuidesVisible(on);
    saveViewSettings({ ...loadViewSettings(), guides: on });
    if (!on) {
      this.selection.guides.clear();
      if (this.selection.hovered?.kind === 'guide') this.selection.hovered = null;
      this.applyHighlights();
    }
  }

  /** Delete every guide of the open editing context in one step. */
  private deleteGuides(): void {
    this.cancel(true);
    const r = this.session.execute('core.deleteGuides', { definitionId: this.viewport.frame.definitionId });
    if (!r.ok) return this.flashError(r.error);
    if (r.output.count) this.status.flash(t('message.guidesDeleted', { count: formatNumber(r.output.count) }));
  }

  /* ---------- files ---------- */

  private unsaved(): boolean {
    return this.session.doc !== this.savedDoc;
  }

  /** The file name and unsaved marker in the top bar and the window title; remembered for recovery. */
  private syncFile(): void {
    const name = this.fileName ?? t('file.untitled');
    const unsaved = this.unsaved();
    const marker = unsaved ? t('file.unsavedMarker') : '';
    this.fileLabel.textContent = `${name}${marker}`;
    this.fileLabel.title = unsaved ? t('file.unsaved') : '';
    document.title = t('file.windowTitle', { name, marker });
    saveFileState({ name: this.fileName, unsaved });
  }

  private fileMenu(): MenuEntry[] {
    return [
      { label: t('file.new'), shortcut: t('key.new'), enabled: true, run: () => this.newFile() },
      { label: t('file.open'), shortcut: t('key.open'), enabled: true, run: () => void this.openFile() },
      { label: t('file.save'), shortcut: t('key.save'), enabled: true, run: () => void this.saveFile(false) },
      { label: t('file.saveAs'), shortcut: t('key.saveAs'), enabled: true, run: () => void this.saveFile(true) },
      null,
      { label: t('file.workspace', { name: t(`workspace.${this.session.doc.workspace}`) }), enabled: true, run: () => this.workspaceMenu() },
      null,
      { label: t('file.exportStl'), enabled: !this.isEmpty(), run: () => void this.exportFile('stl') },
      { label: t('file.exportGlb'), enabled: !this.isEmpty(), run: () => void this.exportFile('glb') },
    ];
  }

  /** Unsaved changes are only dropped when the user agrees. */
  private discardOk(): boolean {
    return !this.unsaved() || window.confirm(t('file.discard', { name: this.fileName ?? t('file.untitled') }));
  }

  /** Show a document that replaces the current one: no history, no editing context, no selection. */
  private replaceDocument(doc: PushformDocument, name: string | null, handle: FileHandle | null): void {
    this.cancel(true);
    this.context = [];
    this.clearSelection();
    this.fileName = name;
    this.fileHandle = handle;
    this.savedDoc = doc;
    this.session.load(doc);
    this.zoomToFit();
  }

  /** A new model, for the workspace the user picks (the last one picked comes first). */
  private newFile(): void {
    if (!this.discardOk()) return;
    this.cancel(true);
    this.workspaceDialog.open(loadViewSettings().workspace ?? 'woodworking', (workspace) => {
      if (!workspace) return;
      saveViewSettings({ ...loadViewSettings(), workspace });
      this.replaceDocument(newDocument(workspace, browserRegion()), null, null);
      this.status.flash(t('message.newFile'));
    });
  }

  /**
   * The first run asks once what models are for; the empty model it starts
   * with is replaced by one for that workspace. Cancelling keeps General.
   */
  askFirstWorkspace(): void {
    this.workspaceDialog.open('woodworking', (chosen) => {
      const workspace = chosen ?? 'general';
      saveViewSettings({ ...loadViewSettings(), workspace });
      if (workspace !== this.session.doc.workspace) this.replaceDocument(newDocument(workspace, browserRegion()), null, null);
    });
  }

  /** File > Workspace: the three workspaces, the file's own greyed. Switching keeps everything in the file. */
  private workspaceMenu(): void {
    const r = this.fileButton.getBoundingClientRect();
    const current = this.session.doc.workspace;
    this.menu.open(
      r.left,
      r.bottom + 2,
      WORKSPACES.map((w) => ({
        label: t(`workspace.${w}`),
        enabled: w !== current,
        run: () => {
          const res = this.session.execute('core.setWorkspace', { workspace: w });
          if (!res.ok) return this.flashError(res.error);
          this.status.flash(t('message.workspace', { name: t(`workspace.${w}`) }));
        },
      })),
    );
  }

  /** Show the panels, tools and buttons of the file's workspace; the Cut List closes outside Woodworking. */
  private syncWorkspace(): void {
    const workspace = this.session.doc.workspace;
    if (workspace === this.shownWorkspace) return;
    this.shownWorkspace = workspace;
    const woodworking = showsWoodworking(workspace);
    this.cutListButton.hidden = !woodworking;
    if (!woodworking && this.cutListPanel.open) this.setCutListOpen(false);
    this.toolbar.showGroups(WORKSPACE_TOOL_GROUPS[workspace]);
  }

  private async openFile(): Promise<void> {
    if (!this.discardOk()) return;
    try {
      const f = await openFile(PUSHFORM_FILE());
      if (!f) return;
      const doc = documentFromText(f.text);
      if (!doc) return this.status.flash(t('error.fileInvalid'), true);
      this.replaceDocument(doc, baseName(f.name), f.handle);
      this.status.flash(t('message.opened', { name: f.name }));
    } catch {
      this.status.flash(t('error.fileRead'), true);
    }
  }

  /** Save to the open file, or ask where (Save As, or a model never saved). */
  private async saveFile(as: boolean): Promise<void> {
    const doc = this.session.doc;
    try {
      const r = await saveFile(documentToText(doc), PUSHFORM_FILE(), `${this.fileName ?? t('file.untitled')}.pushform`, as ? null : this.fileHandle);
      if (!r) return;
      this.fileName = baseName(r.name);
      this.fileHandle = r.handle;
      this.savedDoc = doc;
      this.syncFile();
      this.status.flash(t('message.saved', { name: r.name }));
    } catch {
      this.status.flash(t('error.fileWrite'), true);
    }
  }

  /** STL (mm, Z up) or GLB (meters, Y up) of the whole model, groups and components placed. */
  private async exportFile(kind: 'stl' | 'glb'): Promise<void> {
    const name = this.fileName ?? t('file.untitled');
    const scene = this.session.doc.scene;
    const type: FileType =
      kind === 'stl'
        ? { description: t('file.typeStl'), mime: 'model/stl', extension: '.stl' }
        : { description: t('file.typeGlb'), mime: 'model/gltf-binary', extension: '.glb' };
    try {
      // Loaded on first use, to keep the main bundle small.
      const { exportGlb, exportStl } = await import('./export');
      const data = kind === 'stl' ? exportStl(scene) : exportGlb(scene, name);
      const r = await saveFile(data, type, `${name}${type.extension}`);
      if (r) this.status.flash(t('message.exported', { name: r.name }));
    } catch {
      this.status.flash(t('error.fileWrite'), true);
    }
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
      // A moved or copied selection follows the amend (copies of loose geometry get new ids).
      const out = r.output as { faceIds?: string[]; edgeIds?: string[]; instanceIds?: string[] };
      if (['core.move', 'core.moveCopies', 'core.rotate', 'core.rotateCopies', 'core.scale'].includes(target.commandId)) {
        this.clearSelection();
        for (const f of out.faceIds ?? []) this.selection.faces.add(f);
        for (const e of out.edgeIds ?? []) this.selection.edges.add(e);
        for (const i of out.instanceIds ?? []) this.selection.instances.add(i);
        this.applyHighlights();
      }
      this.status.flash(t('message.amended', { command: def?.title() ?? target.commandId, values: this.amendValuesText() }));
      return;
    }
    if (r && !['amendValueCount', 'amendValueInvalid', 'invalidInput'].includes(r.error.code)) {
      return this.flashError(r.error);
    }
    // An array after a plain move or rotation: it needs a copy to repeat.
    const early = ['core.move', 'core.rotate'].includes(target.commandId) ? arrayBeforeCopy(text, this.session.doc.units.unit) : null;
    if (early) return this.status.flash(early, true);
    this.status.flash(def?.amendHint?.() ?? t('error.typeValues', { count: target.fields.length }), true);
  }

  /** Current amendable values, formatted in the file's units. */
  private amendValuesText(): string {
    const target = this.session.amendTarget();
    if (!target) return '';
    const units = this.session.doc.units;
    return target.values
      .map((v, i): string | null => {
        const field = target.fields[i]!;
        // An optional value not given (an arc's radius), or one another value replaces (its bulge).
        if (v === undefined || (field.clears && target.input[field.clears] !== undefined)) return null;
        if (field.kind === 'radius') return t('measure.radiusValue', { length: formatLength(Math.abs(v), units) });
        if (field.kind === 'count') return t('measure.count', { count: formatNumber(Math.abs(v)) });
        if (field.kind === 'angle') return formatAngle(v);
        if (field.kind === 'factor') return formatNumber(v, 2);
        if (field.kind === 'array') {
          const divide = field.flag !== undefined && target.input[field.flag] === true;
          return t(divide ? 'measure.divide' : 'measure.multiply', { count: formatNumber(Math.abs(v)) });
        }
        return formatLength(field.mode === 'positive' ? Math.abs(v) : v, units);
      })
      .filter((s) => s !== null)
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
      this.clicks = 1;
      // A click in the viewport starts a new action, so typed values no longer amend the last one.
      // Navigation (middle or right drag, wheel, orbit and pan tools) keeps amending available.
      this.session.clearAmend();
      this.down = { x: e.clientX, y: e.clientY };
      this.viewport.setPointer(e);
      this.tool.down?.(e);
      this.syncMeasureEditable();
    });

    // Mouse events after pointerdown carry the click count; pointer events do not.
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.clicks = Math.max(1, e.detail);
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
        this.applyCursor();
        // A short right click (no drag) opens the menu, unless an operation is in progress.
        if (menuClick && !this.tool.busy()) this.openContextMenu(e);
        return;
      }
      if (this.down) {
        const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > DRAG_THRESHOLD;
        this.down = null;
        this.viewport.setPointer(e);
        if (moved) this.tool.dragEnd?.();
        this.tool.up?.(e, moved, this.clicks);
      }
      this.syncMeasureEditable();
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
      // Leave keys alone while typing a name in the panels or a text in place.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // The open menu handles its own keys.
      if (this.menu.isOpen) return;
      // Ctrl (Option on a Mac) pressed on its own goes to the tool: Move toggles copying with it.
      if (e.key === (isMac() ? 'Alt' : 'Control') && !e.repeat) {
        if (this.tool.key?.(e)) e.preventDefault();
        return;
      }
      // Leave keys alone in other form controls (the units menu).
      if (e.target instanceof HTMLSelectElement) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      // Ctrl+N reaches the page only where the browser allows it (an installed app, for one).
      if (mod && (k === 's' || k === 'o' || k === 'n')) {
        e.preventDefault();
        if (k === 's') void this.saveFile(e.shiftKey);
        else if (k === 'o') void this.openFile();
        else this.newFile();
        return;
      }
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
      if (mod && k === 'a' && !e.shiftKey) {
        e.preventDefault();
        this.selectAll();
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
