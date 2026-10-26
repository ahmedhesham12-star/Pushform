import { definitionModel } from '../commands';
import { t } from '../i18n';
import { edgeGroup, edgeLength, faceArea } from '../kernel';
import { formatArea, formatLength } from '../units';
import { isMac, selectionMode } from './shortcuts';
import { entityOf, sameEntity, type Tool, type ToolContext } from './tool';

/**
 * Click a face, an edge or a group or component to select it; an edge of a
 * curve selects the whole curve. Modifiers as in SketchUp: Shift toggles,
 * Ctrl adds, Ctrl+Shift removes (Option instead of Ctrl on a Mac). A plain
 * click on empty space clears. Inside a group or component, a click outside
 * it (on faded geometry or empty space) closes it.
 */
export function createSelectTool(ctx: ToolContext): Tool {
  const { selection } = ctx;
  const model = () => definitionModel(ctx.session.doc, ctx.viewport.frame.definitionId)!;

  /** Total area of the selected faces, or total length of the selected edges. */
  const showSize = () => {
    const m = model();
    const only = (n: number) => n > 0 && n === selection.faces.size + selection.edges.size + selection.instances.size;
    if (only(selection.faces.size)) {
      const area = [...selection.faces].reduce((s, f) => s + faceArea(m, f), 0);
      ctx.setMeasurement(t('measure.area'), formatArea(area, ctx.units()));
    } else if (only(selection.edges.size)) {
      const len = [...selection.edges].reduce((s, e) => s + edgeLength(m, e), 0);
      ctx.setMeasurement(t('measure.length'), formatLength(len, ctx.units()));
    } else {
      ctx.setMeasurement(t('measure.area'), '');
    }
  };

  const select = (e: PointerEvent) => {
    const hit = ctx.viewport.pick();
    const mode = selectionMode(e, isMac());
    if (mode === 'replace') {
      selection.faces.clear();
      selection.edges.clear();
      selection.instances.clear();
    }
    if (hit && hit.kind !== 'outside') {
      // An edge of a curve stands for the whole curve.
      const ids = hit.kind === 'edge' ? edgeGroup(model(), hit.id) : [hit.id];
      const set = hit.kind === 'edge' ? selection.edges : hit.kind === 'face' ? selection.faces : selection.instances;
      const on = mode === 'remove' ? false : mode === 'toggle' ? !set.has(hit.id) : true;
      for (const id of ids) {
        if (on) set.add(id);
        else set.delete(id);
      }
    }
  };

  return {
    id: 'select',
    cursor: 'default',
    hint: () => {
      const add = t(isMac() ? 'key.option' : 'key.ctrl');
      const any = selection.faces.size || selection.edges.size || selection.instances.size;
      return t(any ? 'status.select.selected' : 'status.select.idle', { add });
    },
    measurementLabel: () => t('measure.area'),
    busy: () => false,
    down(e) {
      const context = ctx.contextPath();
      if (context.length) {
        const hit = ctx.viewport.pick();
        // Clicking outside the open group or component closes it, up to the level the click was in.
        if (!hit || hit.kind === 'outside') {
          const path = hit?.kind === 'outside' ? hit.path : [];
          let common = 0;
          while (common < context.length && path[common] === context[common]) common++;
          ctx.closeContext(context.slice(0, common));
        }
      }
      select(e);
      ctx.applyHighlights();
      showSize();
      ctx.hint();
    },
    move() {
      const hovered = entityOf(ctx.viewport.pick());
      if (!sameEntity(hovered, selection.hovered)) {
        selection.hovered = hovered;
        ctx.applyHighlights();
      }
    },
    reset: () => false,
  };
}
