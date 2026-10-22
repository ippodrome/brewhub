import {
  MqttBrokerSettingsSchema,
  TestMqttBrokerResponseSchema,
  UpdateMqttBrokerRequestSchema,
  type MqttBrokerSettings,
  type TestMqttBrokerResponse,
  type UpdateMqttBrokerRequest,
} from "@brewhub/shared-types";
import { apiFetch } from "./client";

export async function getMqttBroker(): Promise<MqttBrokerSettings> {
  return MqttBrokerSettingsSchema.parse(await apiFetch<unknown>("/api/mqtt/broker"));
}

export async function saveMqttBroker(req: UpdateMqttBrokerRequest): Promise<MqttBrokerSettings> {
  const body = UpdateMqttBrokerRequestSchema.parse(req);
  return MqttBrokerSettingsSchema.parse(await apiFetch<unknown>("/api/mqtt/broker", { method: "PUT", body: JSON.stringify(body) }));
}

export async function testMqttBroker(req: UpdateMqttBrokerRequest): Promise<TestMqttBrokerResponse> {
  const body = UpdateMqttBrokerRequestSchema.parse(req);
  return TestMqttBrokerResponseSchema.parse(
    await apiFetch<unknown>("/api/mqtt/broker/test", { method: "POST", body: JSON.stringify(body) }),
  );
}
