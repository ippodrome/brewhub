-- Time-series history for flow and weight readings, for the real-time
-- charts feature (claude.md §5.4/§9). Mirrors the existing `readings`
-- table's shape/index pattern exactly (see readings.repo.ts) rather than
-- generalizing into one metric table — temperature/flow/weight are
-- different enough units and cardinalities that a shared table would need
-- a value column loose enough to lose the CHECK/NOT NULL guarantees each
-- one can otherwise keep.
--
-- Retention: deferred, same as `readings` (see DECISIONS.md ADR-003) — no
-- rollup job yet, revisit once real telemetry volume exists.

CREATE TABLE flow_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    flow_index INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    pulse_count INTEGER NOT NULL,
    recorded_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_flow_readings_device_index_ts ON flow_readings(device_id, flow_index, ts);

CREATE TABLE weight_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    weight_index INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    grams REAL, -- NULL = device reported a sensor fault for this reading
    recorded_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_weight_readings_device_index_ts ON weight_readings(device_id, weight_index, ts);
