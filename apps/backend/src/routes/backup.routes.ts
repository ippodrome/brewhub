import { createReadStream } from "node:fs";
import { rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

/** Also used by app.ts to set the @fastify/multipart global file-size limit. */
export const MAX_RESTORE_UPLOAD_BYTES = 512 * 1024 * 1024;

// SQLite's on-disk file format always starts with this exact 16-byte magic
// header — the cheapest possible sanity check that an uploaded "backup" is
// actually a SQLite database before we do anything destructive with it.
const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "utf8");

function backupFilename(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `brewhub-backup-${stamp}.db`;
}

export async function backupRoutes(fastify: FastifyInstance): Promise<void> {
  // Uses better-sqlite3's online backup API (SQLite's own backup C API under
  // the hood) rather than a raw file copy — safe to run against a live,
  // concurrently-written WAL-mode database and always produces a single
  // self-contained file with no separate -wal/-shm sidecars to also copy.
  fastify.get("/api/backup", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const tmpPath = join(tmpdir(), `brewhub-backup-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    await fastify.db.backup(tmpPath);

    const filename = backupFilename();
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    reply.header("Content-Length", (await stat(tmpPath)).size);

    const stream = createReadStream(tmpPath);
    stream.on("close", () => {
      unlink(tmpPath).catch(() => {
        // Best-effort cleanup — a leftover tmp file isn't harmful, just untidy.
      });
    });
    return reply.send(stream);
  });

  // Deliberately conservative: validates the upload, safety-copies the
  // CURRENT database before touching anything, then atomically swaps the
  // restored file into place. Does NOT restart the process — the process
  // already has the old database file open by file descriptor (not by
  // path), so it keeps running against the old data completely unaffected
  // until it's restarted, at which point it opens DB_PATH fresh and sees
  // the restored content. See README "Backup" for the exact restart step.
  fastify.post("/api/backup/restore", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const body = request.body as { file?: Buffer } | undefined;
    if (!body?.file || !Buffer.isBuffer(body.file)) {
      return reply.code(400).send({ error: "Missing file field" });
    }
    if (!body.file.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)) {
      return reply.code(400).send({ error: "That file isn't a SQLite database — refusing to restore" });
    }

    const dbPath = fastify.appConfig.DB_PATH;
    const safetyPath = `${dbPath}.pre-restore-${Date.now()}.bak`;
    const stagingPath = `${dbPath}.restore-pending`;

    await fastify.db.backup(safetyPath);

    await writeFile(stagingPath, body.file);
    await rename(stagingPath, dbPath);

    // Stale WAL/SHM sidecars belong to the file that used to live at this
    // path — replaying them against the freshly-restored main file on next
    // open would reintroduce data the restore was meant to discard.
    await rm(`${dbPath}-wal`, { force: true });
    await rm(`${dbPath}-shm`, { force: true });

    return reply.send({ ok: true, restartRequired: true, safetyBackup: safetyPath });
  });
}
