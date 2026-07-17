import type Database from "better-sqlite3";
import type { PourEvent } from "@brewhub/shared-types";

interface PourEventRow {
  id: number;
  tap_id: number;
  volume_ml: number;
  started_at: number;
  ended_at: number;
}

function toPourEvent(row: PourEventRow): PourEvent {
  return {
    id: row.id,
    tapId: row.tap_id,
    volumeMl: row.volume_ml,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export function startPourEvent(
  db: Database.Database,
  tapId: number,
  volumeMl: number,
  nowMs: number,
): number {
  const result = db
    .prepare(
      "INSERT INTO pour_events (tap_id, volume_ml, started_at, ended_at) VALUES (?, ?, ?, ?)",
    )
    .run(tapId, volumeMl, nowMs, nowMs);
  return Number(result.lastInsertRowid);
}

export function extendPourEvent(
  db: Database.Database,
  pourEventId: number,
  addedVolumeMl: number,
  nowMs: number,
): void {
  db.prepare(
    "UPDATE pour_events SET volume_ml = volume_ml + ?, ended_at = ? WHERE id = ?",
  ).run(addedVolumeMl, nowMs, pourEventId);
}

export function listPourEventsForTap(
  db: Database.Database,
  tapId: number,
  limit = 100,
): PourEvent[] {
  const rows = db
    .prepare<[number, number], PourEventRow>(
      "SELECT * FROM pour_events WHERE tap_id = ? ORDER BY started_at DESC LIMIT ?",
    )
    .all(tapId, limit);
  return rows.map(toPourEvent);
}
