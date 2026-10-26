import { z } from 'zod';
import { t } from '../../i18n';
import { erase as kernelErase, hasEdge, hasFace } from '../../kernel';
import { getDefinition } from '../../scene';
import { withDefinitionModel } from '../document';
import type { CommandDef } from '../types';
import { removeInstances } from './instances';
import { definitionId, faceId, targetModel } from './schemas';

export const eraseInput = z
  .strictObject({
    definitionId,
    faceIds: z.array(faceId),
    edgeIds: z.array(z.string().min(1)),
    /** Groups and component instances placed in the context. */
    instanceIds: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => v.faceIds.length + v.edgeIds.length + (v.instanceIds?.length ?? 0) > 0, { message: 'nothing to erase' });
export type EraseInput = z.infer<typeof eraseInput>;
export interface EraseOutput {
  /** Faces that no longer exist: erased, removed with an edge, or merged into another face. */
  removedFaceIds: string[];
}

/**
 * Erase faces, edges and instances in one undo step. Erasing a face keeps its
 * edges. Erasing an edge between two coplanar faces merges them; otherwise the
 * faces it bounds go with it. Erasing any edge of a curve erases the whole
 * curve. Definitions no instance uses any more are removed.
 */
export const erase: CommandDef<EraseInput, EraseOutput> = {
  id: 'core.erase',
  title: () => t('command.erase'),
  input: eraseInput,
  run(doc, input) {
    const target = targetModel(doc, input.definitionId);
    if (!target.ok) return target;
    const contextId = input.definitionId ?? doc.scene.rootId;
    const faces = input.faceIds.filter((f) => hasFace(target.model, f));
    const edges = input.edgeIds.filter((e) => hasEdge(target.model, e));
    const context = getDefinition(doc.scene, contextId)!;
    const instances = (input.instanceIds ?? []).filter((i) => context.instances.has(i));
    if (!faces.length && !edges.length && !instances.length) {
      return { ok: false, error: { code: 'nothingToErase', detail: JSON.stringify(input) } };
    }
    let next = doc;
    let removedFaceIds: string[] = [];
    if (faces.length || edges.length) {
      const r = kernelErase(target.model, faces, edges);
      next = withDefinitionModel(doc, input.definitionId, r.model);
      removedFaceIds = r.removedFaceIds;
    }
    if (instances.length) next = { ...next, scene: removeInstances(next.scene, contextId, instances) };
    return { ok: true, doc: next, output: { removedFaceIds } };
  },
};
