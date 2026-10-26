import { createCircleTool } from './circle';
import { createEraseTool } from './erase';
import { createPolygonTool } from './polygon';
import { createLineTool } from './line';
import { createMoveTool } from './move';
import { createRotateTool } from './rotate';
import { createOrbitTool } from './orbit';
import { createPanTool } from './pan';
import { createPushPullTool } from './pushPull';
import { createRectangleTool } from './rectangle';
import { createSelectTool } from './select';
import type { Tool, ToolContext, ToolId } from './tool';

export type { Selection, Tool, ToolContext, ToolId } from './tool';
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

export function createTools(ctx: ToolContext): Record<ToolId, Tool> {
  return {
    select: createSelectTool(ctx),
    move: createMoveTool(ctx),
    rotate: createRotateTool(ctx),
    line: createLineTool(ctx),
    rectangle: createRectangleTool(ctx),
    circle: createCircleTool(ctx),
    polygon: createPolygonTool(ctx),
    pushPull: createPushPullTool(ctx),
    erase: createEraseTool(ctx),
    orbit: createOrbitTool(),
    pan: createPanTool(),
  };
}
