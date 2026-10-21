import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readdir, readFile, rm, stat, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join } from "node:path";

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");
const SIDECARS = ["-wal", "-shm"] as const;

export interface BackupRecord {
  dir: string;
  files: string[];
  sha256: string;
  bytes: number;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function sha256(p: string): Promise<string> {
  return createHash("sha256").update(await readFile(p)).digest("hex");
}

async function hasSqliteHeader(p: string): Promise<boolean> {
  const fh = await open(p, "r");
  try {
    const buf = Buffer.alloc(16);
    await fh.read(buf, 0, 16, 0);
    return buf.equals(SQLITE_MAGIC);
  } finally {
    await fh.close();
  }
}

/**
 * Optional deep check with Node's built-in SQLite (Node ≥22.13). Returns
 * null when the module isn't available so the caller can fall back to the
 * header + checksum checks, which are always done.
 */
async function integrityCheck(p: string): Promise<string | null> {
  try {
    const mod = createRequire(import.meta.url)("node:sqlite") as {
      DatabaseSync: new (path: string, opts?: { readOnly?: boolean }) => {
        prepare(sql: string): { get(): Record<string, unknown> };
        close(): void;
      };
    };
    const db = new mod.DatabaseSync(p, { readOnly: true });
    try {
      const row = db.prepare("PRAGMA integrity_check").get();
      return String(Object.values(row)[0]);
    } finally {
      db.close();
    }
  } catch (err) {
    if (err instanceof Error && /no such built-in module|Cannot find module/i.test(err.message)) return null;
    throw err;
  }
}

/**
 * Copies the database (plus WAL/SHM sidecars if present) into a new
 * timestamped directory and verifies the copy: identical checksum, valid
 * SQLite header, and PRAGMA integrity_check = ok where available. Must be
 * called with the backend stopped so the file isn't changing underneath.
 */
export async function createBackup(dbPath: string, backupRoot: string, label: string): Promise<BackupRecord> {
  if (!(await exists(dbPath))) throw new Error(`Database not found at ${dbPath}`);
  const dir = join(backupRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}_${label.replace(/[^\w.-]/g, "_")}`);
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  const name = basename(dbPath);
  for (const suffix of ["", ...SIDECARS]) {
    const src = dbPath + suffix;
    if (!(await exists(src))) continue;
    await copyFile(src, join(dir, name + suffix));
    files.push(name + suffix);
  }
  const copy = join(dir, name);
  const [a, b] = [await sha256(dbPath), await sha256(copy)];
  if (a !== b) throw new Error("Backup verification failed: checksum mismatch");
  if (!(await hasSqliteHeader(copy))) throw new Error("Backup verification failed: not a SQLite database");
  // integrity_check opens the copy, which may fold a copied WAL into it —
  // so run it on a scratch copy, keeping the backup byte-identical.
  const scratch = join(dir, ".verify.db");
  await copyFile(copy, scratch);
  for (const s of SIDECARS) if (files.includes(name + s)) await copyFile(join(dir, name + s), scratch + s);
  try {
    const result = await integrityCheck(scratch);
    if (result !== null && result !== "ok") throw new Error(`Backup verification failed: integrity_check = ${result}`);
  } finally {
    for (const s of ["", ...SIDECARS]) await rm(scratch + s, { force: true });
  }
  return { dir, files, sha256: a, bytes: (await stat(copy)).size };
}

/** Puts a backup back in place, removing sidecars the backup didn't have. */
export async function restoreBackup(record: BackupRecord, dbPath: string): Promise<void> {
  const name = basename(dbPath);
  for (const suffix of SIDECARS) {
    if (!record.files.includes(name + suffix)) await unlink(dbPath + suffix).catch(() => undefined);
  }
  for (const file of record.files) {
    await copyFile(join(record.dir, file), dbPath + file.slice(name.length));
  }
  if ((await sha256(dbPath)) !== record.sha256) throw new Error("Restore verification failed: checksum mismatch");
}

/** Keeps the newest `keep` backup directories (names sort chronologically). */
export async function pruneBackups(backupRoot: string, keep: number): Promise<string[]> {
  if (!(await exists(backupRoot))) return [];
  const dirs = (await readdir(backupRoot, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const remove = dirs.slice(0, Math.max(0, dirs.length - keep));
  for (const d of remove) await rm(join(backupRoot, d), { recursive: true, force: true });
  return remove;
}
