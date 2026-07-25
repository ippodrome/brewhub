import {
  CreateTapRequestSchema,
  FlowCalibrationResultSchema,
  FlowCalibrationSessionSchema,
  PourEventSchema,
  TapSchema,
  type CreateTapRequest,
  type FinishFlowCalibrationRequest,
  type FlowCalibrationResult,
  type FlowCalibrationSession,
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

function calibrationUrl(deviceId: string, tapId: number): string {
  return `/api/devices/${encodeURIComponent(deviceId)}/taps/${tapId}/calibration`;
}

export async function startCalibration(
  deviceId: string,
  tapId: number,
): Promise<FlowCalibrationSession> {
  const response = await apiFetch<unknown>(calibrationUrl(deviceId, tapId), { method: "POST" });
  return FlowCalibrationSessionSchema.parse(response);
}

/** Returns null when no calibration is in progress, rather than treating that 404 as an error. */
export async function getCalibration(
  deviceId: string,
  tapId: number,
): Promise<FlowCalibrationSession | null> {
  try {
    const response = await apiFetch<unknown>(calibrationUrl(deviceId, tapId));
    return FlowCalibrationSessionSchema.parse(response);
  } catch {
    return null;
  }
}

export async function cancelCalibration(deviceId: string, tapId: number): Promise<void> {
  await apiFetch<void>(calibrationUrl(deviceId, tapId), { method: "DELETE" });
}

export async function finishCalibration(
  deviceId: string,
  tapId: number,
  req: FinishFlowCalibrationRequest,
): Promise<FlowCalibrationResult> {
  const response = await apiFetch<unknown>(`${calibrationUrl(deviceId, tapId)}/finish`, {
    method: "POST",
    body: JSON.stringify(req),
  });
  return FlowCalibrationResultSchema.parse(response);
}

export async function listPours(deviceId: string, tapId: number): Promise<PourEvent[]> {
  const response = await apiFetch<unknown>(
    `/api/devices/${encodeURIComponent(deviceId)}/taps/${tapId}/pours`,
  );
  return z.array(PourEventSchema).parse(response);
}
