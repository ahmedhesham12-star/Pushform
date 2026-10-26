import type { CommandError, CommandSession, PushformDocument } from '../commands';
import type { InstanceId } from '../scene';
import type { UnitSettings } from '../units';
import type { Highlight, Picked, Viewport } from '../viewport';

export type ToolId = 'select' | 'move' | 'rotate' | 'line' | 'rectangle' | 'circle' | 'polygon' | 'pushPull' | 'offset' | 'erase' | 'orbit' | 'pan';

export interface EntityRef {
  kind: 'face' | 'edge' | 'instance';
  id: string;
}

/**
 * Selected faces, edges and instances of the editing context, and the entity
 * under the pointer. Not part of the document, so not undoable. Selecting one
 * edge of a curve selects the whole curve, so `edges` always holds complete
 * curves.
 */
export interface Selection {
  readonly faces: Set<string>;
  readonly edges: Set<string>;
  readonly instances: Set<InstanceId>;
  hovered: EntityRef | null;
}

/** What hovering a picked entity highlights; geometry outside the editing context is not highlighted. */
export const entityOf = (hit: Picked | null): EntityRef | null => (hit && hit.kind !== 'outside' ? { kind: hit.kind, id: hit.id } : null);

export const sameEntity = (a: EntityRef | null, b: EntityRef | null) =>
  a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);

/** What a tool can reach. Tools change the model only through `session`. */
export interface ToolContext {
  readonly session: CommandSession;
  readonly viewport: Viewport;
  readonly selection: Selection;
  units(): UnitSettings;
  /** Repaint face highlights from the selection. */
  applyHighlights(hoverKind?: Highlight): void;
  /** Show the committed model again (after a preview). */
  showCommitted(): void;
  /** Show a document a command preview produced, in the same editing context. */
  showPreview(doc: PushformDocument): void;
  /** Open a group or component placed in the current context for editing. */
  openContext(instanceId: InstanceId): void;
  /** Close editing contexts until `path` is the open one ([] is the root). */
  closeContext(path: readonly InstanceId[]): void;
  /** The open editing context, as an instance path ([] is the root). */
  contextPath(): readonly InstanceId[];
  setMeasurement(label: string, value: string): void;
  /** Re-show the active tool's status hint. */
  hint(): void;
  flash(message: string, isError?: boolean): void;
  flashError(error: CommandError): void;
  /** End the current operation; clears previews, marker and the measurements box. */
  cancel(quiet?: boolean): void;
}

export interface Tool {
  readonly id: ToolId;
  readonly cursor: string;
  /** For orbit and pan: left-drag navigates instead of calling the tool. */
  readonly navigation?: 'orbit' | 'pan';
  /** The tool works on the selection (Select, Move), so switching to it keeps it. */
  readonly keepsSelection?: boolean;
  hint(): string;
  /** Label for the measurements box while this tool is active. */
  measurementLabel(): string;
  /** True while an operation is in progress (typing goes to the measurements box). */
  busy(): boolean;
  /**
   * True while the tool holds state that Esc should end, even if it is not
   * busy (a line chain between segments, where typing amends the last one).
   */
  active?(): boolean;
  /**
   * Handle a key the tool uses itself (arrow keys for axis locks; Ctrl or
   * Option pressed on its own, to toggle copying). Returns true when handled.
   */
  key?(e: KeyboardEvent): boolean;
  /**
   * True when the tool takes typed input even with no operation in progress,
   * like a segment count typed before drawing a circle. Amending the last
   * operation still comes first.
   */
  acceptsInput?(): boolean;
  /** Value shown in the measurements box while the tool is idle, like "24s". */
  idleMeasurement?(): string;
  down?(e: PointerEvent): void;
  move?(e: PointerEvent): void;
  /** Pointer released after dragging: click-drag-release finishes like a second click. */
  dragEnd?(): void;
  /**
   * Left button released, after a drag (moved past the drag threshold) or not.
   * `clicks` counts quick presses at one spot (2 for a double-click), using
   * the system's double-click time.
   */
  up?(e: PointerEvent, dragged: boolean, clicks: number): void;
  /** Value typed into the measurements box. */
  submit?(text: string): void;
  /** Drop any operation in progress. Returns true when something was cancelled. */
  reset(): boolean;
}
