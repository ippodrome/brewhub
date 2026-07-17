import { z } from "zod";

/** Published to unibrew/{deviceId}/status, retained, ideally as LWT payload too. */
export const StatusPayloadSchema = z.object({
  deviceId: z.string().min(1),
  online: z.boolean(),
  firmwareVersion: z.string(),
  uptimeS: z.number().int().nonnegative(),
  ts: z.number().int(),
});
export type StatusPayload = z.infer<typeof StatusPayloadSchema>;
