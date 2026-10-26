import { z } from 'zod';
import { t } from '../../i18n';
import { drawLine as kernelDrawLine, EPSILON } from '../../kernel';
import { withDefinitionModel } from '../document';
import type { CommandDef } from '../types';
import { definitionId, length, point3, targetModel } from './schemas';

export const drawLineInput = z.strictObject({
  definitionId,
  start: point3,
  /** Direction of the line; any non-zero length, it is normalized. */
  direction: z.tuple([z.number(), z.number(), z.number()]),
  /** Length in mm, so typing a new length amends the line. */
  length,
});
export type DrawLineInput = z.infer<typeof drawLineInput>;
export interface DrawLineOutput {
  /** Edges that make up the line, split where it met other geometry. */
  edgeIds: string[];
  /** Faces created: loops the line closed and pieces of faces it split. */
  faceIds: string[];
}

/** One straight segment. The line tool runs this once per click, so each segment is one undo step. */
export const drawLine: CommandDef<DrawLineInput, DrawLineOutput> = {
  id: 'core.drawLine',
  title: () => t('command.drawLine'),
  input: drawLineInput,
  amendable: [{ key: 'length', mode: 'positive' }],
  amendHint: () => t('error.typeOneLength'),
  run(doc, input) {
    const [x, y, z] = input.direction;
    const len = Math.hypot(x, y, z);
    if (!len) return { ok: false, error: { code: 'invalidInput', detail: 'zero direction' } };
    if (Math.abs(input.length) < EPSILON) return { ok: false, error: { code: 'tooSmall' } };
    const s = input.length / len;
    const end: [number, number, number] = [input.start[0] + x * s, input.start[1] + y * s, input.start[2] + z * s];
    const target = targetModel(doc, input.definitionId);
    if (!target.ok) return target;
    const r = kernelDrawLine(target.model, input.start, end);
    if (r.model === target.model) return { ok: false, error: { code: 'tooSmall' } };
    return { ok: true, doc: withDefinitionModel(doc, input.definitionId, r.model), output: { edgeIds: r.edgeIds, faceIds: r.faceIds } };
  },
};
