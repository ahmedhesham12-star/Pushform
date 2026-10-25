import { createSession, matchTypedValues, type CommandError, type CommandSession, type PushformDocument } from './commands';
import { t, type MessageKey } from './i18n';
import { bounds, edgeCount, edgeGroup, faceCount, hasEdge, hasFace, snapPoints } from './kernel';
import { saveAutosave } from './storage';
import { createTools, type Selection, type Tool, type ToolContext, type ToolId } from './tools';
import { el } from './ui/dom';
import { ICONS } from './ui/icons';
import { Intro } from './ui/intro';
import { MeasurementsBox } from './ui/measurements';
import { StatusBar } from './ui/statusBar';
import { ActionBar, ToolBar, type ToolButtonSpec } from './ui/toolbar';
import { UnitsMenu } from './ui/unitsMenu';
import { defaultPrecision, formatLength, formatNumber, parseTypedValues, type LengthUnit } from './units';
import { Viewport, type EdgeHighlight, type Highlight } from './viewport';

/** Keys that switch tools (with no modifier). */
const TOOL_KEYS: Record<string, ToolId> = {
  l: 'line',
  r: 'rectangle',
  c: 'circle',
  g: 'polygon',
  p: 'pushPull',
  e: 'erase',
  o: 'orbit',
  h: 'pan',
};
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
};

export class App {
  readonly session: CommandSession;
  readonly viewport: Viewport;
  private readonly selection: Selection = { faces: new Set(), edges: new Set(), hovered: null };
  private readonly tools: Record<ToolId, Tool>;
  private tool: Tool;
  private readonly status: StatusBar;
  private readonly measure: MeasurementsBox;
  private readonly toolbar: ToolBar<ToolId>;
  private readonly actions: ActionBar;
  private readonly unitsMenu: UnitsMenu;
  private readonly intro = new Intro();
  private nav: { mode: 'orbit' | 'pan'; x: number; y: number } | null = null;
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

    const toolSpecs: ToolButtonSpec<ToolId>[] = [
      { id: 'select', label: 'tool.select', icon: 'select', keyLabel: t('key.spaceSymbol'), keyName: t('key.space') },
      { id: 'line', label: 'tool.line', icon: 'line', keyLabel: 'L', keyName: 'L' },
      { id: 'rectangle', label: 'tool.rectangle', icon: 'rectangle', keyLabel: 'R', keyName: 'R' },
      { id: 'circle', label: 'tool.circle', icon: 'circle', keyLabel: 'C', keyName: 'C' },
      { id: 'polygon', label: 'tool.polygon', icon: 'polygon', keyLabel: 'G', keyName: 'G' },
      { id: 'pushPull', label: 'tool.pushPull', icon: 'pushPull', keyLabel: 'P', keyName: 'P' },
      { id: 'erase', label: 'tool.erase', icon: 'erase', keyLabel: 'E', keyName: 'E' },
      { id: 'orbit', label: 'tool.orbit', icon: 'orbit', keyLabel: 'O', keyName: 'O', group: true },
      { id: 'pan', label: 'tool.pan', icon: 'pan', keyLabel: 'H', keyName: 'H' },
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

    root.append(top, this.toolbar.element, view, footer);
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
    this.viewport.setUnits(doc.units);
    this.viewport.showModel(doc.model);
    this.viewport.setSnapPoints(snapPoints(doc.model));
    const s = this.selection;
    for (const f of s.faces) if (!hasFace(doc.model, f)) s.faces.delete(f);
    for (const e of s.edges) if (!hasEdge(doc.model, e)) s.edges.delete(e);
    const h = s.hovered;
    if (h && !(h.kind === 'face' ? hasFace(doc.model, h.id) : hasEdge(doc.model, h.id))) s.hovered = null;
    this.applyHighlights();
    this.intro.setVisible(this.isEmpty());
    this.actions.setHistory(this.session.canUndo, this.session.canRedo);
    this.unitsMenu.sync(doc.units);
  }

