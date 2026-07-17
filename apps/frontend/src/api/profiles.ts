import {
  CreateProfileRequestSchema,
  ProfileSchema,
  type CreateProfileRequest,
  type Profile,
} from "@brewhub/shared-types";
import { z } from "zod";
import { apiFetch } from "./client";

export async function listProfiles(deviceId: string): Promise<Profile[]> {
  const response = await apiFetch<unknown>(`/api/devices/${encodeURIComponent(deviceId)}/profiles`);
  return z.array(ProfileSchema).parse(response);
}

export async function createProfile(deviceId: string, req: CreateProfileRequest): Promise<Profile> {
  const body = CreateProfileRequestSchema.parse(req);
  const response = await apiFetch<unknown>(`/api/devices/${encodeURIComponent(deviceId)}/profiles`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return ProfileSchema.parse(response);
}

export async function deleteProfile(deviceId: string, profileId: number): Promise<void> {
  await apiFetch<void>(
    `/api/devices/${encodeURIComponent(deviceId)}/profiles/${profileId}`,
    { method: "DELETE" },
  );
}
