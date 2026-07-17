import { z } from "zod";

/**
 * One physical sensor's reading. address is a stable hardware identifier
 * (e.g. a DS18B20's 64-bit ROM address as a 16-char hex string) — it's how
 * readings stay associated with the same physical sensor across reboots and
 * firmware updates, independent of bus enumeration order. temperatureC is
 * null when that specific sensor faults, not omitted, so the fault is
 * always explicit in stored/broadcast data.
 */
export const SensorReadingSchema = z.object({
  address: z.string().min(1),
  temperatureC: z.number().nullable(),
});
export type SensorReading = z.infer<typeof SensorReadingSchema>;

/**
 * One flow meter's cumulative pulse count. Cumulative and monotonic (not a
 * per-message delta) so a dropped MQTT message can never lose volume — the
 * backend always computes delta = new_total - last_known_total, the same
 * self-healing pattern as retained config. index is which of the device's
 * up to 9 flow inputs this is (0-8), not every index needs a tap configured.
 */
export const FlowReadingSchema = z.object({
  index: z.number().int().min(0).max(8),
  pulseCount: z.number().int().nonnegative(),
});
export type FlowReading = z.infer<typeof FlowReadingSchema>;

/** Published to unibrew/{deviceId}/telemetry. */
export const TelemetryPayloadSchema = z.object({
  deviceId: z.string().min(1),
  ts: z.number().int(),
  sensors: z.array(SensorReadingSchema),
  flows: z.array(FlowReadingSchema).default([]),
});
export type TelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;
