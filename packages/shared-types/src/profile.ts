import { z } from "zod";

export const TimeProfileStepSchema = z.object({
  atMinutes: z.number().int().nonnegative(),
  targetC: z.number(),
});
export type TimeProfileStep = z.infer<typeof TimeProfileStepSchema>;

/**
 * atGravitySg is a threshold, not an elapsed delta — resolution looks at the
 * *current* measured gravity each tick, not "gravity has dropped by X since
 * activation" (see resolveProfileSetpointByGravity). Steps are naturally
 * authored high-to-low (OG down to FG) but the resolver itself is direction-
 * agnostic, same as the time-based one doesn't care that time only increases.
 */
export const GravityProfileStepSchema = z.object({
  atGravitySg: z.number().positive(),
  targetC: z.number(),
});
export type GravityProfileStep = z.infer<typeof GravityProfileStepSchema>;

const ProfileCommonFields = {
  id: z.number().int(),
  deviceId: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.number().int(),
};

export const TimeProfileSchema = z.object({
  ...ProfileCommonFields,
  triggerType: z.literal("time"),
  steps: z.array(TimeProfileStepSchema).min(1),
});
export type TimeProfile = z.infer<typeof TimeProfileSchema>;

/**
 * A gravity-triggered profile needs a hydrometer actually assigned to the
 * device to ever resolve (see hydrometer.ts / scheduler.ts) — enforced at
 * activation time server-side, not in this schema, since a profile can be
 * created before a hydrometer is assigned.
 */
export const GravityProfileSchema = z.object({
  ...ProfileCommonFields,
  triggerType: z.literal("gravity"),
  steps: z.array(GravityProfileStepSchema).min(1),
});
export type GravityProfile = z.infer<typeof GravityProfileSchema>;

/**
 * A profile is either purely time-driven or purely gravity-driven, never
 * mixed — keeps resolution (resolveProfileSetpoint vs.
 * resolveProfileSetpointByGravity) a simple branch on triggerType rather
 * than needing to interleave two independent variables in one interpolation.
 */
export const ProfileSchema = z.discriminatedUnion("triggerType", [TimeProfileSchema, GravityProfileSchema]);
export type Profile = z.infer<typeof ProfileSchema>;

export const CreateTimeProfileRequestSchema = z.object({
  name: z.string().min(1),
  triggerType: z.literal("time"),
  steps: z.array(TimeProfileStepSchema).min(1),
});
export type CreateTimeProfileRequest = z.infer<typeof CreateTimeProfileRequestSchema>;

export const CreateGravityProfileRequestSchema = z.object({
  name: z.string().min(1),
  triggerType: z.literal("gravity"),
  steps: z.array(GravityProfileStepSchema).min(1),
});
export type CreateGravityProfileRequest = z.infer<typeof CreateGravityProfileRequestSchema>;

export const CreateProfileRequestSchema = z.discriminatedUnion("triggerType", [
  CreateTimeProfileRequestSchema,
  CreateGravityProfileRequestSchema,
]);
export type CreateProfileRequest = z.infer<typeof CreateProfileRequestSchema>;
