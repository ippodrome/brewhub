import type { MqttClient } from "mqtt";
import { TapStateSchema } from "@brewhub/shared-types";

export function tapStateTopic(deviceId: string, tapId: number): string {
  return `unibrew/${deviceId}/taps/${tapId}/state`;
}

/**
 * Retained, so a fresh subscriber (e.g. Home Assistant reconnecting) gets
 * the current value immediately rather than waiting for the next change.
 * See TapStateSchema doc comment in shared-types for why this exists and
 * why it doesn't touch ADR-004.
 */
export function publishTapState(
  client: MqttClient,
  deviceId: string,
  tap: { id: number; remainingVolumeMl: number; fullVolumeMl: number },
): void {
  const remainingPercent =
    tap.fullVolumeMl > 0 ? Math.max(0, Math.min(100, Math.round((tap.remainingVolumeMl / tap.fullVolumeMl) * 100))) : 0;

  const validated = TapStateSchema.parse({
    remainingVolumeMl: Math.max(0, Math.round(tap.remainingVolumeMl)),
    remainingPercent,
  });
  client.publish(tapStateTopic(deviceId, tap.id), JSON.stringify(validated), { retain: true, qos: 0 });
}
