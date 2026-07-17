-- 0001's CHECK (mode IN ('off','thermostat')) predates the 'pid' mode added
-- in 0002's columns. SQLite can't ALTER a CHECK constraint directly, so the
-- table has to be recreated — standard SQLite migration pattern.

CREATE TABLE device_configs_new (
    device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    setpoint_c REAL NOT NULL DEFAULT 20.0,
    hysteresis_c REAL NOT NULL DEFAULT 0.5,
    mode TEXT NOT NULL DEFAULT 'thermostat' CHECK (mode IN ('off','thermostat','pid')),
    min_on_time_ms INTEGER NOT NULL DEFAULT 60000,
    min_off_time_ms INTEGER NOT NULL DEFAULT 60000,
    pid_kp REAL NOT NULL DEFAULT 0,
    pid_ki REAL NOT NULL DEFAULT 0,
    pid_kd REAL NOT NULL DEFAULT 0,
    pid_window_ms INTEGER NOT NULL DEFAULT 300000,
    active_profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
    profile_started_at INTEGER,
    override_expires_at INTEGER,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO device_configs_new
    (device_id, setpoint_c, hysteresis_c, mode, min_on_time_ms, min_off_time_ms,
     pid_kp, pid_ki, pid_kd, pid_window_ms, active_profile_id, profile_started_at,
     override_expires_at, updated_at)
SELECT
    device_id, setpoint_c, hysteresis_c, mode, min_on_time_ms, min_off_time_ms,
    pid_kp, pid_ki, pid_kd, pid_window_ms, active_profile_id, profile_started_at,
    override_expires_at, updated_at
FROM device_configs;

DROP TABLE device_configs;
ALTER TABLE device_configs_new RENAME TO device_configs;
