import type { CommandError, CommandSession } from '../commands';
import type { UnitSettings } from '../units';
import type { Highlight, Viewport } from '../viewport';

export type ToolId = 'select' | 'rectangle' | 'pushPull' | 'erase' | 'orbit' | 'pan';

/** Selected and hovered faces. Not part of the document, so not undoable. */
export interface Selection {
  selected: string | null;
  hovered: string | null;
}

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
  down?(e: PointerEvent): void;
  move?(e: PointerEvent): void;
  /** Pointer released after dragging: click-drag-release finishes like a second click. */
  dragEnd?(): void;
  /** Value typed into the measurements box. */
  submit?(text: string): void;
  /** Drop any operation in progress. Returns true when something was cancelled. */
  reset(): boolean;
}
