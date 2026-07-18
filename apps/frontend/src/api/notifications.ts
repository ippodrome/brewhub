import {
  CreatePushSubscriptionRequestSchema,
  NotificationSettingsSchema,
  UpdateNotificationSettingsRequestSchema,
  type CreatePushSubscriptionRequest,
  type NotificationSettings,
  type UpdateNotificationSettingsRequest,
} from "@brewhub/shared-types";
import { apiFetch } from "./client";

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const response = await apiFetch<unknown>("/api/notifications/settings");
  return NotificationSettingsSchema.parse(response);
}

export async function updateNotificationSettings(
  patch: UpdateNotificationSettingsRequest,
): Promise<NotificationSettings> {
  const body = UpdateNotificationSettingsRequestSchema.parse(patch);
  const response = await apiFetch<unknown>("/api/notifications/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return NotificationSettingsSchema.parse(response);
}

export async function subscribeToPush(req: CreatePushSubscriptionRequest): Promise<void> {
  const body = CreatePushSubscriptionRequestSchema.parse(req);
  await apiFetch<void>("/api/notifications/subscribe", { method: "POST", body: JSON.stringify(body) });
}

export async function unsubscribeFromPush(endpoint: string): Promise<void> {
  await apiFetch<void>("/api/notifications/subscribe", {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  });
}

export async function sendTestNotification(): Promise<void> {
  await apiFetch<void>("/api/notifications/test", { method: "POST" });
}
