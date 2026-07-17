import { z } from "zod";

export const ControlModeSchema = z.enum(["off", "thermostat", "pid"]);
export type ControlModeValue = z.infer<typeof ControlModeSchema>;

export const PidGainsSchema = z.object({
  kp: z.number(),
  ki: z.number(),
  kd: z.number(),
});
export type PidGainsValue = z.infer<typeof PidGainsSchema>;

/**
 * Full device configuration. This is both the shape published (retained) to
 * unibrew/{deviceId}/config, and the canonical stored config — the backend
 * never sends anything else to a device (see DECISIONS.md ADR-004).
 *
 * "profile" is deliberately NOT a mode here — a profile is a setpoint
 * *source*, not a control algorithm. When a device is following a profile,
 * the backend's resolution scheduler periodically recomputes setpointC and
 * republishes this same config shape; the firmware never needs to know a
 * profile exists.
 */
export const DeviceConfigSchema = z.object({
  setpointC: z.number(),
  hysteresisC: z.number().positive(),
  mode: ControlModeSchema,
  minOnTimeMs: z.number().int().nonnegative(),
  minOffTimeMs: z.number().int().nonnegative(),
  pidGains: PidGainsSchema,
  pidWindowMs: z.number().int().positive(),
  // Which discovered sensor's reading feeds the control loop. Null until a
  // sensor has actually been discovered and one is designated (defaults to
  // the first-ever sensor seen for the device — see device-sensors backend
  // logic) — firmware falls back to its first reading if null/unmatched.
  controlSensorAddress: z.string().nullable(),
  overrideExpiresAt: z.number().int().nullable().optional(),
});
export type DeviceConfig = z.infer<typeof DeviceConfigSchema>;

/**
 * Partial update body for PATCH /api/devices/:id/config. activeProfileId is
 * request-only (start/stop following a profile) — it's never part of the
 * DeviceConfigSchema shape actually published to MQTT.
 */
export const UpdateDeviceConfigRequestSchema = DeviceConfigSchema.partial().extend({
  activeProfileId: z.number().int().nullable().optional(),
});
export type UpdateDeviceConfigRequest = z.infer<typeof UpdateDeviceConfigRequestSchema>;

export const DEFAULT_DEVICE_CONFIG: DeviceConfig = {
  setpointC: 20.0,
  hysteresisC: 0.5,
  mode: "thermostat",
  minOnTimeMs: 60000,
  minOffTimeMs: 60000,
  pidGains: { kp: 0, ki: 0, kd: 0 },
  pidWindowMs: 300000,
  controlSensorAddress: null,
  overrideExpiresAt: null,
};
