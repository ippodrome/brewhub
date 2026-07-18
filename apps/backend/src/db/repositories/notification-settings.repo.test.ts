import { describe, expect, it } from "vitest";
import { createDbClient } from "../client.js";
import { runMigrations } from "../migrate.js";
import {
  ensureVapidKeys,
  getNotificationSettings,
  getVapidKeyPair,
  updateNotificationSettings,
} from "./notification-settings.repo.js";

function setUp() {
  const db = createDbClient(":memory:");
  runMigrations(db);
  return db;
}

describe("notification-settings.repo", () => {
  it("starts with everything null", () => {
    const db = setUp();
    expect(getNotificationSettings(db)).toEqual({
      vapidPublicKey: null,
      telegramBotToken: null,
      telegramChatId: null,
      discordWebhookUrl: null,
    });
    expect(getVapidKeyPair(db)).toBeNull();
  });

  it("generates and persists VAPID keys on first call, is idempotent after", () => {
    const db = setUp();
    ensureVapidKeys(db);
    const first = getVapidKeyPair(db);
    expect(first).not.toBeNull();
    expect(first!.publicKey).toBeTruthy();
    expect(first!.privateKey).toBeTruthy();

    ensureVapidKeys(db); // second call should not regenerate
    const second = getVapidKeyPair(db);
    expect(second).toEqual(first);
  });

  it("public settings view never includes the private key", () => {
    const db = setUp();
    ensureVapidKeys(db);
    const publicView = getNotificationSettings(db);
    expect(publicView.vapidPublicKey).toBeTruthy();
    expect(publicView).not.toHaveProperty("vapidPrivateKey");
  });

  it("updates telegram/discord fields via partial patches", () => {
    const db = setUp();
    updateNotificationSettings(db, { telegramBotToken: "bot-token", telegramChatId: "12345" });
    expect(getNotificationSettings(db)).toMatchObject({
      telegramBotToken: "bot-token",
      telegramChatId: "12345",
      discordWebhookUrl: null,
    });

    updateNotificationSettings(db, { discordWebhookUrl: "https://discord.com/api/webhooks/x" });
    expect(getNotificationSettings(db)).toMatchObject({
      telegramBotToken: "bot-token", // unchanged by the second, unrelated patch
      discordWebhookUrl: "https://discord.com/api/webhooks/x",
    });
  });

  it("explicitly clears a field when patched with null", () => {
    const db = setUp();
    updateNotificationSettings(db, { telegramBotToken: "bot-token" });
    updateNotificationSettings(db, { telegramBotToken: null });
    expect(getNotificationSettings(db).telegramBotToken).toBeNull();
  });
});
