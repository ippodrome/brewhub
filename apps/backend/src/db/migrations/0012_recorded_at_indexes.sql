-- Every read path for these four tables now orders/filters by recorded_at
-- (server wall-clock, set automatically on insert) instead of ts (the
-- device's own millis()-since-boot value, which resets on every reboot and
-- is therefore unreliable for absolute ordering — see DECISIONS.md). The
-- old ts-based indexes no longer serve any query this codebase makes.

DROP INDEX IF EXISTS idx_readings_device_ts;
DROP INDEX IF EXISTS idx_readings_device_address_ts;
CREATE INDEX idx_readings_device_address_recorded ON readings(device_id, sensor_address, recorded_at);

DROP INDEX IF EXISTS idx_flow_readings_device_index_ts;
CREATE INDEX idx_flow_readings_device_index_recorded ON flow_readings(device_id, flow_index, recorded_at);

DROP INDEX IF EXISTS idx_weight_readings_device_index_ts;
CREATE INDEX idx_weight_readings_device_index_recorded ON weight_readings(device_id, weight_index, recorded_at);

DROP INDEX IF EXISTS idx_gravity_readings_hydrometer_ts;
CREATE INDEX idx_gravity_readings_hydrometer_recorded ON gravity_readings(hydrometer_id, recorded_at);
