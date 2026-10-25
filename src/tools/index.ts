import { createEraseTool } from './erase';
import { createLineTool } from './line';
import { createOrbitTool } from './orbit';
import { createPanTool } from './pan';
import { createPushPullTool } from './pushPull';
import { createRectangleTool } from './rectangle';
import { createSelectTool } from './select';
import type { Tool, ToolContext, ToolId } from './tool';

export type { Selection, Tool, ToolContext, ToolId } from './tool';

export function createTools(ctx: ToolContext): Record<ToolId, Tool> {
  return {
    select: createSelectTool(ctx),
    line: createLineTool(ctx),
    rectangle: createRectangleTool(ctx),
    pushPull: createPushPullTool(ctx),
    erase: createEraseTool(ctx),
    orbit: createOrbitTool(),
    pan: createPanTool(),
  };
}
