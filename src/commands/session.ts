import type { PushformDocument } from './document';
import type { CommandRegistry } from './registry';
import type { CommandError, CommandId, InputOf, OutputOf } from './types';

export type Outcome<O> = { ok: true; output: O; changed: boolean } | { ok: false; error: CommandError };
export type PreviewOutcome<O> = { ok: true; doc: PushformDocument; output: O } | { ok: false; error: CommandError };

/** One undoable step. The command and input are kept for logs, macros and replay. */
export interface HistoryEntry {
  readonly commandId: string;
  readonly input: unknown;
  readonly before: PushformDocument;
  readonly after: PushformDocument;
}

export type ChangeReason = 'execute' | 'undo' | 'redo' | 'load';
export interface ChangeEvent {
  reason: ChangeReason;
  commandId?: string;
}
export type ChangeListener = (event: ChangeEvent) => void;

export const HISTORY_LIMIT = 150;

/**
 * Owns the current document and its undo history. Every model change goes
 * through execute(); undo and redo restore document snapshots, which is cheap
 * because documents share unchanged data.
 */
export class CommandSession {
  private current: PushformDocument;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly listeners = new Set<ChangeListener>();

  constructor(
    readonly registry: CommandRegistry,
    doc: PushformDocument,
  ) {
    this.current = doc;
  }

  get doc(): PushformDocument {
    return this.current;
  }

  /** Run a command with typed input and record it for undo when it changed the document. */
  execute<K extends CommandId>(id: K, input: InputOf<K>): Outcome<OutputOf<K>> {
    return this.executeUnchecked(id, input) as Outcome<OutputOf<K>>;
  }

  /** Run a command by id with untrusted input (plugins, MCP, replay). Input is always validated. */
  executeUnchecked(id: string, input: unknown): Outcome<unknown> {
    const r = this.run(id, input);
    if (!r.ok) return r;
    const changed = r.doc !== this.current;
    if (changed) {
      this.undoStack.push({ commandId: id, input: r.input, before: this.current, after: r.doc });
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack = [];
      this.current = r.doc;
      this.emit({ reason: 'execute', commandId: id });
    }
    return { ok: true, output: r.output, changed };
  }

  /** Run a command against the current document without committing it (live previews). */
  preview<K extends CommandId>(id: K, input: InputOf<K>): PreviewOutcome<OutputOf<K>> {
    const r = this.run(id, input);
    return r.ok ? { ok: true, doc: r.doc, output: r.output as OutputOf<K> } : r;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.redoStack.push(entry);
    this.current = entry.before;
    this.emit({ reason: 'undo', commandId: entry.commandId });
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.undoStack.push(entry);
    this.current = entry.after;
    this.emit({ reason: 'redo', commandId: entry.commandId });
    return true;
  }

  /** Read-only view of the undo history, oldest first. */
  history(): readonly HistoryEntry[] {
    return this.undoStack;
  }

  /** Replace the document (opening a file) and clear history. */
  load(doc: PushformDocument): void {
    this.current = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.emit({ reason: 'load' });
  }

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private run(
    id: string,
    input: unknown,
  ): { ok: true; doc: PushformDocument; output: unknown; input: unknown } | { ok: false; error: CommandError } {
    const def = this.registry.get(id);
    if (!def) return { ok: false, error: { code: 'unknownCommand', detail: id } };
    const parsed = def.input.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: 'invalidInput', detail: parsed.error.message } };
    const r = def.run(this.current, parsed.data);
    return r.ok ? { ...r, input: parsed.data } : r;
  }

  private emit(event: ChangeEvent): void {
    for (const l of this.listeners) l(event);
  }
}
