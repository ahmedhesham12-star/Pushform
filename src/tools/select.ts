import { t } from '../i18n';
import { edgeGroup, edgeLength, faceArea } from '../kernel';
import { formatArea, formatLength } from '../units';
import { sameEntity, type Tool, type ToolContext } from './tool';

/**
 * Click a face or an edge to select it; an edge of a curve selects the whole
 * curve. Shift-click adds or removes; clicking empty space clears.
 */
export function createSelectTool(ctx: ToolContext): Tool {
  const { selection } = ctx;

  /** Total area of the selected faces, or total length of the selected edges. */
  const showSize = () => {
    const m = ctx.session.doc.model;
    if (selection.faces.size && !selection.edges.size) {
      const area = [...selection.faces].reduce((s, f) => s + faceArea(m, f), 0);
      ctx.setMeasurement(t('measure.area'), formatArea(area, ctx.units()));
    } else if (selection.edges.size && !selection.faces.size) {
      const len = [...selection.edges].reduce((s, e) => s + edgeLength(m, e), 0);
      ctx.setMeasurement(t('measure.length'), formatLength(len, ctx.units()));
    } else {
      ctx.setMeasurement(t('measure.area'), '');
    }
  };

  return {
    id: 'select',
    cursor: 'default',
    hint: () => (selection.faces.size || selection.edges.size ? t('status.select.selected') : t('status.select.idle')),
    measurementLabel: () => t('measure.area'),
    busy: () => false,
    down(e) {
      const hit = ctx.viewport.pick();
      if (!e.shiftKey) {
        selection.faces.clear();
        selection.edges.clear();
      }
      if (hit?.kind === 'face') {
        if (selection.faces.has(hit.id)) selection.faces.delete(hit.id);
        else selection.faces.add(hit.id);
      } else if (hit?.kind === 'edge') {
        const group = edgeGroup(ctx.session.doc.model, hit.id);
        const on = !selection.edges.has(hit.id);
        for (const id of group) {
          if (on) selection.edges.add(id);
          else selection.edges.delete(id);
        }
      }
      ctx.applyHighlights();
      showSize();
      ctx.hint();
    },
    move() {
      const hit = ctx.viewport.pick();
      const hovered = hit ? { kind: hit.kind, id: hit.id } : null;
      if (!sameEntity(hovered, selection.hovered)) {
        selection.hovered = hovered;
        ctx.applyHighlights();
      }
    },
    reset: () => false,
  };
}
