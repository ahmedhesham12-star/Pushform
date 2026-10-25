import { t } from '../i18n';
import { faceArea } from '../kernel';
import { formatArea } from '../units';
import type { Tool, ToolContext } from './tool';

export function createSelectTool(ctx: ToolContext): Tool {
  const showArea = () => {
    const id = ctx.selection.selected;
    ctx.setMeasurement(t('measure.area'), id ? formatArea(faceArea(ctx.session.doc.model, id), ctx.units()) : '');
  };

  return {
    id: 'select',
    cursor: 'default',
    hint: () => (ctx.selection.selected ? t('status.select.selected') : t('status.select.idle')),
    measurementLabel: () => t('measure.area'),
    busy: () => false,
    down() {
      const h = ctx.viewport.pickFace();
      ctx.selection.selected = h ? h.faceId : null;
      ctx.applyHighlights();
      showArea();
      ctx.hint();
    },
    move() {
      const h = ctx.viewport.pickFace();
      const id = h ? h.faceId : null;
      if (id !== ctx.selection.hovered) {
        ctx.selection.hovered = id;
        ctx.applyHighlights();
      }
    },
    reset: () => false,
  };
}
