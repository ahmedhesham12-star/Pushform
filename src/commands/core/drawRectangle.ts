import { z } from 'zod';
import { t } from '../../i18n';
import { drawRectangle as kernelDrawRectangle } from '../../kernel';
import type { CommandDef } from '../types';
import { faceId, length, point3 } from './schemas';

export const drawRectangleInput = z.strictObject({
  /** Face to draw on, or null for the ground. */
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
    const r = kernelDrawRectangle(doc.model, input);
    if (!r.ok) return { ok: false, error: { code: r.error } };
    return { ok: true, doc: { ...doc, model: r.model }, output: { faceIds: r.faceIds } };
  },
};
