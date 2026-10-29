import { t } from '../i18n';
import { shownMaterial, type InstanceId } from '../scene';
import { bucketCursor } from './cursors';
import { fillFor, paintTargets } from './paintTargets';
import { isMac } from './shortcuts';
import type { Tool, ToolContext } from './tool';

/**
 * Paint Bucket (B), as in SketchUp: click a face to paint the side clicked
 * with the current material (the Materials panel's), or a group or
 * component to paint it as a whole (its material shows on the faces inside
 * it that have none). Clicking something selected paints the selection.
 * Ctrl (Option on a Mac) fills adjacent faces of the same material, Shift
 * every face of the context with it, both the faces of the same connected
 * geometry. Alt (Cmd on a Mac) samples the material a face shows.
 */
export function createPaintBucketTool(ctx: ToolContext): Tool {
  const vp = () => ctx.viewport;
  const sameContext = (path: readonly InstanceId[]) => {
    const c = ctx.contextPath();
    return path.length === c.length && path.every((id, i) => id === c[i]);
  };

  const sample = () => {
    const face = vp().faceUnderCursor();
    if (!face) return;
    const id = shownMaterial(ctx.session.doc.scene, face.path, face.model, face.faceId, face.side) ?? null;
    ctx.paint.set({ materialId: id });
    const name = id ? ctx.session.doc.scene.materials.get(id)!.name : t('materials.default');
    ctx.flash(t('message.sampled', { name }));
  };

  /** Run core.paint with the current material; painting with a starter material brings it into the file. */
  const paint = (input: { faceIds?: string[]; sides?: ('front' | 'back')[]; instanceIds?: string[] }) => {
    const choice = ctx.paint.current();
    const r = ctx.session.execute('core.paint', { definitionId: vp().frame.definitionId, ...input, ...choice });
    if (!r.ok) return ctx.flashError(r.error);
    if ('starter' in choice) ctx.paint.set({ materialId: r.output.materialId });
  };

  return {
    id: 'paintBucket',
    cursor: bucketCursor(),
    hint: () => t(isMac() ? 'status.paintMac' : 'status.paint'),
    measurementLabel: () => t('measure.dimensions'),
    busy: () => false,
    down(e) {
      if (isMac() ? e.metaKey : e.altKey) return sample();
      const hit = vp().pick();
      const { faces, instances } = ctx.selection;
      if (hit?.kind === 'instance') {
        // A selected one paints the whole selection, its faces on their fronts.
        if (instances.has(hit.id)) return paint({ faceIds: [...faces], instanceIds: [...instances] });
        return paint({ instanceIds: [hit.id] });
      }
      const face = vp().faceUnderCursor();
      if (!face || hit?.kind !== 'face' || !sameContext(face.path)) {
        if (hit?.kind === 'outside') ctx.flash(t('status.paintOutside'), true);
        return;
      }
      if (faces.has(face.faceId)) return paint({ faceIds: [...faces], sides: [face.side], instanceIds: [...instances] });
      paint({ faceIds: paintTargets(face.model, face.faceId, face.side, fillFor(e, isMac())), sides: [face.side] });
    },
    // No hover highlight, as in SketchUp: it would hide the material about to be painted over.
    move() {},
    reset: () => false,
  };
}
