import { z } from "zod";

export const ControlModeSchema = z.enum(["off", "thermostat"]);
export type ControlModeValue = z.infer<typeof ControlModeSchema>;

/**
 * Full device configuration. This is both the shape published (retained) to
 * unibrew/{deviceId}/config, and the canonical stored config — the backend
 * never sends anything else to a device (see DECISIONS.md ADR-004).
 */
export const DeviceConfigSchema = z.object({
  setpointC: z.number(),
  hysteresisC: z.number().positive(),
  mode: ControlModeSchema,
  minOnTimeMs: z.number().int().nonnegative(),
  minOffTimeMs: z.number().int().nonnegative(),
  overrideExpiresAt: z.number().int().nullable().optional(),
});
export type DeviceConfig = z.infer<typeof DeviceConfigSchema>;

/** Partial update body for PATCH /api/devices/:id/config. */
export const UpdateDeviceConfigRequestSchema = DeviceConfigSchema.partial();
export type UpdateDeviceConfigRequest = z.infer<typeof UpdateDeviceConfigRequestSchema>;

export const DEFAULT_DEVICE_CONFIG: DeviceConfig = {
  setpointC: 20.0,
  hysteresisC: 0.5,
  mode: "thermostat",
  minOnTimeMs: 60000,
  minOffTimeMs: 60000,
  overrideExpiresAt: null,
};
