import type { CommandRegistry } from '../registry';
import { clearModel, type ClearModelInput } from './clearModel';
import { drawLine, type DrawLineInput, type DrawLineOutput } from './drawLine';
import { drawRectangle, type DrawRectangleInput, type DrawRectangleOutput } from './drawRectangle';
import {
  drawCircle,
  drawPolygon,
  type DrawCircleInput,
  type DrawPolygonInput,
  type DrawShapeOutput,
} from './drawRegularPolygon';
import { erase, type EraseInput, type EraseOutput } from './erase';
import {
  copyInstances,
  explode,
  makeComponent,
  makeGroup,
  makeUnique,
  renameDefinition,
  renameInstance,
  type CopyInstancesInput,
  type CopyInstancesOutput,
  type ExplodeInput,
  type ExplodeOutput,
  type MakeComponentInput,
  type MakeGroupInput,
  type MakeInstanceOutput,
  type MakeUniqueInput,
  type MakeUniqueOutput,
  type RenameDefinitionInput,
  type RenameInstanceInput,
} from './instances';
import { move, moveCopies, type MoveCopiesInput, type MoveInput, type MoveOutput } from './move';
import { pushPull, type PushPullInput, type PushPullOutput } from './pushPull';
import { setDisplayUnits, type SetDisplayUnitsInput } from './setDisplayUnits';

declare module '../types' {
  interface CommandMap {
    'core.drawRectangle': { input: DrawRectangleInput; output: DrawRectangleOutput };
    'core.drawLine': { input: DrawLineInput; output: DrawLineOutput };
    'core.drawCircle': { input: DrawCircleInput; output: DrawShapeOutput };
    'core.drawPolygon': { input: DrawPolygonInput; output: DrawShapeOutput };
    'core.pushPull': { input: PushPullInput; output: PushPullOutput };
    'core.erase': { input: EraseInput; output: EraseOutput };
    'core.clearModel': { input: ClearModelInput; output: Record<string, never> };
    'core.setDisplayUnits': { input: SetDisplayUnitsInput; output: Record<string, never> };
    'core.makeGroup': { input: MakeGroupInput; output: MakeInstanceOutput };
    'core.makeComponent': { input: MakeComponentInput; output: MakeInstanceOutput };
    'core.explode': { input: ExplodeInput; output: ExplodeOutput };
    'core.makeUnique': { input: MakeUniqueInput; output: MakeUniqueOutput };
    'core.renameDefinition': { input: RenameDefinitionInput; output: Record<string, never> };
    'core.renameInstance': { input: RenameInstanceInput; output: Record<string, never> };
    'core.copyInstances': { input: CopyInstancesInput; output: CopyInstancesOutput };
    'core.move': { input: MoveInput; output: MoveOutput };
    'core.moveCopies': { input: MoveCopiesInput; output: MoveOutput };
  }
}

export function registerCoreCommands(registry: CommandRegistry): void {
  registry.register(drawRectangle);
  registry.register(drawLine);
  registry.register(drawCircle);
  registry.register(drawPolygon);
  registry.register(pushPull);
  registry.register(erase);
  registry.register(clearModel);
  registry.register(setDisplayUnits);
  registry.register(makeGroup);
  registry.register(makeComponent);
  registry.register(explode);
  registry.register(makeUnique);
  registry.register(renameDefinition);
  registry.register(renameInstance);
  registry.register(copyInstances);
  registry.register(move);
  registry.register(moveCopies);
}

export type {
  ClearModelInput,
  CopyInstancesInput,
  CopyInstancesOutput,
  ExplodeInput,
  ExplodeOutput,
  MakeComponentInput,
  MakeGroupInput,
  MakeInstanceOutput,
  MakeUniqueInput,
  MakeUniqueOutput,
  MoveCopiesInput,
  MoveInput,
  MoveOutput,
  RenameDefinitionInput,
  RenameInstanceInput,
  DrawCircleInput,
  DrawPolygonInput,
  DrawShapeOutput,
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
