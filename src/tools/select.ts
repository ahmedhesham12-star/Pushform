import { t } from '../i18n';
import { edgeGroup, edgeLength, faceArea } from '../kernel';
import { formatArea, formatLength } from '../units';
import { isMac, selectionMode } from './shortcuts';
import { sameEntity, type Tool, type ToolContext } from './tool';

/**
 * Click a face or an edge to select it; an edge of a curve selects the whole
 * curve. Modifiers as in SketchUp: Shift toggles, Ctrl adds, Ctrl+Shift
 * removes (Option instead of Ctrl on a Mac). A plain click on empty space clears.
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
    hint: () => {
      const add = t(isMac() ? 'key.option' : 'key.ctrl');
      return t(selection.faces.size || selection.edges.size ? 'status.select.selected' : 'status.select.idle', { add });
    },
    measurementLabel: () => t('measure.area'),
    busy: () => false,
    down(e) {
      const hit = ctx.viewport.pick();
      const mode = selectionMode(e, isMac());
      if (mode === 'replace') {
        selection.faces.clear();
        selection.edges.clear();
      }
      if (hit) {
        // An edge of a curve stands for the whole curve.
        const ids = hit.kind === 'edge' ? edgeGroup(ctx.session.doc.model, hit.id) : [hit.id];
        const set = hit.kind === 'edge' ? selection.edges : selection.faces;
        const on = mode === 'remove' ? false : mode === 'toggle' ? !set.has(hit.id) : true;
        for (const id of ids) {
          if (on) set.add(id);
          else set.delete(id);
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
