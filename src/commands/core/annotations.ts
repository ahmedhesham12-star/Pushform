import { z } from 'zod';
import { t } from '../../i18n';
import { addAnnotation, attachAnchor, getDefinition } from '../../scene';
import type { CommandDef } from '../types';
import { definitionId, point3 } from './schemas';

/** Ends closer than this (mm) make no dimension. */
const MIN_LENGTH = 0.01;

export const addDimensionInput = z.strictObject({
  definitionId,
  /** The ends measured between, in the context's coordinates. Each attaches to the vertex or edge there. */
  start: point3,
  end: point3,
  /** From the measured points to the dimension line. */
  offset: z.tuple([z.number(), z.number(), z.number()]),
});
export type AddDimensionInput = z.infer<typeof addDimensionInput>;
export interface AnnotationOutput {
  annotationId: string;
}

/**
 * An aligned dimension between two points of the editing context. Ends on a
 * vertex or an edge (of the context or a group or component in it) follow
 * that geometry from then on.
 */
export const addDimension: CommandDef<AddDimensionInput, AnnotationOutput> = {
  id: 'core.addDimension',
  title: () => t('command.addDimension'),
  input: addDimensionInput,
  run(doc, input) {
    const contextId = input.definitionId ?? doc.scene.rootId;
    if (!getDefinition(doc.scene, contextId)) return { ok: false, error: { code: 'noSuchDefinition', detail: input.definitionId ?? '' } };
    const [s, e] = [input.start, input.end];
    if (Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2]) < MIN_LENGTH) return { ok: false, error: { code: 'tooSmall' } };
    const [annotationId, scene] = addAnnotation(doc.scene, contextId, {
      kind: 'dimension',
      start: attachAnchor(doc.scene, contextId, s),
      end: attachAnchor(doc.scene, contextId, e),
      offset: input.offset,
    });
    return { ok: true, doc: { ...doc, scene }, output: { annotationId } };
  },
};
