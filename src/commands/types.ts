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
  | 'nothingToAmend'
  | 'amendValueCount'
  | 'amendValueInvalid'
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
  /**
   * Numeric inputs (in mm) that typed values may replace right after the
   * command has run ("amend last operation"), in the order they are typed.
   * Omit for commands that cannot be amended.
   */
  readonly amendable?: readonly AmendableField<I>[];
  run(doc: PushformDocument, input: I): RunResult<O>;
}

type NumberKeys<I> = { [K in keyof I]-?: I[K] extends number ? K : never }[keyof I] & string;

/**
 * One amendable input. Typed values are magnitudes applied in the direction
 * the original input had, so the user does not have to retype signs.
 * - positive: the typed value must be greater than zero (sizes).
 * - signed: a negative typed value reverses the direction (distances).
 */
export interface AmendableField<I> {
  readonly key: NumberKeys<I>;
  readonly mode: 'positive' | 'signed';
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
