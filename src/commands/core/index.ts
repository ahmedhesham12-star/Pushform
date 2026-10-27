import type { CommandRegistry } from '../registry';
import {
  addDimension,
  addScreenText,
  addText,
  editText,
  type AddDimensionInput,
  type AddScreenTextInput,
  type AddTextInput,
  type AnnotationOutput,
  type EditTextInput,
} from './annotations';
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
  addGuideAngle,
  addGuideLine,
  addGuideOffset,
  addGuidePoint,
  deleteGuides,
  type AddGuideAngleInput,
  type AddGuideLineInput,
  type AddGuideOffsetInput,
  type AddGuidePointInput,
  type DeleteGuidesInput,
  type GuideOutput,
} from './guides';
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
import {
  move,
  moveCopies,
  rotate,
  rotateCopies,
  type MoveCopiesInput,
  type MoveInput,
  type MoveOutput,
  type RotateCopiesInput,
  type RotateInput,
} from './move';
import { offset, type OffsetInput, type OffsetOutput } from './offset';
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
    'core.rotate': { input: RotateInput; output: MoveOutput };
    'core.rotateCopies': { input: RotateCopiesInput; output: MoveOutput };
    'core.offset': { input: OffsetInput; output: OffsetOutput };
    'core.addGuideLine': { input: AddGuideLineInput; output: GuideOutput };
    'core.addGuideOffset': { input: AddGuideOffsetInput; output: GuideOutput };
    'core.addGuidePoint': { input: AddGuidePointInput; output: GuideOutput };
    'core.addGuideAngle': { input: AddGuideAngleInput; output: GuideOutput };
    'core.deleteGuides': { input: DeleteGuidesInput; output: { count: number } };
    'core.addDimension': { input: AddDimensionInput; output: AnnotationOutput };
    'core.addText': { input: AddTextInput; output: AnnotationOutput };
    'core.addScreenText': { input: AddScreenTextInput; output: AnnotationOutput };
    'core.editText': { input: EditTextInput; output: Record<string, never> };
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
  registry.register(rotate);
  registry.register(rotateCopies);
  registry.register(offset);
  registry.register(addGuideLine);
  registry.register(addGuideOffset);
  registry.register(addGuidePoint);
  registry.register(addGuideAngle);
  registry.register(deleteGuides);
  registry.register(addDimension);
  registry.register(addText);
  registry.register(addScreenText);
  registry.register(editText);
}

export type {
  AddDimensionInput,
  AddScreenTextInput,
  AddTextInput,
  AnnotationOutput,
  EditTextInput,
  AddGuideAngleInput,
  AddGuideLineInput,
  AddGuideOffsetInput,
  AddGuidePointInput,
  DeleteGuidesInput,
  GuideOutput,
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
  RotateCopiesInput,
  RotateInput,
  OffsetInput,
  OffsetOutput,
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
