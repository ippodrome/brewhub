import { z } from "zod";

/**
 * A logical keg position on a kegerator, bound to one of the device's flow
 * meter inputs. remainingVolumeMl is computed/maintained by the backend
 * from cumulative pulse counts, not set directly by the client except via
 * resetKeg (tapping a new keg).
 */
export const TapSchema = z.object({
  id: z.number().int(),
  deviceId: z.string().min(1),
  flowIndex: z.number().int().min(0).max(8),
  name: z.string().min(1),
  style: z.string().nullable(),
  abv: z.number().nullable(),
  ibu: z.number().nullable(),
  notes: z.string().nullable(),
  imageUrl: z.string().nullable(),
  pulsesPerLiter: z.number().positive(),
  fullVolumeMl: z.number().positive(),
  remainingVolumeMl: z.number(),
  createdAt: z.number().int(),
});
export type Tap = z.infer<typeof TapSchema>;

export const CreateTapRequestSchema = z.object({
  flowIndex: z.number().int().min(0).max(8),
  name: z.string().min(1),
  style: z.string().optional(),
  abv: z.number().optional(),
  ibu: z.number().optional(),
  notes: z.string().optional(),
  imageUrl: z.string().optional(),
  pulsesPerLiter: z.number().positive(),
  fullVolumeMl: z.number().positive(),
});
export type CreateTapRequest = z.infer<typeof CreateTapRequestSchema>;

/** resetKeg: true resets remainingVolumeMl back to fullVolumeMl (new keg tapped). */
export const UpdateTapRequestSchema = CreateTapRequestSchema.partial().extend({
  resetKeg: z.boolean().optional(),
});
export type UpdateTapRequest = z.infer<typeof UpdateTapRequestSchema>;

export const PourEventSchema = z.object({
  id: z.number().int(),
  tapId: z.number().int(),
  volumeMl: z.number().positive(),
  startedAt: z.number().int(),
  endedAt: z.number().int(),
});
export type PourEvent = z.infer<typeof PourEventSchema>;
