import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";

const TOKEN_BYTES = 24;

/** Mints a fresh single-use download token for a firmware build, valid for ttlMs. */
export function createOtaToken(db: Database.Database, firmwareId: number, nowMs: number, ttlMs: number): string {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  db.prepare(
    "INSERT INTO ota_download_tokens (token, firmware_id, expires_at, used) VALUES (?, ?, ?, 0)",
  ).run(token, firmwareId, nowMs + ttlMs);
  return token;
}

/**
 * Validates a token against the requested firmware id and marks it used —
 * single-use, so a retried/duplicate device HTTP request can't replay it.
 * Returns false for any mismatch: unknown token, wrong firmware, expired,
 * or already used.
 */
export function consumeOtaToken(
  db: Database.Database,
  token: string,
  firmwareId: number,
  nowMs: number,
): boolean {
  const row = db
    .prepare<[string], { firmware_id: number; expires_at: number; used: number }>(
      "SELECT firmware_id, expires_at, used FROM ota_download_tokens WHERE token = ?",
    )
    .get(token);

  if (!row || row.firmware_id !== firmwareId || row.used === 1 || row.expires_at < nowMs) {
    return false;
  }

  db.prepare("UPDATE ota_download_tokens SET used = 1 WHERE token = ?").run(token);
  return true;
}
