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
  | 'nothingToErase'
  | 'moveBends'
  | 'moveCrosses'
  | 'nothingSelected'
  | 'noSuchInstance'
  | 'noSuchDefinition'
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
  /** What to type to amend this command, already translated; shown when typed values do not fit. */
  readonly amendHint?: () => string;
  run(doc: PushformDocument, input: I): RunResult<O>;
}

type NumberKeys<I> = { [K in keyof I]-?: I[K] extends number ? K : never }[keyof I] & string;
type BooleanKeys<I> = { [K in keyof I]-?: I[K] extends boolean ? K : never }[keyof I] & string;

/**
 * One amendable input. Typed values are magnitudes applied in the direction
 * the original input had, so the user does not have to retype signs.
 * - positive: the typed value must be greater than zero (sizes).
 * - signed: a negative typed value reverses the direction (distances).
 * kind says what the user types: a length (mm, the default), a whole count
 * typed with an "s" suffix, like 48s for segments or 6s for sides, or an
 * array after a copy, typed x5 (multiply) or /4 (divide): the count goes to
 * `key` and whether it divides to the boolean input named by `flag`; or an
 * angle in degrees (a plain number, or one marked °).
 */
export interface AmendableField<I> {
  readonly key: NumberKeys<I>;
  readonly mode: 'positive' | 'signed';
  readonly kind?: 'length' | 'count' | 'array' | 'angle';
  readonly flag?: BooleanKeys<I>;
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
