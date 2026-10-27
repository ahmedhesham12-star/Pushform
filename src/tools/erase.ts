import { t } from '../i18n';
import { entityOf, sameEntity, type Tool, type ToolContext } from './tool';

/**
 * Click an edge (or a whole curve), a face, a guide, a dimension, or a group or component
 * to erase it. Edges take priority when the pointer is close to one, as in
 * SketchUp.
 * Geometry outside the open editing context cannot be erased.
 */
export function createEraseTool(ctx: ToolContext): Tool {
  return {
    id: 'erase',
    cursor: 'crosshair',
    hint: () => t('status.erase'),
    measurementLabel: () => t('measure.dimensions'),
    busy: () => false,
    down() {
      const hit = entityOf(ctx.viewport.pick());
      if (!hit) return;
      ctx.selection.hovered = null;
      ctx.selection.faces.delete(hit.id);
      ctx.selection.edges.delete(hit.id);
      ctx.selection.instances.delete(hit.id);
      ctx.selection.guides.delete(hit.id);
      ctx.selection.annotations.delete(hit.id);
      const r = ctx.session.execute('core.erase', {
        definitionId: ctx.viewport.frame.definitionId,
        faceIds: hit.kind === 'face' ? [hit.id] : [],
        edgeIds: hit.kind === 'edge' ? [hit.id] : [],
        instanceIds: hit.kind === 'instance' ? [hit.id] : [],
        guideIds: hit.kind === 'guide' ? [hit.id] : [],
        annotationIds: hit.kind === 'annotation' ? [hit.id] : [],
      });
      if (r.ok) ctx.flash(t('message.erased'));
      else ctx.flashError(r.error);
    },
    move() {
      const hovered = entityOf(ctx.viewport.pick());
      if (!sameEntity(hovered, ctx.selection.hovered)) {
        ctx.selection.hovered = hovered;
        ctx.applyHighlights('erase');
      }
    },
    reset: () => false,
  };
}
