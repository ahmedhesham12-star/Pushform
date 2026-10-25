import { createSession, type CommandError, type CommandSession, type PushformDocument } from './commands';
import { t, type MessageKey } from './i18n';
import { bounds, faceCount, hasFace, snapPoints } from './kernel';
import { saveAutosave } from './storage';
import { createTools, type Selection, type Tool, type ToolContext, type ToolId } from './tools';
import { el } from './ui/dom';
import { ICONS } from './ui/icons';
import { Intro } from './ui/intro';
import { MeasurementsBox } from './ui/measurements';
import { StatusBar } from './ui/statusBar';
import { ActionBar, ToolBar, type ToolButtonSpec } from './ui/toolbar';
import { UnitsMenu } from './ui/unitsMenu';
import { defaultPrecision, formatLength, parseLengthList, type LengthUnit } from './units';
import { Viewport, type Highlight } from './viewport';

/** Keys that switch tools (with no modifier). */
const TOOL_KEYS: Record<string, ToolId> = { r: 'rectangle', p: 'pushPull', e: 'erase', o: 'orbit', h: 'pan' };
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
  private readonly selection: Selection = { selected: null, hovered: null };
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
      { id: 'rectangle', label: 'tool.rectangle', icon: 'rectangle', keyLabel: 'R', keyName: 'R' },
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
        if (this.tool.busy() && this.tool.submit) this.tool.submit(text);
        else if (this.session.canAmend) this.amend(text);
        else this.status.flash(t('error.nothingToSize'), true);
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
    });
    this.bindPointer();
    this.bindKeyboard();

    this.refresh();
    this.setTool('rectangle');
    if (faceCount(this.session.doc.model)) this.zoomToFit();
  }

  /* ---------- state to view ---------- */

  private refresh(): void {
    const doc = this.session.doc;
    this.viewport.setUnits(doc.units);
    this.viewport.showModel(doc.model);
    this.viewport.setSnapPoints(snapPoints(doc.model));
    if (this.selection.selected && !hasFace(doc.model, this.selection.selected)) this.selection.selected = null;
    if (this.selection.hovered && !hasFace(doc.model, this.selection.hovered)) this.selection.hovered = null;
    this.applyHighlights();
    this.intro.setVisible(faceCount(doc.model) === 0);
    this.actions.setHistory(this.session.canUndo, this.session.canRedo);
    this.unitsMenu.sync(doc.units);
  }

  private applyHighlights(hoverKind?: Highlight): void {
    const { selected, hovered } = this.selection;
    this.viewport.paintAll('normal');
    if (selected) this.viewport.paint(selected, 'selected');
    if (hovered && hovered !== selected) {
      this.viewport.paint(hovered, hoverKind ?? (this.tool.id === 'erase' ? 'erase' : 'hover'));
    }
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
      hint: () => this.status.hint(),
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
    if (hadOperation && !quiet) this.refresh();
    this.status.hint();
  }

  setTool(id: ToolId): void {
    this.session.clearAmend();
    this.cancel();
    this.tool = this.tools[id];
    if (id !== 'select') this.selection.selected = null;
    this.selection.hovered = null;
    this.applyHighlights();
    this.toolbar.setActive(id);
    this.measure.set(this.tool.measurementLabel(), '');
    this.viewport.canvas.style.cursor = this.tool.cursor;
    this.status.hint();
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
    if (!faceCount(this.session.doc.model)) return;
    this.cancel(true);
    this.selection.selected = this.selection.hovered = null;
    if (this.session.execute('core.clearModel', {}).ok) this.status.flash(t('message.cleared'));
  }

  private deleteSelected(): void {
    const faceId = this.selection.selected;
    if (!faceId) return;
    this.selection.selected = this.selection.hovered = null;
    const r = this.session.execute('core.deleteFace', { faceId });
    if (r.ok) this.status.flash(t('message.erased'));
    else this.flashError(r.error);
  }

  /** Typed values after a finished command replace that command's amendable inputs. */
  private amend(text: string): void {
    const target = this.session.amendTarget();
    if (!target) return;
    const parsed = parseLengthList(text, this.session.doc.units.unit);
    const r = parsed.ok ? this.session.amend(parsed.mm) : null;
    if (r?.ok) {
      const title = this.session.registry.get(target.commandId)?.title() ?? target.commandId;
      this.status.flash(t('message.amended', { command: title, values: this.amendValuesText() }));
      return;
    }
    if (r && !['amendValueCount', 'amendValueInvalid', 'invalidInput'].includes(r.error.code)) {
      return this.flashError(r.error);
    }
    const count = target.fields.length;
    const key: MessageKey = count === 1 ? 'error.typeOneDistance' : count === 2 ? 'error.typeTwoSizes' : 'error.typeValues';
    this.status.flash(t(key, { count }), true);
  }

  /** Current amendable values, formatted in the file's units. */
  private amendValuesText(): string {
    const target = this.session.amendTarget();
    if (!target) return '';
    const units = this.session.doc.units;
    return target.values
      .map((v, i) => formatLength(target.fields[i]!.mode === 'positive' ? Math.abs(v) : v, units))
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
    });

    canvas.addEventListener('pointerleave', () => {
      if (this.tool.busy()) return;
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
      if (MEASURE_START.test(e.key) && (this.tool.busy() || this.session.canAmend)) {
        e.preventDefault();
        this.measure.startTyping(e.key);
        return;
      }
      if (e.key === 'Escape') {
        if (this.tool.busy()) this.cancel();
        else if (this.selection.selected) {
          this.selection.selected = null;
          this.applyHighlights();
          this.status.hint();
        }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection.selected) {
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
