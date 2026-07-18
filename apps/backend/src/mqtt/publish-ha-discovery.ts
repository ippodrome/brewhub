import type { MqttClient } from "mqtt";
import type { Device, Tap } from "@brewhub/shared-types";
import { statusTopic, telemetryTopic } from "@brewhub/shared-types";
import { tapStateTopic } from "./publish-tap-state.js";

/**
 * Home Assistant's MQTT Discovery protocol — publishing these retained
 * config topics is how BrewHub entities show up in HA automatically, with
 * no manual YAML (see README "Home Assistant"). Always on, no settings
 * toggle: every message here is retained and inert to anything that isn't
 * HA (or something else that happens to speak the same convention), so
 * there's no real cost to leaving it unconditional for non-HA users.
 *
 * "Remove" functions publish an empty retained payload to the same config
 * topic — HA's own convention for deleting a previously-discovered entity.
 */
const HA_DISCOVERY_PREFIX = "homeassistant";

function haDevice(device: Device): Record<string, unknown> {
  return {
    identifiers: [device.id],
    name: device.name,
    manufacturer: "BrewHub",
    model: device.type,
  };
}

function sanitizeForTopic(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "");
}

function publishConfig(client: MqttClient, topic: string, payload: Record<string, unknown>): void {
  client.publish(topic, JSON.stringify(payload), { retain: true, qos: 1 });
}

function removeConfig(client: MqttClient, topic: string): void {
  client.publish(topic, "", { retain: true, qos: 1 });
}

function onlineConfigTopic(deviceId: string): string {
  return `${HA_DISCOVERY_PREFIX}/binary_sensor/${deviceId}/status/config`;
}

export function publishDeviceOnlineDiscovery(client: MqttClient, device: Device): void {
  publishConfig(client, onlineConfigTopic(device.id), {
    name: "Online",
    unique_id: `${device.id}_online`,
    state_topic: statusTopic(device.id),
    value_template: "{{ 'ON' if value_json.online else 'OFF' }}",
    device_class: "connectivity",
    device: haDevice(device),
  });
}

export function removeDeviceOnlineDiscovery(client: MqttClient, deviceId: string): void {
  removeConfig(client, onlineConfigTopic(deviceId));
}

function temperatureConfigTopic(deviceId: string, address: string): string {
  return `${HA_DISCOVERY_PREFIX}/sensor/${deviceId}/temp_${sanitizeForTopic(address)}/config`;
}

export function publishTemperatureSensorDiscovery(
  client: MqttClient,
  device: Device,
  address: string,
  label: string | null,
): void {
  publishConfig(client, temperatureConfigTopic(device.id, address), {
    name: label ?? `Sensor ${address.slice(0, 8)}`,
    unique_id: `${device.id}_temp_${address}`,
    state_topic: telemetryTopic(device.id),
    value_template: `{{ (value_json.sensors | selectattr('address','equalto','${address}') | map(attribute='temperatureC') | first) }}`,
    unit_of_measurement: "°C",
    device_class: "temperature",
    device: haDevice(device),
  });
}

export function removeTemperatureSensorDiscovery(client: MqttClient, deviceId: string, address: string): void {
  removeConfig(client, temperatureConfigTopic(deviceId, address));
}

function tapConfigTopic(deviceId: string, tapId: number): string {
  return `${HA_DISCOVERY_PREFIX}/sensor/${deviceId}/tap_${tapId}/config`;
}

export function publishTapVolumeDiscovery(client: MqttClient, device: Device, tap: Tap): void {
  publishConfig(client, tapConfigTopic(device.id, tap.id), {
    name: `${tap.name} remaining`,
    unique_id: `${device.id}_tap_${tap.id}_remaining`,
    state_topic: tapStateTopic(device.id, tap.id),
    value_template: "{{ value_json.remainingPercent }}",
    unit_of_measurement: "%",
    icon: "mdi:keg",
    device: haDevice(device),
  });
}

export function removeTapVolumeDiscovery(client: MqttClient, deviceId: string, tapId: number): void {
  removeConfig(client, tapConfigTopic(deviceId, tapId));
}
