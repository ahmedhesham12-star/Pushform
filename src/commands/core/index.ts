import type { CommandRegistry } from '../registry';
import { clearModel, type ClearModelInput } from './clearModel';
import { drawLine, type DrawLineInput, type DrawLineOutput } from './drawLine';
import { drawRectangle, type DrawRectangleInput, type DrawRectangleOutput } from './drawRectangle';
import { erase, type EraseInput, type EraseOutput } from './erase';
import { pushPull, type PushPullInput, type PushPullOutput } from './pushPull';
import { setDisplayUnits, type SetDisplayUnitsInput } from './setDisplayUnits';

declare module '../types' {
  interface CommandMap {
    'core.drawRectangle': { input: DrawRectangleInput; output: DrawRectangleOutput };
    'core.drawLine': { input: DrawLineInput; output: DrawLineOutput };
    'core.pushPull': { input: PushPullInput; output: PushPullOutput };
    'core.erase': { input: EraseInput; output: EraseOutput };
    'core.clearModel': { input: ClearModelInput; output: Record<string, never> };
    'core.setDisplayUnits': { input: SetDisplayUnitsInput; output: Record<string, never> };
  }
}

export function registerCoreCommands(registry: CommandRegistry): void {
  registry.register(drawRectangle);
  registry.register(drawLine);
  registry.register(pushPull);
  registry.register(erase);
  registry.register(clearModel);
  registry.register(setDisplayUnits);
}

export type {
  ClearModelInput,
  DrawLineInput,
  DrawLineOutput,
  DrawRectangleInput,
  DrawRectangleOutput,
  EraseInput,
  EraseOutput,
  PushPullInput,
  PushPullOutput,
  SetDisplayUnitsInput,
};
