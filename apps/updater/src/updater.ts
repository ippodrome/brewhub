import { mkdir, readFile, rename, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import type { UpdaterConfig } from "./config.js";
import type { Compose } from "./compose.js";
import { createBackup, pruneBackups, restoreBackup, type BackupRecord } from "./backup.js";
import { readTags, writeTags, type ImageTags } from "./envfile.js";
import type { ReleaseInfo } from "./github.js";
import { compareVersions, normalizeVersion, parseVersion } from "./version.js";

export type UpdateState =
  | "idle"
  | "running"
  | "succeeded"
  | "failed" // nothing was changed, or the change was cleanly undone before restart
  | "rolled_back" // new version failed; previous version + database restored and healthy
  | "rollback_failed"; // needs a human — see docs/UPDATERING.md

export type UpdateStep =
  | "checking"
  | "pulling"
  | "stopping"
  | "backing_up"
  | "switching"
  | "starting"
  | "health_check"
  | "rolling_back"
  | "done";

export interface UpdateStatus {
  state: UpdateState;
  step: UpdateStep | null;
  fromVersion: string | null;
  toVersion: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  dryRun: boolean;
  error: string | null;
  rollback: { attempted: boolean; ok: boolean | null; error: string | null };
  backup: { dir: string; bytes: number; sha256: string } | null;
  log: Array<{ ts: string; message: string }>;
}

export interface CheckResult {
  currentVersion: string | null;
  latest: ReleaseInfo;
  updateAvailable: boolean;
  /** Why an update can't run even though one exists (e.g. unpinned tags). */
  blockedReason: string | null;
  checkedAt: string;
}

export interface UpdaterDeps {
  config: UpdaterConfig;
  compose: Compose;
  fetchRelease: () => Promise<ReleaseInfo>;
  /** Resolves true once the backend answers healthy with `version`. */
  waitHealthy: (version: string) => Promise<boolean>;
  now?: () => Date;
}

export function emptyStatus(): UpdateStatus {
  return {
    state: "idle",
    step: null,
    fromVersion: null,
    toVersion: null,
    startedAt: null,
    finishedAt: null,
    dryRun: false,
    error: null,
    rollback: { attempted: false, ok: null, error: null },
    backup: null,
    log: [],
  };
}

const MAX_LOG = 300;

export class Updater {
  private status: UpdateStatus = emptyStatus();
  private running: Promise<UpdateStatus> | null = null;
  private readonly now: () => Date;

  constructor(private readonly deps: UpdaterDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private get statusFile(): string {
    return join(this.deps.config.stateDir, "status.json");
  }
  private get backupRoot(): string {
    return join(this.deps.config.stateDir, "backups");
  }

  /** Loads the last status; a run interrupted by a crash is reported as such. */
  async init(): Promise<void> {
    await mkdir(this.backupRoot, { recursive: true });
    try {
      this.status = JSON.parse(await readFile(this.statusFile, "utf8")) as UpdateStatus;
      if (this.status.state === "running") {
        this.status.state = "rollback_failed";
        this.status.error = "The updater restarted in the middle of an update. Check the stack manually (see docs/UPDATERING.md).";
        this.status.finishedAt = this.now().toISOString();
        await this.persist();
      }
    } catch {
      this.status = emptyStatus();
    }
  }

  getStatus(): UpdateStatus {
    return structuredClone(this.status);
  }

  isRunning(): boolean {
    return this.running !== null;
  }

  async currentTags(): Promise<ImageTags> {
    return readTags(this.deps.config.envFile);
  }

  async check(): Promise<CheckResult> {
    const latest = await this.deps.fetchRelease();
    const tags = await this.currentTags();
    const current = parseVersion(tags.backend) ? normalizeVersion(tags.backend) : null;
    return {
      currentVersion: current,
      latest,
      updateAvailable: current === null ? false : compareVersions(latest.version, current) > 0,
      blockedReason: pinnedReason(tags),
      checkedAt: this.now().toISOString(),
    };
  }

  /**
   * Starts an update to `requestedVersion`, which must equal the current
   * latest GitHub release. Returns immediately; poll getStatus().
   */
  async start(requestedVersion: string, opts: { dryRun?: boolean } = {}): Promise<UpdateStatus> {
    if (this.running) throw new UpdaterError(409, "An update is already running");
    const dryRun = this.deps.config.dryRun || opts.dryRun === true;
    if (!parseVersion(requestedVersion)) throw new UpdaterError(400, "version must look like 1.2.3");
    const target = normalizeVersion(requestedVersion);

    const tags = await this.currentTags();
    const blocked = pinnedReason(tags);
    if (blocked) throw new UpdaterError(409, blocked);
    const latest = await this.deps.fetchRelease();
    if (latest.version !== target) {
      throw new UpdaterError(409, `Only the latest release (${latest.version}) can be installed`);
    }
    const from = normalizeVersion(tags.backend);
    if (compareVersions(target, from) <= 0 && !dryRun) {
      throw new UpdaterError(409, `Already running ${from}`);
    }

    this.status = {
      ...emptyStatus(),
      state: "running",
      step: "checking",
      fromVersion: from,
      toVersion: target,
      startedAt: this.now().toISOString(),
      dryRun,
    };
    await this.log(`Update ${from} → ${target}${dryRun ? " (dry run)" : ""} started`);
    this.running = this.run(tags, { backend: target, frontend: target }, dryRun).finally(() => {
      this.running = null;
    });
    return this.getStatus();
  }

  /** For tests: wait for the background run. */
  async waitForIdle(): Promise<UpdateStatus> {
    if (this.running) await this.running;
    return this.getStatus();
  }

  private async run(previous: ImageTags, next: ImageTags, dryRun: boolean): Promise<UpdateStatus> {
    const { compose, config } = this.deps;
    let backup: BackupRecord | null = null;
    let switched = false; // true once anything on disk/containers points at `next`
    let stopped = false;
    try {
      // 1. Pull first: a missing image or a registry/auth problem fails here,
      //    before anything has been stopped or changed.
      await this.setStep("pulling", `Pulling images ${next.backend} (backend) and ${next.frontend} (frontend)`);
      await compose.pull(next);

      if (dryRun) {
        await this.setStep("backing_up", "Dry run: verifying a backup of the live database (backend keeps running)");
        backup = await createBackup(config.dbPath, join(config.stateDir, "dry-run"), `dryrun-${next.backend}`);
        this.status.backup = { dir: backup.dir, bytes: backup.bytes, sha256: backup.sha256 };
        await pruneBackups(join(config.stateDir, "dry-run"), 1);
        await this.log("Dry run: would stop backend, write new tags to .env, recreate backend + caddy and health-check");
        return await this.finish("succeeded");
      }

      // 2. Stop the backend so the database file is quiescent, then back up.
      await this.setStep("stopping", "Stopping backend");
      stopped = true;
      await compose.stopBackend();

      await this.setStep("backing_up", "Backing up database");
      backup = await createBackup(config.dbPath, this.backupRoot, `before-${next.backend}_from-${previous.backend}`);
      await copyFile(config.envFile, join(backup.dir, "env.before"));
      this.status.backup = { dir: backup.dir, bytes: backup.bytes, sha256: backup.sha256 };
      await this.log(`Backup verified: ${backup.dir} (${backup.bytes} bytes, sha256 ${backup.sha256.slice(0, 12)}…)`);

      // 3. Point .env at the exact new version (so a manual `compose up` later
      //    agrees with what's running), then recreate the app containers.
      await this.setStep("switching", `Pinning ${next.backend} in .env`);
      switched = true;
      await writeTags(config.envFile, next);

      await this.setStep("starting", "Recreating backend and caddy");
      await compose.up(next);

      await this.setStep("health_check", `Waiting for backend to report ${next.backend}`);
      const healthy = await this.deps.waitHealthy(next.backend);
      if (!healthy) throw new Error(`Backend did not become healthy on ${next.backend}`);
      if (!(await compose.servicesRunning(next))) throw new Error("caddy is not running after the update");

      const pruned = await pruneBackups(this.backupRoot, config.keepBackups);
      if (pruned.length) await this.log(`Removed ${pruned.length} old backup(s)`);
      return await this.finish("succeeded");
    } catch (err) {
      const message = errMsg(err);
      this.status.error = message;
      await this.log(`ERROR: ${message}`);
      if (!stopped) {
        // Nothing changed (pull/validation failed) — the old version is still up.
        return await this.finish("failed");
      }
      return await this.rollback(previous, backup, switched);
    }
  }

  private async rollback(previous: ImageTags, backup: BackupRecord | null, switched: boolean): Promise<UpdateStatus> {
    const { compose, config } = this.deps;
    this.status.rollback.attempted = true;
    await this.setStep("rolling_back", `Rolling back to ${previous.backend}`);
    try {
      if (switched) {
        await compose.stopBackend().catch((e) => this.log(`(stop during rollback: ${errMsg(e)})`));
        await writeTags(config.envFile, previous);
        if (backup) {
          await restoreBackup(backup, config.dbPath);
          await this.log("Database restored from the pre-update backup");
        }
      }
      await compose.up(previous);
      const healthy = await this.deps.waitHealthy(previous.backend);
      if (!healthy) throw new Error(`Previous version ${previous.backend} did not become healthy either`);
      this.status.rollback.ok = true;
      await this.log(`Rolled back: ${previous.backend} is running again`);
      return await this.finish(switched ? "rolled_back" : "failed");
    } catch (err) {
      this.status.rollback.ok = false;
      this.status.rollback.error = errMsg(err);
      await this.log(`ROLLBACK FAILED: ${errMsg(err)}`);
      return await this.finish("rollback_failed");
    }
  }

  private async setStep(step: UpdateStep, message: string): Promise<void> {
    this.status.step = step;
    await this.log(message);
  }

  private async finish(state: UpdateState): Promise<UpdateStatus> {
    this.status.state = state;
    this.status.step = "done";
    this.status.finishedAt = this.now().toISOString();
    await this.log(`Finished: ${state}`);
    return this.getStatus();
  }

  private async log(message: string): Promise<void> {
    this.status.log.push({ ts: this.now().toISOString(), message });
    if (this.status.log.length > MAX_LOG) this.status.log.splice(0, this.status.log.length - MAX_LOG);
    console.log(`[updater] ${message}`);
    await this.persist();
  }

  private async persist(): Promise<void> {
    const tmp = `${this.statusFile}.tmp`;
    await writeFile(tmp, JSON.stringify(this.status, null, 2));
    await rename(tmp, this.statusFile);
  }
}

export class UpdaterError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Rollback needs exact previous versions — refuse while tags float. */
export function pinnedReason(tags: ImageTags): string | null {
  if (!parseVersion(tags.backend) || !parseVersion(tags.frontend)) {
    return "BREWHUB_IMAGE_TAG and BREWHUB_FRONTEND_TAG in .env must be pinned to a version like 1.2.3 (not latest) before in-app updates can run";
  }
  return null;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Polls the backend health URL until it reports `version` or times out. */
export function createHealthWaiter(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  intervalMs = 3000,
): (version: string) => Promise<boolean> {
  return async (version) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const body = (await res.json()) as { status?: string; version?: string };
          if (body.status === "ok" && normalizeVersion(String(body.version ?? "")) === normalizeVersion(version)) return true;
        }
      } catch {
        // backend still starting
      }
      await sleep(intervalMs);
    }
    return false;
  };
}
