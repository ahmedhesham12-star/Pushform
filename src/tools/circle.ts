import { CIRCLE, createRadialTool } from './radial';
import type { Tool, ToolContext } from './tool';

/** Center and radius; 24 segments unless a count like 48s is typed. */
export function createCircleTool(ctx: ToolContext): Tool {
  return createRadialTool(ctx, CIRCLE);
}
