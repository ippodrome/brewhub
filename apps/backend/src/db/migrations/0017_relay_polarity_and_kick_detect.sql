-- Relay wiring polarity, pushed as config instead of being baked into the
-- firmware's pin map. NULL (the default) means "use the board's compiled-in
-- RELAY_ACTIVE_LOW", so every existing device keeps its current behaviour
-- until someone deliberately overrides it. Stored as INTEGER because SQLite
-- has no boolean type; 0/1/NULL.
ALTER TABLE device_configs ADD COLUMN cooling_relay_active_low INTEGER;
ALTER TABLE device_configs ADD COLUMN heating_relay_active_low INTEGER;

-- When this keg was last detected as kicked (blown / run dry), epoch ms, or
-- NULL. Reset when a new keg is tapped, same lifecycle as low_volume_notified.
ALTER TABLE taps ADD COLUMN kicked_at INTEGER;
