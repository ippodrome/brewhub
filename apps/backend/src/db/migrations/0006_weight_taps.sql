-- devices: type CHECK predates the keg_scale device type (see claude.md
-- keg-scale design). SQLite can't ALTER a CHECK constraint in place, so
-- recreate — same pattern as 0003. devices has several FK dependents
-- (device_configs, readings, profiles, taps, device_sensors); foreign_keys
-- enforcement is toggled off for the whole migration file by db/migrate.ts,
-- with a foreign_key_check afterward.

CREATE TABLE devices_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('kegerator','fermenter','sensor','keg_scale')),
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

-- device_configs: tareRequestId is a plain nullable column (no CHECK
-- involved), so a simple ADD COLUMN suffices — no recreation needed.
ALTER TABLE device_configs ADD COLUMN tare_request_id INTEGER;

-- taps: add weight-measurement as an alternative to flow-measurement.
-- flow_index/pulses_per_liter become nullable (NULL for weight-measured
-- taps); weight_index/tare_weight_g/full_weight_g mirror that for the flow
-- variant. The CHECK enforces exactly one field group is populated,
-- matching CreateTapRequestSchema's discriminated union in shared-types.
-- weight_device_id is intentionally excluded from that CHECK: it can go
-- NULL post-creation (ON DELETE SET NULL, if the keg_scale device is
-- removed) while the tap stays measurementType 'weight' — that's a valid
-- "unassigned" state, not a data error.

CREATE TABLE taps_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    measurement_type TEXT NOT NULL DEFAULT 'flow' CHECK (measurement_type IN ('flow','weight')),
    flow_index INTEGER,
    pulses_per_liter REAL,
    weight_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
    weight_index INTEGER,
    tare_weight_g REAL,
    full_weight_g REAL,
    name TEXT NOT NULL,
    style TEXT,
    abv REAL,
    ibu REAL,
    notes TEXT,
    image_url TEXT,
    full_volume_ml REAL NOT NULL,
    remaining_volume_ml REAL NOT NULL,
    -- Flow-measured taps only; stays 0/NULL and unused for weight taps.
    last_pulse_count INTEGER NOT NULL DEFAULT 0,
    pour_in_progress_id INTEGER REFERENCES pour_events(id) ON DELETE SET NULL,
    last_activity_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    CHECK (
      (measurement_type = 'flow'
        AND flow_index IS NOT NULL AND pulses_per_liter IS NOT NULL
        AND weight_index IS NULL AND tare_weight_g IS NULL AND full_weight_g IS NULL)
      OR
      (measurement_type = 'weight'
        AND flow_index IS NULL AND pulses_per_liter IS NULL
        AND weight_index IS NOT NULL AND tare_weight_g IS NOT NULL AND full_weight_g IS NOT NULL)
    ),
    UNIQUE (device_id, flow_index),
    UNIQUE (weight_device_id, weight_index)
);

INSERT INTO taps_new
    (id, device_id, measurement_type, flow_index, pulses_per_liter, name, style, abv, ibu,
     notes, image_url, full_volume_ml, remaining_volume_ml, last_pulse_count,
     pour_in_progress_id, last_activity_at, created_at)
SELECT
    id, device_id, 'flow', flow_index, pulses_per_liter, name, style, abv, ibu,
    notes, image_url, full_volume_ml, remaining_volume_ml, last_pulse_count,
    pour_in_progress_id, last_activity_at, created_at
FROM taps;

DROP TABLE taps;
ALTER TABLE taps_new RENAME TO taps;
