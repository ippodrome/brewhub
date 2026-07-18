import { FirmwareBuildSchema, type CreateFirmwareBuildRequest, type FirmwareBuild } from "@brewhub/shared-types";
import { z } from "zod";
import { apiFetch, getToken } from "./client";

export async function listFirmwareBuilds(deviceId?: string): Promise<FirmwareBuild[]> {
  const query = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : "";
  const response = await apiFetch<unknown>(`/api/firmware${query}`);
  return z.array(FirmwareBuildSchema).parse(response);
}

export async function uploadFirmwareBuild(
  meta: CreateFirmwareBuildRequest,
  file: File,
): Promise<FirmwareBuild> {
  const body = new FormData();
  body.append("deviceId", meta.deviceId);
  body.append("board", meta.board);
  body.append("version", meta.version);
  body.append("file", file);

  const response = await apiFetch<unknown>("/api/firmware", { method: "POST", body });
  return FirmwareBuildSchema.parse(response);
}

export async function deleteFirmwareBuild(id: number): Promise<void> {
  await apiFetch<void>(`/api/firmware/${id}`, { method: "DELETE" });
}

export async function triggerOta(deviceId: string, firmwareId: number): Promise<void> {
  await apiFetch<void>(`/api/devices/${encodeURIComponent(deviceId)}/ota`, {
    method: "POST",
    body: JSON.stringify({ firmwareId }),
  });
}

/** Raw bytes for WebSerial flashing — bypasses apiFetch's JSON parsing, needs the auth header attached manually. */
export async function downloadFirmwareBytes(id: number): Promise<ArrayBuffer> {
  const token = getToken();
  const res = await fetch(`/api/firmware/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    throw new Error(`Failed to download firmware build ${id}: ${res.status}`);
  }
  return res.arrayBuffer();
}
