import type { MqttClient } from "mqtt";
import { otaTopic, OtaMessageSchema, type OtaMessage } from "@brewhub/shared-types";

/**
 * Deliberately separate from publish-config.ts, which documents itself as
 * "the ONLY function that publishes to a device's MQTT topics" under
 * ADR-004 — that constraint is about declarative, retained *config*
 * specifically. An OTA push is a one-shot imperative command (not state a
 * device should reapply on every reconnect), so it's the one sanctioned
 * exception: NOT retained, published here instead. See DECISIONS.md.
 */
export function publishOtaUpdate(client: MqttClient, deviceId: string, message: OtaMessage): void {
  const validated = OtaMessageSchema.parse(message);
  client.publish(otaTopic(deviceId), JSON.stringify(validated), {
    retain: false,
    qos: 1,
  });
}
