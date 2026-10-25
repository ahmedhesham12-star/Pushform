import { t } from '../i18n';
import type { Tool, ToolContext } from './tool';

export function createEraseTool(ctx: ToolContext): Tool {
  return {
    id: 'erase',
    cursor: 'crosshair',
    hint: () => t('status.erase'),
    measurementLabel: () => t('measure.dimensions'),
    busy: () => false,
    down() {
      const h = ctx.viewport.pickFace();
      if (!h) return;
      ctx.selection.hovered = null;
      if (ctx.selection.selected === h.faceId) ctx.selection.selected = null;
      const r = ctx.session.execute('core.erase', { faceIds: [h.faceId], edgeIds: [] });
      if (r.ok) ctx.flash(t('message.erased'));
      else ctx.flashError(r.error);
    },
    move() {
      const h = ctx.viewport.pickFace();
      const id = h ? h.faceId : null;
      if (id !== ctx.selection.hovered) {
        ctx.selection.hovered = id;
        ctx.applyHighlights('erase');
      }
    },
    reset: () => false,
  };
}
