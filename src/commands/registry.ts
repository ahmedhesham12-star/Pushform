import type { CommandDef } from './types';

const ID_PATTERN = /^[a-z][a-z0-9-]*\.[A-Za-z][\w.-]*$/;

/** All known commands, core and plugin. */
export class CommandRegistry {
  private readonly defs = new Map<string, CommandDef<never, unknown>>();

  register<I, O>(def: CommandDef<I, O>): void {
    if (!ID_PATTERN.test(def.id)) throw new Error(`Command id must be namespaced, like "myplugin.doThing": ${def.id}`);
    if (this.defs.has(def.id)) throw new Error(`Command already registered: ${def.id}`);
    this.defs.set(def.id, def as unknown as CommandDef<never, unknown>);
  }

  get(id: string): CommandDef<unknown, unknown> | undefined {
    return this.defs.get(id) as CommandDef<unknown, unknown> | undefined;
  }

  ids(): string[] {
    return [...this.defs.keys()];
  }
}
