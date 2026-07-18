import type Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  const applied = new Set(
    db.prepare<[], { id: string }>("SELECT id FROM schema_migrations").all().map((row) => row.id),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");

    // Some migrations recreate a table that other tables reference via FK
    // (SQLite can't ALTER a CHECK/NOT NULL constraint in place — see 0003,
    // 0006). PRAGMA foreign_keys is a no-op inside a transaction, so it has
    // to be toggled off around the whole migration, with an explicit
    // foreign_key_check afterward to catch anything the migration's own
    // INSERT...SELECT got wrong (dangling references DROP TABLE itself
    // wouldn't otherwise complain about).
    db.pragma("foreign_keys = OFF");
    const applyMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(file);
    });
    applyMigration();
    db.pragma("foreign_keys = ON");

    const violations = db.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) {
      throw new Error(`Migration ${file} left dangling foreign keys: ${JSON.stringify(violations)}`);
    }
  }
}
