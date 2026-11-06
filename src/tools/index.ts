import { createCenterArcTool, createThreePointArcTool, createTwoPointArcTool } from './arc';
import { createCircleTool } from './circle';
import { createEraseTool } from './erase';
import { createPaintBucketTool } from './paintBucket';
import { createPolygonTool } from './polygon';
import { createDimensionTool } from './dimension';
import { createProtractorTool } from './protractor';
import { createTextTool } from './text';
import { createLineTool } from './line';
import { createMoveTool } from './move';
import { createOffsetTool } from './offset';
import { createRotateTool } from './rotate';
import { createScaleTool } from './scale';
import { createOrbitTool } from './orbit';
import { createPanTool } from './pan';
import { createPushPullTool } from './pushPull';
import { createRectangleTool } from './rectangle';
import { createSelectTool } from './select';
import { createTapeTool } from './tape';
import { createPlaceTool, type PlaceTool } from './place';
import type { Tool, ToolContext, ToolId } from './tool';

export type { PaintChoice, Selection, Tool, ToolContext, ToolId } from './tool';
export { arrayBeforeCopy } from './transformSelection';
export type { PlaceItem, PlaceTool } from './place';
export { edgeOf, isBandChoice, partAt, setEdgeBand, worldFaces, type BandChoice, type PlacedPart } from './edgeBanding';
export {
  ACTION_SHORTCUTS,
  isMac,
  RESERVED_SHORTCUTS,
  selectionMode,
  shortcutFor,
  TOOL_SHORTCUTS,
  type ActionId,
  type SelectionMode,
} from './shortcuts';

export function createTools(ctx: ToolContext): Record<Exclude<ToolId, 'place'>, Tool> & { place: PlaceTool } {
  return {
    select: createSelectTool(ctx),
    move: createMoveTool(ctx),
    tape: createTapeTool(ctx),
    protractor: createProtractorTool(ctx),
    dimension: createDimensionTool(ctx),
    text: createTextTool(ctx),
    rotate: createRotateTool(ctx),
    scale: createScaleTool(ctx),
    line: createLineTool(ctx),
    rectangle: createRectangleTool(ctx),
    circle: createCircleTool(ctx),
    polygon: createPolygonTool(ctx),
    arc: createTwoPointArcTool(ctx),
    centerArc: createCenterArcTool(ctx, false),
    threePointArc: createThreePointArcTool(ctx),
    pie: createCenterArcTool(ctx, true),
    pushPull: createPushPullTool(ctx),
    offset: createOffsetTool(ctx),
    erase: createEraseTool(ctx),
    paintBucket: createPaintBucketTool(ctx),
    orbit: createOrbitTool(),
    pan: createPanTool(),
    place: createPlaceTool(ctx),
  };
}
