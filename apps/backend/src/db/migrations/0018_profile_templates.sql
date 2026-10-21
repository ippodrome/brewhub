-- Shared profile templates live in the same table as device profiles, marked
-- with is_template = 1 and device_id = NULL (the column has been nullable since
-- 0001). Because they have no device, the ON DELETE CASCADE from devices never
-- reaches them, so templates survive device removal. Existing rows default to
-- 0 and keep behaving exactly as before.
ALTER TABLE profiles ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN updated_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_profiles_template ON profiles(is_template);
