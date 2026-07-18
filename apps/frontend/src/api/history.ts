import {
  FlowHistoryPointSchema,
  GravityHistoryPointSchema,
  TemperatureHistoryPointSchema,
  WeightHistoryPointSchema,
  type FlowHistoryPoint,
  type GravityHistoryPoint,
  type TemperatureHistoryPoint,
  type WeightHistoryPoint,
} from "@brewhub/shared-types";
import { z } from "zod";
import { apiFetch } from "./client";

export async function getTemperatureHistory(
  deviceId: string,
  sensorAddress: string,
): Promise<TemperatureHistoryPoint[]> {
  const response = await apiFetch<unknown>(
    `/api/devices/${encodeURIComponent(deviceId)}/history/temperature?sensorAddress=${encodeURIComponent(sensorAddress)}`,
  );
  return z.array(TemperatureHistoryPointSchema).parse(response);
}

export async function getFlowHistory(deviceId: string, flowIndex: number): Promise<FlowHistoryPoint[]> {
  const response = await apiFetch<unknown>(
    `/api/devices/${encodeURIComponent(deviceId)}/history/flow?flowIndex=${flowIndex}`,
  );
  return z.array(FlowHistoryPointSchema).parse(response);
}

export async function getWeightHistory(deviceId: string, weightIndex: number): Promise<WeightHistoryPoint[]> {
  const response = await apiFetch<unknown>(
    `/api/devices/${encodeURIComponent(deviceId)}/history/weight?weightIndex=${weightIndex}`,
  );
  return z.array(WeightHistoryPointSchema).parse(response);
}

/** Gravity history is hydrometer-scoped, not device-scoped — see hydrometers.routes.ts. */
export async function getGravityHistory(hydrometerId: number): Promise<GravityHistoryPoint[]> {
  const response = await apiFetch<unknown>(`/api/hydrometers/${hydrometerId}/history`);
  return z.array(GravityHistoryPointSchema).parse(response);
}
