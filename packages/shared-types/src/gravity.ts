import { z } from "zod";

/**
 * One hydrometer's reading as carried inside GravityTelemetryPayloadSchema.
 * identifier matches it to a configured Hydrometer row (see hydrometer.ts) —
 * unmatched identifiers are logged and dropped by the backend, not an error,
 * since a gravity-bridge may see other people's Tilts too. gravitySg/
 * temperatureC are null on a fault, same explicit-fault convention as
 * SensorReading.temperatureC in telemetry.ts.
 */
export const GravityReadingSchema = z.object({
  identifier: z.string().min(1),
  gravitySg: z.number().nullable(),
  temperatureC: z.number().nullable(),
  batteryPercent: z.number().nullable().optional(),
});
export type GravityReading = z.infer<typeof GravityReadingSchema>;

/**
 * Published to unibrew/{deviceId}/gravity, not retained (matches the
 * telemetry topic precedent — this is a stream of readings, not state to
 * replay on reconnect). This is the documented MQTT contract for gravity
 * ingestion: BrewHub's own gravity-bridge firmware is simply the first-party
 * publisher to this shape, but anything else (e.g. a Home Assistant/ESPHome
 * BLE bridge already running on the same broker) can publish the same
 * payload and be ingested identically — see DECISIONS.md. readings is an
 * array because one bridge can see multiple hydrometers in a single scan
 * pass (e.g. two different-coloured Tilts).
 */
export const GravityTelemetryPayloadSchema = z.object({
  deviceId: z.string().min(1),
  ts: z.number().int(),
  readings: z.array(GravityReadingSchema),
});
export type GravityTelemetryPayload = z.infer<typeof GravityTelemetryPayloadSchema>;

/**
 * iSpindel's own native JSON POST shape (WiFi HTTP, not MQTT — configured
 * directly in the iSpindel's web UI). name is matched against a configured
 * Hydrometer's identifier. The backend does NOT convert units — the
 * iSpindel must be configured to report Celsius, documented in the README,
 * to keep this a thin passthrough rather than a second unit-conversion path
 * to maintain.
 */
export const ISpindelPayloadSchema = z.object({
  name: z.string().min(1),
  gravity: z.number(),
  temperature: z.number().optional(),
  battery: z.number().optional(),
});
export type ISpindelPayload = z.infer<typeof ISpindelPayloadSchema>;
