import { z } from "zod";

/**
 * Published to unibrew/{deviceId}/telemetry. temperatureC is null when the
 * device reports a sensor fault rather than omitting the field, so a
 * missing reading is always explicit in stored/broadcast data.
 *
 * Phase 2 will likely generalize this to a `sensors: Record<string, number | null>`
 * map to support multi-sensor kegerators — don't build that generalization
 * now, this is a deliberate, reviewed schema change for later.
 */
export const TelemetryPayloadSchema = z.object({
  deviceId: z.string().min(1),
  ts: z.number().int(),
  temperatureC: z.number().nullable(),
});
export type TelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;
