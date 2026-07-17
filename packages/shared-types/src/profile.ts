import { z } from "zod";

export const ProfileStepSchema = z.object({
  atMinutes: z.number().int().nonnegative(),
  targetC: z.number(),
});
export type ProfileStep = z.infer<typeof ProfileStepSchema>;

export const ProfileSchema = z.object({
  id: z.number().int(),
  deviceId: z.string().min(1),
  name: z.string().min(1),
  steps: z.array(ProfileStepSchema).min(1),
  createdAt: z.number().int(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const CreateProfileRequestSchema = z.object({
  name: z.string().min(1),
  steps: z.array(ProfileStepSchema).min(1),
});
export type CreateProfileRequest = z.infer<typeof CreateProfileRequestSchema>;
