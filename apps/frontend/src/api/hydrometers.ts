import {
  CreateHydrometerRequestSchema,
  HydrometerSchema,
  UpdateHydrometerRequestSchema,
  type CreateHydrometerRequest,
  type Hydrometer,
  type UpdateHydrometerRequest,
} from "@brewhub/shared-types";
import { z } from "zod";
import { apiFetch } from "./client";

export async function listHydrometers(): Promise<Hydrometer[]> {
  const response = await apiFetch<unknown>("/api/hydrometers");
  return z.array(HydrometerSchema).parse(response);
}

export async function createHydrometer(req: CreateHydrometerRequest): Promise<Hydrometer> {
  const body = CreateHydrometerRequestSchema.parse(req);
  const response = await apiFetch<unknown>("/api/hydrometers", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return HydrometerSchema.parse(response);
}

export async function updateHydrometer(id: number, patch: UpdateHydrometerRequest): Promise<Hydrometer> {
  const body = UpdateHydrometerRequestSchema.parse(patch);
  const response = await apiFetch<unknown>(`/api/hydrometers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return HydrometerSchema.parse(response);
}

export async function deleteHydrometer(id: number): Promise<void> {
  await apiFetch<void>(`/api/hydrometers/${id}`, { method: "DELETE" });
}
