import {
  CreateTapRequestSchema,
  PourEventSchema,
  TapSchema,
  type CreateTapRequest,
  type PourEvent,
  type Tap,
  type UpdateTapRequest,
} from "@brewhub/shared-types";
import { z } from "zod";
import { apiFetch } from "./client";

export async function listTaps(deviceId: string): Promise<Tap[]> {
  const response = await apiFetch<unknown>(`/api/devices/${encodeURIComponent(deviceId)}/taps`);
  return z.array(TapSchema).parse(response);
}

export async function createTap(deviceId: string, req: CreateTapRequest): Promise<Tap> {
  const body = CreateTapRequestSchema.parse(req);
  const response = await apiFetch<unknown>(`/api/devices/${encodeURIComponent(deviceId)}/taps`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return TapSchema.parse(response);
}

export async function updateTap(
  deviceId: string,
  tapId: number,
  patch: UpdateTapRequest,
): Promise<Tap> {
  const response = await apiFetch<unknown>(
    `/api/devices/${encodeURIComponent(deviceId)}/taps/${tapId}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  return TapSchema.parse(response);
}

export async function deleteTap(deviceId: string, tapId: number): Promise<void> {
  await apiFetch<void>(`/api/devices/${encodeURIComponent(deviceId)}/taps/${tapId}`, {
    method: "DELETE",
  });
}

export async function listPours(deviceId: string, tapId: number): Promise<PourEvent[]> {
  const response = await apiFetch<unknown>(
    `/api/devices/${encodeURIComponent(deviceId)}/taps/${tapId}/pours`,
  );
  return z.array(PourEventSchema).parse(response);
}
