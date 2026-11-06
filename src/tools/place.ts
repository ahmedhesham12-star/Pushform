import type { CommandError, PushformDocument } from '../commands';
import { t } from '../i18n';
import type { InstanceId } from '../scene';
import { inferPoint } from './inference';
import type { Tool, ToolContext } from './tool';

/** Something to place: an imported mesh, or a library item. */
export interface PlaceItem {
  /** Shown in the status bar while placing. */
  readonly name: string;
  /**
   * Insert it with its origin at `position` (the editing context's local mm):
   * previewed, or for real with `commit`. Gives the new instance, or why not.
   */
  insert(
    at: { definitionId: string | undefined; position: [number, number, number] },
    commit: boolean,
  ): { ok: true; doc: PushformDocument; instanceId: InstanceId } | { ok: false; error: CommandError };
}

export interface PlaceTool extends Tool {
  /** Start placing an item; `placed` gets the new instance after the click. */
  start(item: PlaceItem, placed: (instanceId: InstanceId) => void): void;
}

/**
 * Placing (milestone 6), as SketchUp places a component: the item follows the
 * pointer by its origin, snapping by inference like Move, and a click puts it
 * there in one step. Esc ends it (the app goes back to Select).
 */
export function createPlaceTool(ctx: ToolContext): PlaceTool {
  let item: { what: PlaceItem; placed: (id: InstanceId) => void } | null = null;

  const at = () => {
    const found = inferPoint(ctx, null, null);
    if (!found) return null;
    const frame = ctx.viewport.frame;
    return { definitionId: frame.definitionId, position: frame.toLocal(found.point) as [number, number, number] };
  };

  return {
    id: 'place',
    cursor: 'copy',
    hint: () => (item ? t('status.place', { name: item.what.name }) : ''),
    measurementLabel: () => t('measure.dimensions'),
    busy: () => false,
    start(what, placed) {
      item = { what, placed };
    },
    move() {
      const where = item && at();
      const r = where && item!.what.insert(where, false);
      if (r?.ok) ctx.showPreview(r.doc);
      else ctx.showCommitted();
    },
    down() {
      const where = item && at();
      if (!item || !where) return;
      const r = item.what.insert(where, true);
      if (!r.ok) return ctx.flashError(r.error);
      const placed = item.placed;
      item = null;
      placed(r.instanceId);
    },
    reset: () => false,
  };
}
