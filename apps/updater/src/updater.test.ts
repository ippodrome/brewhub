import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Compose } from "./compose.js";
import type { UpdaterConfig } from "./config.js";
import { readTags } from "./envfile.js";
import type { ReleaseInfo } from "./github.js";
import { Updater, UpdaterError } from "./updater.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const release = (version: string): ReleaseInfo => ({
  version,
  tag: `v${version}`,
  name: `v${version}`,
  notes: "notes",
  url: "https://github.com/x/y/releases/tag/v" + version,
  publishedAt: null,
});

function makeDb(path: string, value: string): void {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE IF NOT EXISTS t (v TEXT); DELETE FROM t;");
  db.prepare("INSERT INTO t (v) VALUES (?)").run(value);
  db.close();
}
function readDb(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true });
  const row = db.prepare("SELECT v FROM t").get() as { v: string };
  db.close();
  return row.v;
}

interface Harness {
  dir: string;
  config: UpdaterConfig;
  compose: { [K in keyof Compose]: ReturnType<typeof vi.fn> };
  waitHealthy: ReturnType<typeof vi.fn>;
  updater: Updater;
}

async function setUp(opts: { tag?: string; latest?: string; dryRun?: boolean } = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "updater-"));
  await mkdir(join(dir, "data"));
  const tag = opts.tag ?? "1.0.0";
  await writeFile(join(dir, ".env"), `# keep me\nJWT_SECRET=abc\nBREWHUB_IMAGE_TAG=${tag}\nBREWHUB_FRONTEND_TAG=${tag}\n`);
  makeDb(join(dir, "data", "brewhub.db"), "original");
  const config: UpdaterConfig = {
    port: 0,
    secret: "s".repeat(40),
    githubRepo: "x/y",
    composeProject: "brewhub",
    composeDir: dir,
    envFile: join(dir, ".env"),
    dbPath: join(dir, "data", "brewhub.db"),
    stateDir: join(dir, "state"),
    keepBackups: 2,
    backendHealthUrl: "http://backend/api/health",
    healthTimeoutMs: 10,
    dryRun: opts.dryRun ?? false,
  };
  const compose = {
    pull: vi.fn(async () => {}),
    stopBackend: vi.fn(async () => {}),
    up: vi.fn(async () => {}),
    servicesRunning: vi.fn(async () => true),
  };
  const waitHealthy = vi.fn(async () => true);
  const updater = new Updater({
    config,
    compose,
    fetchRelease: async () => release(opts.latest ?? "1.1.0"),
    waitHealthy,
  });
  await updater.init();
  return { dir, config, compose, waitHealthy, updater };
}

describe("Updater.check", () => {
  it("reports an available update from the pinned version", async () => {
    const h = await setUp();
    const r = await h.updater.check();
    expect(r.currentVersion).toBe("1.0.0");
    expect(r.latest.version).toBe("1.1.0");
    expect(r.updateAvailable).toBe(true);
    expect(r.blockedReason).toBeNull();
  });

  it("blocks updates while tags float on latest", async () => {
    const h = await setUp({ tag: "latest" });
    const r = await h.updater.check();
    expect(r.blockedReason).toMatch(/pinned/);
    await expect(h.updater.start("1.1.0")).rejects.toBeInstanceOf(UpdaterError);
  });
});

describe("Updater.start validation", () => {
  it("only accepts the current latest release", async () => {
    const h = await setUp();
    await expect(h.updater.start("1.2.0")).rejects.toThrow(/Only the latest release/);
    await expect(h.updater.start("latest")).rejects.toThrow(/1\.2\.3/);
    expect(h.compose.pull).not.toHaveBeenCalled();
  });

  it("refuses when already on the latest", async () => {
    const h = await setUp({ latest: "1.0.0" });
    await expect(h.updater.start("1.0.0")).rejects.toThrow(/Already running/);
  });

  it("refuses a second concurrent update", async () => {
    const h = await setUp();
    let release!: () => void;
    h.compose.pull.mockImplementation(() => new Promise<void>((r) => (release = r)));
    await h.updater.start("1.1.0");
    await expect(h.updater.start("1.1.0")).rejects.toThrow(/already running/);
    await vi.waitFor(() => expect(h.compose.pull).toHaveBeenCalled());
    release();
    await h.updater.waitForIdle();
  });
});

describe("Updater happy path", () => {
  it("pulls the exact tag, backs up, pins .env, recreates and health-checks", async () => {
    const h = await setUp();
    await h.updater.start("v1.1.0");
    const s = await h.updater.waitForIdle();

    expect(s.state).toBe("succeeded");
    expect(h.compose.pull).toHaveBeenCalledWith({ backend: "1.1.0", frontend: "1.1.0" });
    // pull happens before the backend is stopped
    expect(h.compose.pull.mock.invocationCallOrder[0]).toBeLessThan(h.compose.stopBackend.mock.invocationCallOrder[0]!);
    expect(h.compose.up).toHaveBeenCalledWith({ backend: "1.1.0", frontend: "1.1.0" });
    expect(h.waitHealthy).toHaveBeenCalledWith("1.1.0");
    expect(await readTags(h.config.envFile)).toEqual({ backend: "1.1.0", frontend: "1.1.0" });
    expect(await readFile(h.config.envFile, "utf8")).toContain("# keep me\nJWT_SECRET=abc");
    expect(s.backup?.bytes).toBeGreaterThan(0);
    const backupFiles = await readdir(s.backup!.dir);
    expect(backupFiles).toContain("brewhub.db");
    expect(backupFiles).toContain("env.before");
    const persisted = JSON.parse(await readFile(join(h.config.stateDir, "status.json"), "utf8"));
    expect(persisted.state).toBe("succeeded");
  });

  it("keeps only the newest N backups", async () => {
    const h = await setUp();
    const root = join(h.config.stateDir, "backups");
    for (const n of ["2020-01-01_a", "2020-01-02_b", "2020-01-03_c"]) await mkdir(join(root, n), { recursive: true });
    await h.updater.start("1.1.0");
    await h.updater.waitForIdle();
    const left = await readdir(root);
    expect(left).toHaveLength(2);
    expect(left).toContain("2020-01-03_c");
  });
});

