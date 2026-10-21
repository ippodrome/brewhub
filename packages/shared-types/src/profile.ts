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

/**
 * Bumped only when the shape below changes incompatibly. Import checks it and
 * refuses anything it doesn't recognise, so a file written by a future
 * version fails loudly instead of being half-understood.
 */
export const PROFILE_EXPORT_FORMAT_VERSION = 1;

/**
 * The portable form of a profile: a name, a trigger type and its steps —
 * deliberately the same shape as CreateProfileRequest.
 *
 * id, deviceId and createdAt are *not* part of it. Those are facts about one
 * row in one installation; a profile like "Ale — ferment cool, then D-rest"
 * is a recipe that should move between devices and between installs. Reusing
 * CreateProfileRequestSchema also means Zod strips those fields if someone
 * pastes a raw profile straight out of the API, so hand-edited files work
 * without having to know which fields to remove.
 */
export const ProfileExportSchema = z.object({
  formatVersion: z.literal(PROFILE_EXPORT_FORMAT_VERSION),
  /** Informational only — import ignores it. Optional so hand-written files don't need it. */
  exportedAt: z.number().int().optional(),
  profiles: z.array(CreateProfileRequestSchema).min(1),
});
export type ProfileExport = z.infer<typeof ProfileExportSchema>;

/**
 * Import is additive and never overwrites: a clashing name is suffixed rather
 * than replacing the existing profile, and the rename is reported so the user
 * can see it happened rather than wondering why there are two similar names.
 */
export const ImportedProfileSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  /** Set when the requested name was already taken on this device. */
  renamedFrom: z.string().nullable(),
});
export type ImportedProfile = z.infer<typeof ImportedProfileSchema>;

export const ImportProfilesResultSchema = z.object({
  imported: z.array(ImportedProfileSchema),
});
export type ImportProfilesResult = z.infer<typeof ImportProfilesResultSchema>;

// --- Editing, templates and progress ---------------------------------------

/** PUT body for a device profile or a template — same shape as create. */
export const UpdateProfileRequestSchema = CreateProfileRequestSchema;
export type UpdateProfileRequest = CreateProfileRequest;

const TemplateCommonFields = {
  id: z.number().int(),
  name: z.string().min(1),
  createdAt: z.number().int(),
};

/**
 * A device-independent profile. Stored alongside device profiles but with no
 * device, so it survives device removal and can be applied to any fermenter.
 * Applying copies it — later edits to the template never touch running brews.
 */
export const ProfileTemplateSchema = z.discriminatedUnion("triggerType", [
  z.object({ ...TemplateCommonFields, triggerType: z.literal("time"), steps: z.array(TimeProfileStepSchema).min(1) }),
  z.object({ ...TemplateCommonFields, triggerType: z.literal("gravity"), steps: z.array(GravityProfileStepSchema).min(1) }),
]);
export type ProfileTemplate = z.infer<typeof ProfileTemplateSchema>;

export const SaveAsTemplateRequestSchema = z.object({ name: z.string().min(1).optional() });
export type SaveAsTemplateRequest = z.infer<typeof SaveAsTemplateRequestSchema>;

export const ApplyTemplateRequestSchema = z.object({
  deviceId: z.string().min(1),
  /** Start following the copy straight away. */
  activate: z.boolean().optional(),
  name: z.string().min(1).optional(),
});
export type ApplyTemplateRequest = z.infer<typeof ApplyTemplateRequestSchema>;

export const ApplyTemplateResultSchema = z.object({
  profile: ProfileSchema,
  activated: z.boolean(),
});
export type ApplyTemplateResult = z.infer<typeof ApplyTemplateResultSchema>;

export const ActiveProfileProgressSchema = z.discriminatedUnion("active", [
  z.object({ active: z.literal(false) }),
  z.object({
    active: z.literal(true),
    profile: ProfileSchema,
    startedAt: z.number().int(),
    elapsedMinutes: z.number(),
    /** 0-based index (into steps sorted in run order) of the step in progress. */
    stepIndex: z.number().int(),
    stepCount: z.number().int(),
    /** Run-ordered steps, so the index above refers to this list. */
    currentSetpointC: z.number().nullable(),
    /** Time profiles: minutes from start of the next step; null when on the last step or gravity-driven. */
    nextChangeAtMinutes: z.number().nullable(),
    nextTargetC: z.number().nullable(),
    /** Gravity profiles: the last measured SG, if any. */
    currentGravitySg: z.number().nullable(),
    finished: z.boolean(),
  }),
]);
export type ActiveProfileProgress = z.infer<typeof ActiveProfileProgressSchema>;
