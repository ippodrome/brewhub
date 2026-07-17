import {
  CreateDeviceRequestSchema,
  DeviceConfigSchema,
  DeviceSchema,
  type CreateDeviceRequest,
  type Device,
  type DeviceConfig,
  type UpdateDeviceConfigRequest,
} from "@brewhub/shared-types";
import { z } from "zod";
import { apiFetch } from "./client";

export async function listDevices(): Promise<Device[]> {
  const response = await apiFetch<unknown>("/api/devices");
  return z.array(DeviceSchema).parse(response);
}

export async function createDevice(req: CreateDeviceRequest): Promise<Device> {
  const body = CreateDeviceRequestSchema.parse(req);
  const response = await apiFetch<unknown>("/api/devices", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return DeviceSchema.parse(response);
}

export async function deleteDevice(id: string): Promise<void> {
  await apiFetch<void>(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function updateDeviceConfig(
  id: string,
  update: UpdateDeviceConfigRequest,
): Promise<DeviceConfig> {
  const response = await apiFetch<unknown>(`/api/devices/${encodeURIComponent(id)}/config`, {
    method: "PATCH",
    body: JSON.stringify(update),
  });
  return DeviceConfigSchema.parse(response);
}
