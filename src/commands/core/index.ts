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
import { insertMesh, type InsertMeshInput, type InsertMeshOutput } from './meshes';
import { setHardware, type SetHardwareInput } from './hardware';
import { insertItem, type InsertItemInput, type InsertItemOutput } from './library';
import { drawArc, drawArcCenter, drawPie, type DrawArcCenterInput, type DrawArcInput, type DrawArcOutput } from './drawArc';
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
import {
  addMaterial,
  deleteMaterial,
  duplicateMaterial,
  paint,
  renameMaterial,
  setMaterialColor,
  setMaterialStock,
  setMaterialTexture,
  type AddMaterialInput,
  type DeleteMaterialInput,
  type DuplicateMaterialInput,
  type PaintInput,
  type RenameMaterialInput,
  type SetMaterialColorInput,
  type SetMaterialStockInput,
  type SetMaterialTextureInput,
} from './materials';
import { setCutListSettings, setGrain, type SetCutListSettingsInput, type SetGrainInput } from './cutList';
import { offset, type OffsetInput, type OffsetOutput } from './offset';
import { pushPull, type PushPullInput, type PushPullOutput } from './pushPull';
import { flip, scale, type FlipInput, type ScaleInput } from './scale';
import { setDisplayUnits, type SetDisplayUnitsInput } from './setDisplayUnits';
import { setWorkspace, type SetWorkspaceInput } from './workspace';
import {
  addTag,
  deleteTag,
  renameTag,
  setTag,
  setTagColor,
  setTagVisible,
  type AddTagInput,
  type DeleteTagInput,
  type RenameTagInput,
  type SetTagColorInput,
  type SetTagInput,
  type SetTagOutput,
  type SetTagVisibleInput,
} from './tags';

declare module '../types' {
  interface CommandMap {
    'core.drawRectangle': { input: DrawRectangleInput; output: DrawRectangleOutput };
    'core.drawLine': { input: DrawLineInput; output: DrawLineOutput };
    'core.drawCircle': { input: DrawCircleInput; output: DrawShapeOutput };
    'core.drawPolygon': { input: DrawPolygonInput; output: DrawShapeOutput };
    'core.drawArc': { input: DrawArcInput; output: DrawArcOutput };
    'core.drawArcCenter': { input: DrawArcCenterInput; output: DrawArcOutput };
    'core.drawPie': { input: DrawArcCenterInput; output: DrawArcOutput };
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
    'core.scale': { input: ScaleInput; output: MoveOutput };
    'core.flip': { input: FlipInput; output: MoveOutput };
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
    'core.addTag': { input: AddTagInput; output: { tagId: string } };
    'core.renameTag': { input: RenameTagInput; output: Record<string, never> };
    'core.setTagColor': { input: SetTagColorInput; output: Record<string, never> };
    'core.setTagVisible': { input: SetTagVisibleInput; output: Record<string, never> };
    'core.deleteTag': { input: DeleteTagInput; output: Record<string, never> };
    'core.setTag': { input: SetTagInput; output: SetTagOutput };
    'core.addMaterial': { input: AddMaterialInput; output: { materialId: string } };
    'core.renameMaterial': { input: RenameMaterialInput; output: Record<string, never> };
    'core.setMaterialColor': { input: SetMaterialColorInput; output: Record<string, never> };
    'core.setMaterialTexture': { input: SetMaterialTextureInput; output: Record<string, never> };
    'core.duplicateMaterial': { input: DuplicateMaterialInput; output: { materialId: string } };
    'core.deleteMaterial': { input: DeleteMaterialInput; output: Record<string, never> };
    'core.paint': { input: PaintInput; output: { materialId: string | null } };
    'core.setMaterialStock': { input: SetMaterialStockInput; output: Record<string, never> };
    'core.setCutListSettings': { input: SetCutListSettingsInput; output: Record<string, never> };
    'core.setGrain': { input: SetGrainInput; output: Record<string, never> };
    'core.setWorkspace': { input: SetWorkspaceInput; output: Record<string, never> };
    'core.insertMesh': { input: InsertMeshInput; output: InsertMeshOutput };
    'core.setHardware': { input: SetHardwareInput; output: Record<string, never> };
    'core.insertItem': { input: InsertItemInput; output: InsertItemOutput };
  }
}

export function registerCoreCommands(registry: CommandRegistry): void {
  registry.register(drawRectangle);
  registry.register(drawLine);
  registry.register(drawCircle);
  registry.register(drawPolygon);
  registry.register(drawArc);
  registry.register(drawArcCenter);
  registry.register(drawPie);
  registry.register(pushPull);
  registry.register(erase);
  registry.register(clearModel);
  registry.register(setDisplayUnits);
  registry.register(makeGroup);
  registry.register(makeComponent);
  registry.register(insertMesh);
  registry.register(setHardware);
  registry.register(insertItem);
  registry.register(explode);
  registry.register(makeUnique);
  registry.register(renameDefinition);
  registry.register(renameInstance);
  registry.register(copyInstances);
  registry.register(move);
  registry.register(moveCopies);
  registry.register(rotate);
  registry.register(rotateCopies);
  registry.register(scale);
  registry.register(flip);
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
  registry.register(addTag);
  registry.register(renameTag);
  registry.register(setTagColor);
  registry.register(setTagVisible);
  registry.register(deleteTag);
  registry.register(setTag);
  registry.register(addMaterial);
  registry.register(renameMaterial);
  registry.register(setMaterialColor);
  registry.register(setMaterialTexture);
  registry.register(duplicateMaterial);
  registry.register(deleteMaterial);
  registry.register(paint);
  registry.register(setMaterialStock);
  registry.register(setCutListSettings);
  registry.register(setGrain);
  registry.register(setWorkspace);
}

export { selectionBox, type ScaleBox } from './scale';
export { defaultComponentName } from './instances';
export { STARTER_MATERIALS, starterName, type StarterMaterial } from './materials';

export type {
  DrawArcCenterInput,
  DrawArcInput,
  DrawArcOutput,
  AddDimensionInput,
  FlipInput,
  ScaleInput,
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
