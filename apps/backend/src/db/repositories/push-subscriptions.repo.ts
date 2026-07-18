import type Database from "better-sqlite3";
import type { CreatePushSubscriptionRequest } from "@brewhub/shared-types";

export interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: number;
}

/** Idempotent — re-subscribing the same browser (same endpoint) just no-ops rather than erroring. */
export function insertPushSubscription(db: Database.Database, req: CreatePushSubscriptionRequest): void {
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (@endpoint, @p256dh, @auth)
     ON CONFLICT(endpoint) DO NOTHING`,
  ).run({ endpoint: req.endpoint, p256dh: req.keys.p256dh, auth: req.keys.auth });
}

export function deletePushSubscriptionByEndpoint(db: Database.Database, endpoint: string): void {
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

export function deletePushSubscriptionById(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(id);
}

export function listPushSubscriptions(db: Database.Database): PushSubscriptionRow[] {
  return db.prepare<[], PushSubscriptionRow>("SELECT * FROM push_subscriptions").all();
}
