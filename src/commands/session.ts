import { applyAmendValues, type AmendValues } from './amend';
import type { PushformDocument } from './document';
import type { CommandRegistry } from './registry';
import type { AmendableField, CommandError, CommandId, InputOf, OutputOf } from './types';

export type Outcome<O> = { ok: true; output: O; changed: boolean } | { ok: false; error: CommandError };
export type PreviewOutcome<O> = { ok: true; doc: PushformDocument; output: O } | { ok: false; error: CommandError };

/** One undoable step. The command and input are kept for logs, macros and replay. */
export interface HistoryEntry {
  readonly commandId: string;
  readonly input: unknown;
  readonly before: PushformDocument;
  readonly after: PushformDocument;
}

export type ChangeReason = 'execute' | 'amend' | 'undo' | 'redo' | 'load';

/** The command that typed values would amend, with its current amendable values. */
export interface AmendTarget {
  readonly commandId: string;
  readonly fields: readonly AmendableField<unknown>[];
  readonly values: readonly number[];
}
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
  /** Set when the last executed command can be amended; it is always the top undo entry. */
  private amendable: { commandId: string; input: unknown } | null = null;

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
    // Running any command ends the chance to amend the previous one.
    this.amendable = null;
    const r = this.run(id, input);
    if (!r.ok) return r;
    const changed = r.doc !== this.current;
    if (changed) {
      this.undoStack.push({ commandId: id, input: r.input, before: this.current, after: r.doc });
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack = [];
      this.current = r.doc;
      if (this.registry.get(id)?.amendable?.length) this.amendable = { commandId: id, input: r.input };
      this.emit({ reason: 'execute', commandId: id });
    }
    return { ok: true, output: r.output, changed };
  }

  /* ---------- amend last operation ---------- */

  get canAmend(): boolean {
    return this.amendTarget() !== null;
  }

  /** What typed values would amend right now, or null. */
  amendTarget(): AmendTarget | null {
    const a = this.amendable;
    const fields = a && this.registry.get(a.commandId)?.amendable;
    if (!a || !fields || this.undoStack.at(-1)?.after !== this.current) return null;
    const input = a.input as Record<string, number>;
    return { commandId: a.commandId, fields, values: fields.map((f) => input[f.key]!) };
  }

  /**
   * Re-run the last command with new values for its amendable fields: all of
   * them in field order, or some of them by key (lengths in mm, counts as
   * whole numbers). The amended command replaces the original in history, so
   * it stays one undo step. On error the original result is kept.
   */
  amend(values: AmendValues): Outcome<unknown> {
    const target = this.amendTarget();
    const entry = this.undoStack.at(-1);
    const def = target && this.registry.get(target.commandId);
    if (!target || !entry || !def) return { ok: false, error: { code: 'nothingToAmend' } };

    const next = applyAmendValues(target.fields, this.amendable!.input, values);
    if (!next.ok) return next;
    const parsed = def.input.safeParse(next.input);
    if (!parsed.success) return { ok: false, error: { code: 'invalidInput', detail: parsed.error.message } };
    const r = def.run(entry.before, parsed.data);
    if (!r.ok) return r;
    if (r.doc === entry.before) return { ok: false, error: { code: 'amendValueInvalid', detail: 'no change' } };

    this.undoStack[this.undoStack.length - 1] = {
      commandId: entry.commandId,
      input: parsed.data,
      before: entry.before,
      after: r.doc,
    };
    this.current = r.doc;
    this.amendable = { commandId: entry.commandId, input: parsed.data };
    this.emit({ reason: 'amend', commandId: entry.commandId });
    return { ok: true, output: r.output, changed: true };
  }

  /** End amending, e.g. when the user starts a new action. */
  clearAmend(): void {
    this.amendable = null;
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
    this.amendable = null;
    this.redoStack.push(entry);
    this.current = entry.before;
    this.emit({ reason: 'undo', commandId: entry.commandId });
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.amendable = null;
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
    this.amendable = null;
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
