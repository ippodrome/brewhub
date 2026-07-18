import type Database from "better-sqlite3";
import type { FastifyBaseLogger } from "fastify";
import webpush from "web-push";
import {
  deletePushSubscriptionById,
  listPushSubscriptions,
} from "../db/repositories/push-subscriptions.repo.js";
import { getNotificationSettings, getVapidKeyPair } from "../db/repositories/notification-settings.repo.js";

export interface NotificationMessage {
  title: string;
  body: string;
}

/**
 * Fans out to every configured channel independently — one channel being
 * unconfigured or failing (bad token, network blip, expired push
 * subscription) never blocks the others. Fire-and-forget from call sites
 * (never awaited on the hot MQTT-message path) — see index.ts.
 */
export async function sendNotification(
  db: Database.Database,
  logger: FastifyBaseLogger,
  message: NotificationMessage,
): Promise<void> {
  await Promise.all([
    sendWebPush(db, logger, message),
    sendTelegram(db, logger, message),
    sendDiscord(db, logger, message),
  ]);
}

async function sendWebPush(
  db: Database.Database,
  logger: FastifyBaseLogger,
  message: NotificationMessage,
): Promise<void> {
  const keys = getVapidKeyPair(db);
  if (!keys) return; // shouldn't happen post-ensureVapidKeys(), but never crash a notification on it

  webpush.setVapidDetails("mailto:admin@localhost", keys.publicKey, keys.privateKey);

  const subscriptions = listPushSubscriptions(db);
  const payload = JSON.stringify(message);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Browser unsubscribed or the push service considers it gone — stop trying.
          deletePushSubscriptionById(db, sub.id);
        } else {
          logger.warn({ err, endpoint: sub.endpoint }, "web push send failed");
        }
      }
    }),
  );
}

async function sendTelegram(
  db: Database.Database,
  logger: FastifyBaseLogger,
  message: NotificationMessage,
): Promise<void> {
  const settings = getNotificationSettings(db);
  if (!settings.telegramBotToken || !settings.telegramChatId) return;

  try {
    const res = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: settings.telegramChatId,
        text: `${message.title}\n${message.body}`,
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, body: await res.text() }, "telegram notification failed");
    }
  } catch (err) {
    logger.warn({ err }, "telegram notification failed");
  }
}

async function sendDiscord(
  db: Database.Database,
  logger: FastifyBaseLogger,
  message: NotificationMessage,
): Promise<void> {
  const settings = getNotificationSettings(db);
  if (!settings.discordWebhookUrl) return;

  try {
    const res = await fetch(settings.discordWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `**${message.title}**\n${message.body}` }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, body: await res.text() }, "discord notification failed");
    }
  } catch (err) {
    logger.warn({ err }, "discord notification failed");
  }
}
