import { describe, expect, it } from "vitest";
import { createDbClient } from "../client.js";
import { runMigrations } from "../migrate.js";
import {
  deletePushSubscriptionByEndpoint,
  insertPushSubscription,
  listPushSubscriptions,
} from "./push-subscriptions.repo.js";

function setUp() {
  const db = createDbClient(":memory:");
  runMigrations(db);
  return db;
}

describe("push-subscriptions.repo", () => {
  it("inserts and lists a subscription", () => {
    const db = setUp();
    insertPushSubscription(db, {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "p", auth: "a" },
    });
    const subs = listPushSubscriptions(db);
    expect(subs).toHaveLength(1);
    expect(subs[0]!.endpoint).toBe("https://fcm.googleapis.com/fcm/send/abc");
  });

  it("is idempotent — re-subscribing the same endpoint doesn't duplicate", () => {
    const db = setUp();
    const req = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "p", auth: "a" } };
    insertPushSubscription(db, req);
    insertPushSubscription(db, req);
    expect(listPushSubscriptions(db)).toHaveLength(1);
  });

  it("deletes by endpoint (e.g. on unsubscribe or expired-subscription cleanup)", () => {
    const db = setUp();
    insertPushSubscription(db, {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "p", auth: "a" },
    });
    deletePushSubscriptionByEndpoint(db, "https://fcm.googleapis.com/fcm/send/abc");
    expect(listPushSubscriptions(db)).toHaveLength(0);
  });
});
