-- Per-sensor calibration offset (°C added to the raw reading to get truth),
-- plus the mirrored copy of the *control* sensor's offset that gets pushed to
-- the device so its local control loop corrects the same way the backend does.
-- Both default to 0, so every existing device keeps behaving exactly as before.
ALTER TABLE device_sensors ADD COLUMN offset_c REAL NOT NULL DEFAULT 0;
ALTER TABLE device_configs ADD COLUMN control_sensor_offset_c REAL NOT NULL DEFAULT 0;

-- An in-progress guided flow-meter calibration. PRIMARY KEY on tap_id gives
-- "at most one session per tap" for free, and makes restarting a calibration a
-- plain upsert. Persisted rather than held in memory so a backend restart
-- mid-pour doesn't silently lose the baseline; ON DELETE CASCADE means
-- removing the tap cleans up after itself.
CREATE TABLE flow_calibration_sessions (
    tap_id                    INTEGER PRIMARY KEY REFERENCES taps(id) ON DELETE CASCADE,
    start_pulse_count         INTEGER NOT NULL,
    start_remaining_volume_ml REAL    NOT NULL,
    started_at                INTEGER NOT NULL
);
