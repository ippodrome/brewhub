import type Database from "better-sqlite3";
import webpush from "web-push";
import type { NotificationSettings, UpdateNotificationSettingsRequest } from "@brewhub/shared-types";

interface NotificationSettingsRow {
  id: number;
  vapid_public_key: string | null;
  vapid_private_key: string | null;
  telegram_bot_token: string | null;
  telegram_chat_id: string | null;
  discord_webhook_url: string | null;
  updated_at: number;
}

function getRow(db: Database.Database): NotificationSettingsRow {
  const row = db
    .prepare<[], NotificationSettingsRow>("SELECT * FROM notification_settings WHERE id = 1")
    .get();
  if (!row) throw new Error("notification_settings singleton row is missing — migration 0009 didn't run?");
  return row;
}

/** Public-API-safe view — never includes vapid_private_key. */
export function getNotificationSettings(db: Database.Database): NotificationSettings {
  const row = getRow(db);
  return {
    vapidPublicKey: row.vapid_public_key,
    telegramBotToken: row.telegram_bot_token,
    telegramChatId: row.telegram_chat_id,
    discordWebhookUrl: row.discord_webhook_url,
  };
}

/** Internal use only (notifications/send.ts) — includes the private key needed to sign web-push requests. */
export function getVapidKeyPair(db: Database.Database): { publicKey: string; privateKey: string } | null {
  const row = getRow(db);
  if (!row.vapid_public_key || !row.vapid_private_key) return null;
  return { publicKey: row.vapid_public_key, privateKey: row.vapid_private_key };
}

/**
 * Generates and persists a VAPID key pair on first boot if one doesn't
 * already exist — avoids requiring the user to manually generate and set
 * env vars for a key that isn't security-sensitive the way JWT_SECRET is
 * (it identifies the push sender to the browser's push service, it doesn't
 * sign auth tokens). Idempotent: no-ops if keys are already persisted.
 */
export function ensureVapidKeys(db: Database.Database): void {
  const row = getRow(db);
  if (row.vapid_public_key && row.vapid_private_key) return;

  const { publicKey, privateKey } = webpush.generateVAPIDKeys();
  db.prepare(
    "UPDATE notification_settings SET vapid_public_key = ?, vapid_private_key = ?, updated_at = unixepoch() WHERE id = 1",
  ).run(publicKey, privateKey);
}

export function updateNotificationSettings(
  db: Database.Database,
  patch: UpdateNotificationSettingsRequest,
): NotificationSettings {
  const current = getRow(db);
  db.prepare(
    `UPDATE notification_settings SET
       telegram_bot_token = @telegramBotToken,
       telegram_chat_id = @telegramChatId,
       discord_webhook_url = @discordWebhookUrl,
       updated_at = unixepoch()
     WHERE id = 1`,
  ).run({
    telegramBotToken: patch.telegramBotToken !== undefined ? patch.telegramBotToken : current.telegram_bot_token,
    telegramChatId: patch.telegramChatId !== undefined ? patch.telegramChatId : current.telegram_chat_id,
    discordWebhookUrl:
      patch.discordWebhookUrl !== undefined ? patch.discordWebhookUrl : current.discord_webhook_url,
  });
  return getNotificationSettings(db);
}
