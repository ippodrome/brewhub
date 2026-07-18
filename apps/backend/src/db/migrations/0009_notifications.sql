CREATE TABLE push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Single-row settings table (CHECK(id = 1) enforces it can never hold more
-- than one row) — this is a single-admin app, no per-user notification
-- preferences needed. vapid_private_key never leaves this table; only
-- vapid_public_key is ever returned by the API (see shared-types).
CREATE TABLE notification_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    vapid_public_key TEXT,
    vapid_private_key TEXT,
    telegram_bot_token TEXT,
    telegram_chat_id TEXT,
    discord_webhook_url TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO notification_settings (id) VALUES (1);

-- Tracks whether the one-time low-volume notification has already fired for
-- the CURRENT fill (reset alongside remaining_volume_ml on resetKeg) — so
-- crossing the threshold doesn't re-notify on every subsequent telemetry
-- tick while the keg stays low.
ALTER TABLE taps ADD COLUMN low_volume_notified INTEGER NOT NULL DEFAULT 0;
