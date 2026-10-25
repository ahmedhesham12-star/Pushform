import { t } from '../i18n';
import { sameEntity, type Tool, type ToolContext } from './tool';

/**
 * Click an edge (or a whole curve) or a face to erase it. Edges take priority
 * when the pointer is close to one, as in SketchUp.
 */
export function createEraseTool(ctx: ToolContext): Tool {
  return {
    id: 'erase',
    cursor: 'crosshair',
    hint: () => t('status.erase'),
    measurementLabel: () => t('measure.dimensions'),
    busy: () => false,
    down() {
      const hit = ctx.viewport.pick();
      if (!hit) return;
      ctx.selection.hovered = null;
      ctx.selection.faces.delete(hit.id);
      ctx.selection.edges.delete(hit.id);
      const input = hit.kind === 'edge' ? { faceIds: [], edgeIds: [hit.id] } : { faceIds: [hit.id], edgeIds: [] };
      const r = ctx.session.execute('core.erase', input);
      if (r.ok) ctx.flash(t('message.erased'));
      else ctx.flashError(r.error);
    },
    move() {
      const hit = ctx.viewport.pick();
      const hovered = hit ? { kind: hit.kind, id: hit.id } : null;
      if (!sameEntity(hovered, ctx.selection.hovered)) {
        ctx.selection.hovered = hovered;
        ctx.applyHighlights('erase');
      }
    },
    reset: () => false,
  };
}
