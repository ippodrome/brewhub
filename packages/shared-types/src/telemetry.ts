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

/**
 * One load cell channel's reading, published by keg_scale devices. index
 * mirrors the flows[]/sensors[] pattern (which of the device's load cell
 * inputs), grams is the raw (tared, calibrated) weight — a keg's remaining
 * volume is derived from this on the backend via a tap's tareWeightG/
 * fullWeightG, not computed on the device. grams is null when the HX711
 * doesn't report ready in time (see LoadCellManager::readGrams), same
 * explicit-fault convention as SensorReading.temperatureC.
 */
export const WeightReadingSchema = z.object({
  index: z.number().int().nonnegative(),
  grams: z.number().nullable(),
});
export type WeightReading = z.infer<typeof WeightReadingSchema>;

/** Published to unibrew/{deviceId}/telemetry. */
export const TelemetryPayloadSchema = z.object({
  deviceId: z.string().min(1),
  ts: z.number().int(),
  sensors: z.array(SensorReadingSchema),
  flows: z.array(FlowReadingSchema).default([]),
  weights: z.array(WeightReadingSchema).default([]),
});
export type TelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;