  private applyHighlights(hoverKind?: Highlight): void {
    const { faces, edges, hovered } = this.selection;
    const kind = hoverKind ?? (this.tool.id === 'erase' ? 'erase' : 'hover');
    this.viewport.paintAll('normal');
    for (const f of faces) this.viewport.paint(f, 'selected');
    const lines = new Map<string, EdgeHighlight>();
    for (const e of edges) lines.set(e, 'selected');
    if (hovered?.kind === 'face' && !faces.has(hovered.id)) this.viewport.paint(hovered.id, kind);
    if (hovered?.kind === 'edge') {
      // Hovering one segment of a curve highlights the whole curve.
      const edgeKind: EdgeHighlight = kind === 'erase' ? 'erase' : 'hover';
      for (const e of edgeGroup(this.session.doc.model, hovered.id)) if (!edges.has(e)) lines.set(e, edgeKind);
    }
    this.viewport.highlightEdges(lines);
  }

  private clearSelection(): void {
    this.selection.faces.clear();
    this.selection.edges.clear();
    this.selection.hovered = null;
  }

  private toolContext(): ToolContext {
    return {
      session: this.session,
      viewport: this.viewport,
      selection: this.selection,
      units: () => this.session.doc.units,
      applyHighlights: (kind) => this.applyHighlights(kind),
      showCommitted: () => this.refresh(),
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
    this.viewport.zoomToFit(bounds(this.session.doc.model));
  }

  private clear(): void {
    if (this.isEmpty()) return;
    this.cancel(true);
    this.clearSelection();
    if (this.session.execute('core.clearModel', {}).ok) this.status.flash(t('message.cleared'));
  }

  /** Erase the selected faces and edges in one step. */
  private deleteSelected(): void {
    const faceIds = [...this.selection.faces];
    const edgeIds = [...this.selection.edges];
    if (!faceIds.length && !edgeIds.length) return;
    this.clearSelection();
    const r = this.session.execute('core.erase', { faceIds, edgeIds });
    if (r.ok) this.status.flash(t('message.erased'));
    else this.flashError(r.error);
  }

  private isEmpty(): boolean {
    const m = this.session.doc.model;
    return faceCount(m) === 0 && edgeCount(m) === 0;
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

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const navButton = e.button === 1 || e.button === 2;
      if (navButton || (e.button === 0 && this.tool.navigation)) {
        const mode = navButton ? (e.shiftKey ? 'pan' : 'orbit') : this.tool.navigation!;
        this.nav = { mode, x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      // A click in the viewport starts a new action, so typed values no longer amend the last one.
      // Navigation (right-drag, wheel, orbit and pan tools) keeps amending available.
      this.session.clearAmend();
      this.down = { x: e.clientX, y: e.clientY };
      this.viewport.setPointer(e);
      this.tool.down?.(e);
      this.syncMeasureEditable();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (this.nav) {
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
        this.nav = null;
        canvas.style.cursor = this.tool.cursor;
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
        const hit = this.viewport.pickFace();
        const anchor = hit ? hit.point : this.viewport.groundPoint();
        this.viewport.camera.zoomAt(dy, anchor);
        this.viewport.hideMarker();
      },
      { passive: false },
    );
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.target === this.measure.input) return;
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
        else if (this.selection.faces.size || this.selection.edges.size) {
          this.clearSelection();
          this.applyHighlights();
          this.measure.set(this.tool.measurementLabel(), '');
          this.status.hint();
        }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && (this.selection.faces.size || this.selection.edges.size)) {
        e.preventDefault();
        this.deleteSelected();
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        this.setTool('select');
        return;
      }
      if (e.shiftKey && k === 'z') {
        this.zoomToFit();
        return;
      }
      const id = TOOL_KEYS[k];
      if (id && !e.shiftKey) this.setTool(id);
    });
  }
}
