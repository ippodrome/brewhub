import { z } from "zod";

/**
 * Matches the PlatformIO environment names under firmware/ — informational/
 * filtering only, not tied to DeviceTypeSchema 1:1 in the schema itself
 * (there's no firmware for "sensor" devices).
 */
export const FirmwareBoardSchema = z.enum(["fermenter-brewpi", "kegerator-kegcop", "keg-scale", "gravity-bridge"]);
export type FirmwareBoard = z.infer<typeof FirmwareBoardSchema>;

/**
 * A single uploaded firmware binary. deviceId is the DEVICE_ID compiled into
 * this specific binary (see secrets.h in each firmware/<board>/include/) —
 * NOT a foreign key, since the initial-flash use case uploads a binary for a
 * device that isn't registered in BrewHub yet (see README "Adding a
 * device"). One binary is always tied to exactly one physical device's
 * identity; there is no generic per-board image (see DECISIONS.md).
 */
export const FirmwareBuildSchema = z.object({
  id: z.number().int(),
  deviceId: z.string().min(1),
  board: FirmwareBoardSchema,
  version: z.string().min(1),
  filename: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  md5: z.string().length(32),
  uploadedAt: z.number().int(),
});
export type FirmwareBuild = z.infer<typeof FirmwareBuildSchema>;

/** Metadata fields for POST /api/firmware — the binary itself travels as a multipart file field, validated separately. */
export const CreateFirmwareBuildRequestSchema = z.object({
  deviceId: z.string().min(1),
  board: FirmwareBoardSchema,
  version: z.string().min(1),
});
export type CreateFirmwareBuildRequest = z.infer<typeof CreateFirmwareBuildRequestSchema>;

export const TriggerOtaRequestSchema = z.object({
  firmwareId: z.number().int(),
});
export type TriggerOtaRequest = z.infer<typeof TriggerOtaRequestSchema>;

/**
 * Published to unibrew/{deviceId}/ota — NOT retained (see DECISIONS.md: the
 * one deliberate exception to ADR-004's "always-retained declarative
 * config" pattern, since a firmware push is a one-shot imperative action,
 * not idempotent state a device should re-apply on every reconnect).
 */
export const OtaMessageSchema = z.object({
  version: z.string().min(1),
  url: z.string().min(1),
  md5: z.string().length(32),
});
export type OtaMessage = z.infer<typeof OtaMessageSchema>;
