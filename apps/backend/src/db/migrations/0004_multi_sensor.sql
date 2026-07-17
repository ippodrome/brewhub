ALTER TABLE readings ADD COLUMN sensor_address TEXT NOT NULL DEFAULT 'unknown';

DROP INDEX IF EXISTS idx_readings_device_ts;
CREATE INDEX idx_readings_device_address_ts ON readings(device_id, sensor_address, ts);

CREATE TABLE device_sensors (
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    label TEXT,
    is_control_sensor INTEGER NOT NULL DEFAULT 0,
    last_seen_at INTEGER,
    PRIMARY KEY (device_id, address)
);

ALTER TABLE device_configs ADD COLUMN control_sensor_address TEXT;
