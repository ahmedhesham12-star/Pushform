import type { UnitSettings } from '../units';
import type { StarterMaterial } from './core/materials';

/**
 * What kind of work a file is for (milestone 6). A workspace sets a new
 * file's units and which starter materials, panels and tools are offered.
 * It never changes what is in the file, so switching loses nothing.
 */
export const WORKSPACES = ['woodworking', 'architecture', 'general'] as const;
export type Workspace = (typeof WORKSPACES)[number];

/** Regions that measure buildings in feet and inches. */
const FEET_AND_INCHES = new Set(['US', 'LR', 'MM']);

/** A new file's units: mm for woodworking and general work; for architecture, feet and inches where buildings are measured so, else meters. */
export function workspaceUnits(workspace: Workspace, region: string | null): UnitSettings {
  if (workspace !== 'architecture') return { unit: 'mm', precision: 0 };
  return region && FEET_AND_INCHES.has(region.toUpperCase()) ? { unit: 'ft-in', precision: 16 } : { unit: 'm', precision: 2 };
}

/** The starter materials each workspace offers. */
export const WORKSPACE_STARTERS: Record<Workspace, readonly StarterMaterial[]> = {
  woodworking: ['birchPly', 'oak', 'walnut', 'whiteMdf', 'whiteMelamine', 'paintedSage', 'paintedNavy', 'paintedCharcoal', 'paintedCream'],
  architecture: ['concrete', 'brick', 'plaster', 'glass', 'ceramicTile', 'woodFlooring', 'wallWhite', 'wallGreige', 'wallBlue'],
  general: ['white', 'lightGrey', 'darkGrey', 'black', 'wood'],
};

/** The cut list, material stock and grain (and later edge banding and hardware details): Woodworking only. */
export const showsWoodworking = (workspace: Workspace): boolean => workspace === 'woodworking';

/** Groups of the tool bar, as in SketchUp's large tool set. */
export const TOOL_GROUPS = ['select', 'draw', 'arcs', 'edit', 'construction', 'view'] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

/** The tool groups each workspace shows. Every tool so far serves all three; workspace tools (walls, openings) will not. */
export const WORKSPACE_TOOL_GROUPS: Record<Workspace, readonly ToolGroup[]> = {
  woodworking: TOOL_GROUPS,
  architecture: TOOL_GROUPS,
  general: TOOL_GROUPS,
};
