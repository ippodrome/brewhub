import type { MqttClient } from "mqtt";
import { configTopic, DeviceConfigSchema, type DeviceConfig } from "@brewhub/shared-types";

/**
 * The ONLY function in the backend that publishes to a device's MQTT topics.
 * Always retained, always the full declarative config — never a raw command.
 * See DECISIONS.md ADR-004.
 */
export function publishDeviceConfig(
  client: MqttClient,
  deviceId: string,
  config: DeviceConfig,
): void {
  const validated = DeviceConfigSchema.parse(config);
  client.publish(configTopic(deviceId), JSON.stringify(validated), {
    retain: true,
    qos: 1,
  });
}
