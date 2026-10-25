import type { z } from 'zod';
import type { PushformDocument } from './document';

/**
 * Error codes are stable identifiers, not messages. The UI turns them into
 * translated text; plugins and MCP clients can match on them.
 */
export type CommandErrorCode =
  | 'unknownCommand'
  | 'invalidInput'
  | 'noSuchFace'
  | 'tooSmall'
  | 'notOnPlane'
  | 'outsideFace'
  | 'overlapsHole'
  | 'invalidPrecision'
  | (string & {});

export interface CommandError {
  code: CommandErrorCode;
  /** Extra detail for logs and developers, never shown to users as is. */
  detail?: string;
}

export type RunResult<O> = { ok: true; doc: PushformDocument; output: O } | { ok: false; error: CommandError };

/**
 * A named model change. Inputs and outputs must be JSON-serializable so the
 * same command can be called by tools, plugins, macros and MCP clients.
 *
 * run() must be pure: no side effects, and it returns the same document
 * instance when nothing changes (so no undo step is recorded).
 */
export interface CommandDef<I = unknown, O = unknown> {
  /** Namespaced id: "core.pushPull", "myplugin.doThing". */
  readonly id: string;
  /** Display name for menus and the undo list, already translated. */
  readonly title: () => string;
  readonly input: z.ZodType<I>;
  run(doc: PushformDocument, input: I): RunResult<O>;
}

/**
 * Typed registry of command inputs and outputs. Core commands are declared in
 * ./core. Plugins add theirs through declaration merging:
 *
 *   declare module 'pushform/commands' {
 *     interface CommandMap { 'myplugin.doThing': { input: {...}; output: {...} } }
 *   }
 */
export interface CommandMap {}

export type CommandId = keyof CommandMap & string;
export type InputOf<K extends CommandId> = CommandMap[K] extends { input: infer I } ? I : never;
export type OutputOf<K extends CommandId> = CommandMap[K] extends { output: infer O } ? O : never;
