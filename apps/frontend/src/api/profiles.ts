import {
  ActiveProfileProgressSchema,
  ApplyTemplateResultSchema,
  ProfileTemplateSchema,
  type ActiveProfileProgress,
  type ApplyTemplateResult,
  type ProfileTemplate,
  CreateProfileRequestSchema,
  ImportProfilesResultSchema,
  ProfileSchema,
  type CreateProfileRequest,
  type ImportProfilesResult,
  type Profile,
} from "@brewhub/shared-types";
import { z } from "zod";
import { apiFetch, getToken } from "./client";

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

/**
 * Downloads profiles as a JSON file. Goes through fetch + a blob URL rather
 * than a plain link because the endpoint needs the bearer token, which an
 * <a href> can't carry — same approach as the database backup download.
 * Pass a profileId to export just that one; omit it for every profile on the
 * device. Both produce the same envelope shape, so either imports the same way.
 */
export async function downloadProfileExport(deviceId: string, profileId?: number): Promise<void> {
  const base = `/api/devices/${encodeURIComponent(deviceId)}/profiles`;
  const url = profileId === undefined ? `${base}/export` : `${base}/${profileId}/export`;

  const token = getToken();
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!res.ok) throw new Error(`Profile export failed: ${res.status}`);

  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "brewhub-profiles.json";

  const blobUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
}

export async function importProfiles(deviceId: string, file: File): Promise<ImportProfilesResult> {
  // Parsed here rather than posted as a raw upload so a malformed file is
  // caught before it leaves the browser, with a clearer message than a 400.
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't valid JSON");
  }

  const response = await apiFetch<unknown>(
    `/api/devices/${encodeURIComponent(deviceId)}/profiles/import`,
    { method: "POST", body: JSON.stringify(parsed) },
  );
  return ImportProfilesResultSchema.parse(response);
}

export async function deleteProfile(deviceId: string, profileId: number): Promise<void> {
  await apiFetch<void>(
    `/api/devices/${encodeURIComponent(deviceId)}/profiles/${profileId}`,
    { method: "DELETE" },
  );
}

const devicePath = (deviceId: string) => `/api/devices/${encodeURIComponent(deviceId)}/profiles`;

export async function updateProfile(deviceId: string, profileId: number, req: CreateProfileRequest): Promise<Profile> {
  const body = CreateProfileRequestSchema.parse(req);
  const response = await apiFetch<unknown>(`${devicePath(deviceId)}/${profileId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return ProfileSchema.parse(response);
}

export async function getActiveProgress(deviceId: string): Promise<ActiveProfileProgress> {
  return ActiveProfileProgressSchema.parse(await apiFetch<unknown>(`${devicePath(deviceId)}/active`));
}

export async function restartActiveProfile(deviceId: string): Promise<ActiveProfileProgress> {
  return ActiveProfileProgressSchema.parse(
    await apiFetch<unknown>(`${devicePath(deviceId)}/active/restart`, { method: "POST" }),
  );
}

export async function saveProfileAsTemplate(deviceId: string, profileId: number): Promise<ProfileTemplate> {
  const response = await apiFetch<unknown>(`${devicePath(deviceId)}/${profileId}/save-as-template`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return ProfileTemplateSchema.parse(response);
}

export async function listTemplates(): Promise<ProfileTemplate[]> {
  return z.array(ProfileTemplateSchema).parse(await apiFetch<unknown>("/api/profile-templates"));
}

export async function createTemplate(req: CreateProfileRequest): Promise<ProfileTemplate> {
  const response = await apiFetch<unknown>("/api/profile-templates", {
    method: "POST",
    body: JSON.stringify(CreateProfileRequestSchema.parse(req)),
  });
  return ProfileTemplateSchema.parse(response);
}

export async function updateTemplate(templateId: number, req: CreateProfileRequest): Promise<ProfileTemplate> {
  const response = await apiFetch<unknown>(`/api/profile-templates/${templateId}`, {
    method: "PUT",
    body: JSON.stringify(CreateProfileRequestSchema.parse(req)),
  });
  return ProfileTemplateSchema.parse(response);
}

export async function deleteTemplate(templateId: number): Promise<void> {
  await apiFetch<void>(`/api/profile-templates/${templateId}`, { method: "DELETE" });
}

export async function applyTemplate(
  templateId: number,
  deviceId: string,
  activate: boolean,
): Promise<ApplyTemplateResult> {
  const response = await apiFetch<unknown>(`/api/profile-templates/${templateId}/apply`, {
    method: "POST",
    body: JSON.stringify({ deviceId, activate }),
  });
  return ApplyTemplateResultSchema.parse(response);
}
