-- devices.type CHECK predates the gravity_bridge device type introduced in
-- 0011_gravity.sql (which added the hydrometers/gravity_readings tables and
-- the shared-types DeviceTypeSchema enum value, but missed updating this
-- constraint to match — Zod validation accepted "gravity_bridge" as a valid
-- request, but the actual INSERT then failed with SQLITE_CONSTRAINT_CHECK,
-- discovered live when registering a real gravity-bridge device). SQLite
-- can't ALTER a CHECK constraint in place, so recreate — same pattern as
-- 0003/0006. foreign_keys enforcement is toggled off for the whole
-- migration file by db/migrate.ts, with a foreign_key_check afterward.

CREATE TABLE devices_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('kegerator','fermenter','sensor','keg_scale','gravity_bridge')),
    chamber_name TEXT,
    board TEXT,
    firmware_version TEXT,
    ip_address TEXT,
    is_online INTEGER NOT NULL DEFAULT 0,
    last_seen_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO devices_new SELECT * FROM devices;

DROP TABLE devices;
ALTER TABLE devices_new RENAME TO devices;
