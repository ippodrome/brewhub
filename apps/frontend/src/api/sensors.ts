import { DeviceSensorSchema, type DeviceSensor, type UpdateDeviceSensorRequest } from "@brewhub/shared-types";
import { z } from "zod";
import { apiFetch } from "./client";

export async function listSensors(deviceId: string): Promise<DeviceSensor[]> {
  const response = await apiFetch<unknown>(`/api/devices/${encodeURIComponent(deviceId)}/sensors`);
  return z.array(DeviceSensorSchema).parse(response);
}

export async function updateSensor(
  deviceId: string,
  address: string,
  patch: UpdateDeviceSensorRequest,
): Promise<DeviceSensor[]> {
  const response = await apiFetch<unknown>(
    `/api/devices/${encodeURIComponent(deviceId)}/sensors/${encodeURIComponent(address)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  return z.array(DeviceSensorSchema).parse(response);
}
