import type { CommandError, CommandSession } from '../commands';
import type { UnitSettings } from '../units';
import type { Highlight, Viewport } from '../viewport';

export type ToolId = 'select' | 'line' | 'rectangle' | 'circle' | 'polygon' | 'pushPull' | 'erase' | 'orbit' | 'pan';

export interface EntityRef {
  kind: 'face' | 'edge';
  id: string;
}

/**
 * Selected faces and edges, and the entity under the pointer. Not part of the
 * document, so not undoable. Selecting one edge of a curve selects the whole
 * curve, so `edges` always holds complete curves.
 */
export interface Selection {
  readonly faces: Set<string>;
  readonly edges: Set<string>;
  hovered: EntityRef | null;
}

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
  /** Handle a key the tool uses itself (arrow keys for axis locks). Returns true when handled. */
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
  /** Value typed into the measurements box. */
  submit?(text: string): void;
  /** Drop any operation in progress. Returns true when something was cancelled. */
  reset(): boolean;
}
