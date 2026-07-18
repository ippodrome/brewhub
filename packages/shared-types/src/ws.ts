import { z } from "zod";
import { DeviceSchema } from "./device.js";
import { GravityTelemetryPayloadSchema } from "./gravity.js";
import { TelemetryPayloadSchema } from "./telemetry.js";
import { StatusPayloadSchema } from "./status.js";

export const WsMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("telemetry"), payload: TelemetryPayloadSchema }),
  z.object({ type: z.literal("status"), payload: StatusPayloadSchema }),
  z.object({ type: z.literal("device_list"), payload: z.array(DeviceSchema) }),
  z.object({ type: z.literal("gravity"), payload: GravityTelemetryPayloadSchema }),
]);
export type WsMessage = z.infer<typeof WsMessageSchema>;
