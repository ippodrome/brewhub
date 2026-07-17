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

/** Published to unibrew/{deviceId}/telemetry. */
export const TelemetryPayloadSchema = z.object({
  deviceId: z.string().min(1),
  ts: z.number().int(),
  sensors: z.array(SensorReadingSchema),
});
export type TelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;
