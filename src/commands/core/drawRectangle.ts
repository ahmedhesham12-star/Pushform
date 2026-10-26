import { z } from 'zod';
import { t } from '../../i18n';
import { drawRectangle as kernelDrawRectangle } from '../../kernel';
import { withDefinitionModel } from '../document';
import type { CommandDef } from '../types';
import { definitionId, faceId, length, point3, targetModel } from './schemas';

export const drawRectangleInput = z.strictObject({
  definitionId,
  /** Face to draw on, or null for the ground plane of the definition. */
  faceId: faceId.nullable(),
  /** First corner, on the target plane. */
  corner: point3,
  /** Signed sizes in mm along the plane axes (X and Z on the ground). */
  width: length,
  depth: length,
});
export type DrawRectangleInput = z.infer<typeof drawRectangleInput>;
export interface DrawRectangleOutput {
  /**
   * Ids of every face created: the rectangle's regions, and pieces split off
   * existing faces it overlaps. Empty when it only redraws existing edges.
   */
  faceIds: string[];
}

export const drawRectangle: CommandDef<DrawRectangleInput, DrawRectangleOutput> = {
  id: 'core.drawRectangle',
  title: () => t('command.drawRectangle'),
  input: drawRectangleInput,
  amendable: [
    { key: 'width', mode: 'positive' },
    { key: 'depth', mode: 'positive' },
  ],
  amendHint: () => t('error.typeTwoSizes'),
  run(doc, input) {
    const target = targetModel(doc, input.definitionId);
    if (!target.ok) return target;
    const { faceId, corner, width, depth } = input;
    const r = kernelDrawRectangle(target.model, { faceId, corner, width, depth });
    if (!r.ok) return { ok: false, error: { code: r.error } };
    return { ok: true, doc: withDefinitionModel(doc, input.definitionId, r.model), output: { faceIds: r.faceIds } };
  },
};