describe("Updater failure and rollback", () => {
  it("pull failure changes nothing and needs no rollback", async () => {
    const h = await setUp();
    h.compose.pull.mockRejectedValue(new Error("manifest unknown"));
    await h.updater.start("1.1.0");
    const s = await h.updater.waitForIdle();
    expect(s.state).toBe("failed");
    expect(s.rollback.attempted).toBe(false);
    expect(h.compose.stopBackend).not.toHaveBeenCalled();
    expect(await readTags(h.config.envFile)).toEqual({ backend: "1.0.0", frontend: "1.0.0" });
  });

  it("unhealthy new version → restores old tags and the database", async () => {
    const h = await setUp();
    // Simulate the new version migrating the DB, then failing health.
    h.compose.up.mockImplementation(async (tags: { backend: string }) => {
      if (tags.backend === "1.1.0") makeDb(h.config.dbPath, "migrated-by-1.1.0");
    });
    h.waitHealthy.mockImplementation(async (v: string) => v === "1.0.0");

    await h.updater.start("1.1.0");
    const s = await h.updater.waitForIdle();

    expect(s.state).toBe("rolled_back");
    expect(s.rollback).toEqual({ attempted: true, ok: true, error: null });
    expect(h.compose.up).toHaveBeenLastCalledWith({ backend: "1.0.0", frontend: "1.0.0" });
    expect(await readTags(h.config.envFile)).toEqual({ backend: "1.0.0", frontend: "1.0.0" });
    expect(readDb(h.config.dbPath)).toBe("original");
  });

  it("caddy not running after update → rollback", async () => {
    const h = await setUp();
    h.compose.servicesRunning.mockResolvedValue(false);
    await h.updater.start("1.1.0");
    const s = await h.updater.waitForIdle();
    expect(s.state).toBe("rolled_back");
    expect(s.error).toMatch(/caddy/);
  });

  it("compose up failure → rollback", async () => {
    const h = await setUp();
    h.compose.up.mockImplementationOnce(async () => {
      throw new Error("port is already allocated");
    });
    await h.updater.start("1.1.0");
    const s = await h.updater.waitForIdle();
    expect(s.state).toBe("rolled_back");
    expect(h.compose.up).toHaveBeenCalledTimes(2);
  });

  it("backup failure → restarts the old version, nothing switched", async () => {
    const h = await setUp();
    h.config.dbPath = join(h.dir, "data", "missing.db");
    await h.updater.start("1.1.0");
    const s = await h.updater.waitForIdle();
    expect(s.state).toBe("failed");
    expect(s.rollback.ok).toBe(true);
    expect(h.compose.up).toHaveBeenCalledTimes(1);
    expect(h.compose.up).toHaveBeenCalledWith({ backend: "1.0.0", frontend: "1.0.0" });
    expect(await readTags(h.config.envFile)).toEqual({ backend: "1.0.0", frontend: "1.0.0" });
  });

  it("rollback that also fails is reported as rollback_failed", async () => {
    const h = await setUp();
    h.waitHealthy.mockResolvedValue(false);
    await h.updater.start("1.1.0");
    const s = await h.updater.waitForIdle();
    expect(s.state).toBe("rollback_failed");
    expect(s.rollback.ok).toBe(false);
    expect(s.rollback.error).toMatch(/1\.0\.0/);
    // even then, .env and DB point back at the old version
    expect(await readTags(h.config.envFile)).toEqual({ backend: "1.0.0", frontend: "1.0.0" });
  });

  it("a run interrupted by a restart is surfaced on init", async () => {
    const h = await setUp();
    let release!: () => void;
    h.compose.pull.mockImplementation(() => new Promise<void>((r) => (release = r)));
    await h.updater.start("1.1.0");
    const again = new Updater({ config: h.config, compose: h.compose, fetchRelease: async () => release_("1.1.0"), waitHealthy: h.waitHealthy });
    await again.init();
    expect(again.getStatus().state).toBe("rollback_failed");
    expect(again.getStatus().error).toMatch(/restarted/);
    await vi.waitFor(() => expect(h.compose.pull).toHaveBeenCalled());
    release();
    await h.updater.waitForIdle();
  });
});

const release_ = release;

describe("dry run", () => {
  it("pulls and verifies a backup but never stops, switches or recreates", async () => {
    const h = await setUp({ dryRun: true });
    await h.updater.start("1.1.0");
    const s = await h.updater.waitForIdle();
    expect(s.state).toBe("succeeded");
    expect(s.dryRun).toBe(true);
    expect(h.compose.pull).toHaveBeenCalled();
    expect(h.compose.stopBackend).not.toHaveBeenCalled();
    expect(h.compose.up).not.toHaveBeenCalled();
    expect(await readTags(h.config.envFile)).toEqual({ backend: "1.0.0", frontend: "1.0.0" });
  });
});

beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
