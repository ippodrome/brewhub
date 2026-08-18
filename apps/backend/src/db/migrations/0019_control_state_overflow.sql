-- Snapshot hole flag: firmware sets this when DecisionBuffer dropped oldest
-- entries. 0/1 is the boolean (SQLite has none). This is on the control-state
-- snapshot, not per-decision.
ALTER TABLE device_control_state ADD COLUMN overflowed INTEGER NOT NULL DEFAULT 0;
