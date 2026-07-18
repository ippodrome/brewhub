import { z } from "zod";

/** Below this remaining-volume percentage, a tap gets a one-time low-volume notification (see taps.low_volume_notified). Matches the UI's own red-threshold styling. */
export const LOW_VOLUME_THRESHOLD_PERCENT = 15;

/** Matches the browser's PushSubscription.toJSON() shape exactly. */
export const PushSubscriptionKeysSchema = z.object({
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});
export type PushSubscriptionKeys = z.infer<typeof PushSubscriptionKeysSchema>;

export const CreatePushSubscriptionRequestSchema = z.object({
  endpoint: z.string().min(1),
  keys: PushSubscriptionKeysSchema,
});
export type CreatePushSubscriptionRequest = z.infer<typeof CreatePushSubscriptionRequestSchema>;

/**
 * GET response. vapidPublicKey is safe to expose (that's its whole purpose
 * — the browser needs it to create a push subscription); the matching
 * private key never leaves the backend. telegramBotToken/discordWebhookUrl
 * are returned as-is (not masked) since this whole API is already
 * JWT-gated to the single admin user — same trust model as everything else
 * in this app, not a new exposure.
 */
export const NotificationSettingsSchema = z.object({
  vapidPublicKey: z.string().nullable(),
  telegramBotToken: z.string().nullable(),
  telegramChatId: z.string().nullable(),
  discordWebhookUrl: z.string().nullable(),
});
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;

export const UpdateNotificationSettingsRequestSchema = z.object({
  telegramBotToken: z.string().nullable().optional(),
  telegramChatId: z.string().nullable().optional(),
  discordWebhookUrl: z.string().nullable().optional(),
});
export type UpdateNotificationSettingsRequest = z.infer<typeof UpdateNotificationSettingsRequestSchema>;
