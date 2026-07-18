-- Uploaded firmware binaries and short-lived OTA download tokens. See
-- packages/shared-types/src/firmware.ts for the full rationale (device_id
-- is deliberately not a FK — a binary may be uploaded before its device is
-- ever registered, for the initial-flash-via-WebSerial case).

CREATE TABLE firmware_builds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    board TEXT NOT NULL CHECK (board IN ('fermenter-brewpi', 'kegerator-kegcop', 'keg-scale')),
    version TEXT NOT NULL,
    filename TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    md5 TEXT NOT NULL,
    uploaded_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_firmware_builds_device_id ON firmware_builds(device_id);

-- Devices have no user session to send a JWT with, so OTA downloads are
-- gated by a short-lived, single-use token instead (see DECISIONS.md) —
-- minted fresh by POST /api/devices/:id/ota, not the browser's own auth.
CREATE TABLE ota_download_tokens (
    token TEXT PRIMARY KEY,
    firmware_id INTEGER NOT NULL REFERENCES firmware_builds(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
);
