-- Broker chosen in Settings (see mqtt-broker-settings.repo.ts). Single row,
-- like notification_settings. mode NULL = never saved: the backend keeps
-- using MQTT_URL/MQTT_USERNAME/MQTT_PASSWORD exactly as before, so existing
-- installs are unaffected until someone saves this card. password is
-- write-only from the API's point of view — it is never returned.
CREATE TABLE mqtt_broker_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mode TEXT CHECK (mode IN ('builtin', 'custom')),
    host TEXT,
    port INTEGER NOT NULL DEFAULT 1883 CHECK (port BETWEEN 1 AND 65535),
    tls INTEGER NOT NULL DEFAULT 0 CHECK (tls IN (0, 1)),
    username TEXT,
    password TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO mqtt_broker_settings (id) VALUES (1);
