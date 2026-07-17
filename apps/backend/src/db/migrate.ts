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
    const applyMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(file);
    });
    applyMigration();
  }
}
