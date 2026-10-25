import { z } from 'zod';
import { snapLength } from '../../kernel';

/**
 * A length or coordinate in mm, rounded to the model's stored precision as it
 * enters the command layer, so 24" arrives as 609.6 rather than 609.5999999999999.
 */
export const length = z.number().transform(snapLength);
/** A point in model space, in mm. */
export const point3 = z.tuple([length, length, length]);
export const faceId = z.string().min(1);
