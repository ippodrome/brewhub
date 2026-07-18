-- Devices that have announced themselves over MQTT (unibrew/{deviceId}/discovery)
-- but may or may not be registered yet in `devices`. See DECISIONS.md for why
-- discovery uses a per-device retained topic instead of claude.md §6's
-- original single shared "unibrew/discovery" sketch.
CREATE TABLE discovered_devices (
    device_id TEXT PRIMARY KEY,
    board TEXT NOT NULL,
    firmware_version TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_seen_at INTEGER NOT NULL DEFAULT (unixepoch())
);
