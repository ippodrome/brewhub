CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('kegerator','fermenter','sensor')),
    chamber_name TEXT,
    board TEXT,
    firmware_version TEXT,
    ip_address TEXT,
    is_online INTEGER NOT NULL DEFAULT 0,
    last_seen_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS device_configs (
    device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    setpoint_c REAL NOT NULL DEFAULT 20.0,
    hysteresis_c REAL NOT NULL DEFAULT 0.5,
    mode TEXT NOT NULL DEFAULT 'thermostat' CHECK (mode IN ('off','thermostat')),
    min_on_time_ms INTEGER NOT NULL DEFAULT 60000,
    min_off_time_ms INTEGER NOT NULL DEFAULT 60000,
    override_expires_at INTEGER,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    ts INTEGER NOT NULL,
    temperature_c REAL,
    recorded_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_readings_device_ts ON readings(device_id, ts);

CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    steps_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
