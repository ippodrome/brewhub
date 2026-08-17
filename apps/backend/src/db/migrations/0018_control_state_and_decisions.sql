-- One row per device: what its control loop is doing right now. Replaced on
-- every report, so this is a cache of the retained MQTT message rather than
-- history. History lives in control_decisions below.
CREATE TABLE IF NOT EXISTS device_control_state (
    device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    output TEXT NOT NULL,
    since_ms INTEGER NOT NULL,
    setpoint_c REAL NOT NULL,
    mode TEXT NOT NULL,
    control_temp_c REAL,
    received_at INTEGER NOT NULL
);

-- Append-only. Spec §8 asks for every control decision to be kept for later
-- analysis, and this is that record: what changed, why, and what the numbers
-- were at the time. Volume is a handful an hour per device, so the table stays
-- small even before the retention sweep runs.
--
-- from_output/to_output rather than from/to: "from" and "to" are not reserved
-- in SQLite but reading `from` as a column name in a SELECT is needless
-- friction for whoever comes next.
CREATE TABLE IF NOT EXISTS control_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    from_output TEXT NOT NULL,
    to_output TEXT NOT NULL,
    reason TEXT NOT NULL,
    temperature_c REAL NOT NULL,
    threshold_c REAL NOT NULL,
    elapsed_ms INTEGER NOT NULL,
    remaining_ms INTEGER NOT NULL,
    received_at INTEGER NOT NULL
);

-- Every read is "the most recent decisions for one device".
CREATE INDEX IF NOT EXISTS idx_control_decisions_device_time
    ON control_decisions (device_id, received_at DESC);
