/**
 * The command layer: the only way to change a document. Tools, plugins and
 * (later) MCP clients all go through a CommandSession.
 */
import { registerCoreCommands } from './core';
import { newDocument, type PushformDocument } from './document';
import { CommandRegistry } from './registry';
import { CommandSession } from './session';

export * from './types';
export * from './document';
export { CommandRegistry } from './registry';
export { applyAmendValues, matchTypedValues, type AmendValues } from './amend';
export * from './session';
export * from './core';

/** A session with the core commands registered, starting from `doc` or an empty document. */
export function createSession(doc: PushformDocument = newDocument()): CommandSession {
  const registry = new CommandRegistry();
  registerCoreCommands(registry);
  return new CommandSession(registry, doc);
}
