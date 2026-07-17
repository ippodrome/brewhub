import { z } from "zod";

/**
 * A physical sensor discovered on a device, keyed by (deviceId, address).
 * Rows are created automatically the first time a telemetry message
 * mentions an address the backend hasn't seen for that device before — the
 * user labels/designates it afterward, they don't configure it up front.
 */
export const DeviceSensorSchema = z.object({
  deviceId: z.string().min(1),
  address: z.string().min(1),
  label: z.string().nullable(),
  isControlSensor: z.boolean(),
  lastSeenAt: z.number().int().nullable(),
});
export type DeviceSensor = z.infer<typeof DeviceSensorSchema>;

export const UpdateDeviceSensorRequestSchema = z.object({
  label: z.string().nullable().optional(),
  isControlSensor: z.boolean().optional(),
});
export type UpdateDeviceSensorRequest = z.infer<typeof UpdateDeviceSensorRequestSchema>;
