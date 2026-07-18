-- Existing profiles are all time-based (see packages/shared-types/src/profile.ts's
-- discriminated union) — DEFAULT 'time' backfills every existing row exactly
-- right without touching steps_json, since existing steps already match the
-- time-step shape.
ALTER TABLE profiles ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'time';

CREATE TABLE hydrometers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    fermenter_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
    calibration_slope REAL NOT NULL DEFAULT 1.0,
    calibration_offset REAL NOT NULL DEFAULT 0.0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Mirrors weight_readings' shape/index pattern exactly (0007_metric_history.sql)
-- — one table per metric type rather than a generalized value table.
-- specific_gravity is already calibration-corrected at insert time.
CREATE TABLE gravity_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hydrometer_id INTEGER NOT NULL REFERENCES hydrometers(id) ON DELETE CASCADE,
    ts INTEGER NOT NULL,
    specific_gravity REAL,
    temperature_c REAL,
    battery_percent REAL,
    recorded_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_gravity_readings_hydrometer_ts ON gravity_readings(hydrometer_id, ts);
