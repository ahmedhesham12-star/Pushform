import { z } from 'zod';

/** A point in model space, in mm. */
export const point3 = z.tuple([z.number(), z.number(), z.number()]);
export const faceId = z.string().min(1);
