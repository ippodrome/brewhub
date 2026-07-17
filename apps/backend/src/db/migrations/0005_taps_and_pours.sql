CREATE TABLE taps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    flow_index INTEGER NOT NULL,
    name TEXT NOT NULL,
    style TEXT,
    abv REAL,
    ibu REAL,
    notes TEXT,
    image_url TEXT,
    pulses_per_liter REAL NOT NULL,
    full_volume_ml REAL NOT NULL,
    remaining_volume_ml REAL NOT NULL,
    -- Cumulative pulse count as of the last telemetry message processed,
    -- for computing deltas. Reset (not delta'd) if a new count is lower
    -- than this, which means the device rebooted its in-memory counter.
    last_pulse_count INTEGER NOT NULL DEFAULT 0,
    -- Non-null while a pour is actively accumulating (pulses seen within
    -- the idle timeout); finalized (set back to NULL) once idle.
    pour_in_progress_id INTEGER REFERENCES pour_events(id) ON DELETE SET NULL,
    last_activity_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (device_id, flow_index)
);

CREATE TABLE pour_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tap_id INTEGER NOT NULL REFERENCES taps(id) ON DELETE CASCADE,
    volume_ml REAL NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL
);
CREATE INDEX idx_pour_events_tap_started ON pour_events(tap_id, started_at);
