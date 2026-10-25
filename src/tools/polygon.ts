import { createRadialTool, POLYGON } from './radial';
import type { Tool, ToolContext } from './tool';

/** Center and radius to a corner; 6 sides unless a count like 8s is typed. */
export function createPolygonTool(ctx: ToolContext): Tool {
  return createRadialTool(ctx, POLYGON);
}
