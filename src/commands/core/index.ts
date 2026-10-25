import type { CommandRegistry } from '../registry';
import { clearModel, type ClearModelInput } from './clearModel';
import { deleteFace, type DeleteFaceInput } from './deleteFace';
import { drawRectangle, type DrawRectangleInput, type DrawRectangleOutput } from './drawRectangle';
import { pushPull, type PushPullInput, type PushPullOutput } from './pushPull';
import { setDisplayUnits, type SetDisplayUnitsInput } from './setDisplayUnits';

declare module '../types' {
  interface CommandMap {
    'core.drawRectangle': { input: DrawRectangleInput; output: DrawRectangleOutput };
    'core.pushPull': { input: PushPullInput; output: PushPullOutput };
    'core.deleteFace': { input: DeleteFaceInput; output: Record<string, never> };
    'core.clearModel': { input: ClearModelInput; output: Record<string, never> };
    'core.setDisplayUnits': { input: SetDisplayUnitsInput; output: Record<string, never> };
  }
}

export function registerCoreCommands(registry: CommandRegistry): void {
  registry.register(drawRectangle);
  registry.register(pushPull);
  registry.register(deleteFace);
  registry.register(clearModel);
  registry.register(setDisplayUnits);
}

export type { ClearModelInput, DeleteFaceInput, DrawRectangleInput, DrawRectangleOutput, PushPullInput, PushPullOutput, SetDisplayUnitsInput };
