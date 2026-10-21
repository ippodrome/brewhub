import { describe, expect, it, vi } from "vitest";
import { composeBaseArgs, createCompose } from "./compose.js";
import { parseEnv, setEnvValues } from "./envfile.js";
import { fetchLatestRelease } from "./github.js";
import { isAuthorized } from "./server.js";
import { createHealthWaiter } from "./updater.js";
import { compareVersions } from "./version.js";
import type { UpdaterConfig } from "./config.js";

describe("version", () => {
  it("compares semver", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("latest", "0.0.1")).toBeLessThan(0);
  });
});

describe("envfile", () => {
  it("replaces keys in place and appends missing ones", () => {
    const out = setEnvValues("# c\nA=1\nBREWHUB_IMAGE_TAG=1.0.0\n", { BREWHUB_IMAGE_TAG: "1.1.0", BREWHUB_FRONTEND_TAG: "1.1.0" });
    expect(out).toBe("# c\nA=1\nBREWHUB_IMAGE_TAG=1.1.0\nBREWHUB_FRONTEND_TAG=1.1.0\n");
    expect(parseEnv('X="q"\n#Y=2')).toEqual({ X: "q" });
  });
});

describe("auth", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorized("Bearer abc", "abc")).toBe(true);
    expect(isAuthorized("Bearer abd", "abc")).toBe(false);
    expect(isAuthorized("abc", "abc")).toBe(false);
    expect(isAuthorized(undefined, "abc")).toBe(false);
  });
});

describe("compose", () => {
  const cfg = { composeProject: "brewhub", composeDir: "/mnt/c", envFile: "/mnt/c/.env", composeFiles: "docker-compose.yml:docker-compose.mosquitto.yml" } as UpdaterConfig;
  it("builds fixed args and only ever touches backend + caddy", async () => {
    expect(composeBaseArgs(cfg)).toEqual([
      "compose", "--project-name", "brewhub", "--project-directory", "/mnt/c", "--env-file", "/mnt/c/.env",
      "-f", "/mnt/c/docker-compose.yml", "-f", "/mnt/c/docker-compose.mosquitto.yml",
    ]);
    const run = vi.fn(async () => ({ code: 0, stdout: '{"Service":"backend","State":"running"}\n{"Service":"caddy","State":"running"}', stderr: "" }));
    const c = createCompose(cfg, run);
    await c.up({ backend: "1.1.0", frontend: "1.1.0" });
    const [args, env] = run.mock.calls[0] as unknown as [string[], NodeJS.ProcessEnv];
    expect(args.slice(-5)).toEqual(["up", "-d", "--no-deps", "--force-recreate", "backend", "caddy"].slice(-5));
    expect(args).not.toContain("updater");
    expect(env.BREWHUB_IMAGE_TAG).toBe("1.1.0");
    expect(await c.servicesRunning({ backend: "1.1.0", frontend: "1.1.0" })).toBe(true);
  });
  it("surfaces a non-zero exit as an error", async () => {
    const c = createCompose(cfg, async () => ({ code: 1, stdout: "", stderr: "denied" }));
    await expect(c.pull({ backend: "1", frontend: "1" })).rejects.toThrow(/denied/);
  });
});

describe("github", () => {
  it("parses the latest release and sends the token when set", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ tag_name: "v1.4.0", name: "1.4", body: "notes", html_url: "u" })));
    const r = await fetchLatestRelease("o/r", "tok", f);
    expect(r.version).toBe("1.4.0");
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
  it("explains 404 on a private repo without token", async () => {
    await expect(fetchLatestRelease("o/r", undefined, async () => new Response("", { status: 404 }))).rejects.toThrow(/GITHUB_TOKEN/);
  });
});

describe("health waiter", () => {
  it("waits until the expected version answers", async () => {
    let n = 0;
    const f = vi.fn(async () => {
      n++;
      return new Response(JSON.stringify({ status: "ok", version: n < 3 ? "1.0.0" : "1.1.0" }));
    }) as unknown as typeof fetch;
    const wait = createHealthWaiter("u", 60_000, f, async () => {}, 0);
    expect(await wait("1.1.0")).toBe(true);
    expect(n).toBe(3);
  });
});
