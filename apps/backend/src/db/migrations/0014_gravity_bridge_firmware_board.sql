-- Same bug class as 0013 (see DECISIONS.md ADR-018), a different table:
-- firmware_builds.board's CHECK constraint also predates the gravity-bridge
-- board and was never updated when it was added to shared-types'
-- FirmwareBoardSchema — found immediately after fixing 0013, uploading a
-- real gravity-bridge build. foreign_keys enforcement is toggled off for
-- the whole migration file by db/migrate.ts (ota_download_tokens FKs to
-- firmware_builds.id — preserved as-is by INSERT...SELECT, id values
-- aren't renumbered), with a foreign_key_check afterward.

CREATE TABLE firmware_builds_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    board TEXT NOT NULL CHECK (board IN ('fermenter-brewpi', 'kegerator-kegcop', 'keg-scale', 'gravity-bridge')),
    version TEXT NOT NULL,
    filename TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    md5 TEXT NOT NULL,
    uploaded_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO firmware_builds_new SELECT * FROM firmware_builds;

DROP TABLE firmware_builds;
ALTER TABLE firmware_builds_new RENAME TO firmware_builds;

CREATE INDEX idx_firmware_builds_device_id ON firmware_builds(device_id);
