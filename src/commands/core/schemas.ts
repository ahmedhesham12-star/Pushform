import { z } from 'zod';
import { snapLength, type Model } from '../../kernel';
import { definitionModel, type PushformDocument } from '../document';
import type { CommandError } from '../types';

/**
 * A length or coordinate in mm, rounded to the model's stored precision as it
 * enters the command layer, so 24" arrives as 609.6 rather than 609.5999999999999.
 */
export const length = z.number().transform(snapLength);
/** A point in model space, in mm. */
export const point3 = z.tuple([length, length, length]);
export const faceId = z.string().min(1);
/**
 * The definition whose geometry a command edits, in its local coordinates.
 * Omitted means the root (the model outside any group or component).
 */
export const definitionId = z.string().min(1).optional();

/** The geometry a command edits, or the error to return when the definition does not exist. */
export function targetModel(doc: PushformDocument, id: string | undefined): { ok: true; model: Model } | { ok: false; error: CommandError } {
  const model = definitionModel(doc, id);
  return model ? { ok: true, model } : { ok: false, error: { code: 'noSuchDefinition', detail: id ?? '' } };
}
