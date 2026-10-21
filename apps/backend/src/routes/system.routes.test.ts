import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { createDbClient } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { loadConfig } from "../config/env.js";

const SECRET = "u".repeat(40);

async function setUp(env: Record<string, string> = {}, fetchImpl?: typeof fetch) {
  const db = createDbClient(":memory:");
  runMigrations(db);
  const config = loadConfig({
    NODE_ENV: "test",
    JWT_SECRET: "test-secret-at-least-16-chars",
    BREWHUB_VERSION: "1.0.0",
    UPDATER_URL: "http://updater:8080",
    UPDATER_SECRET: SECRET,
    ...env,
  });
  const app = await buildApp({ db, config, fetchImpl });
  const token = app.jwt.sign({ username: "admin" });
  return { app, auth: { authorization: `Bearer ${token}` } };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("system routes", () => {
  it("require a valid JWT", async () => {
    const fetchImpl = vi.fn();
    const { app } = await setUp({}, fetchImpl as unknown as typeof fetch);
    for (const [method, url] of [
      ["GET", "/api/system/version"],
      ["GET", "/api/system/update/check"],
      ["GET", "/api/system/update/status"],
      ["POST", "/api/system/update"],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports the baked-in version, also on /api/health", async () => {
    const { app, auth } = await setUp();
    const v = await app.inject({ method: "GET", url: "/api/system/version", headers: auth });
    expect(v.json()).toEqual({ version: "1.0.0", updaterConfigured: true });
    const h = await app.inject({ method: "GET", url: "/api/health" });
    expect(h.json().version).toBe("1.0.0");
  });

  it("returns 503 when the updater is not configured", async () => {
    const { app, auth } = await setUp({ UPDATER_URL: "", UPDATER_SECRET: "" });
    const res = await app.inject({ method: "GET", url: "/api/system/update/check", headers: auth });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("updater_not_configured");
    const again = await app.inject({ method: "GET", url: "/api/system/update/check", headers: auth });
    expect(again.statusCode).toBe(503); // failures are never cached
  });

  it("proxies check with the shared secret and caches it", async () => {
    const fetchImpl = vi.fn(async () => json({ currentVersion: "1.0.0", updateAvailable: true, latest: { version: "1.1.0" } }));
    const { app, auth } = await setUp({}, fetchImpl as unknown as typeof fetch);
    const a = await app.inject({ method: "GET", url: "/api/system/update/check", headers: auth });
    const b = await app.inject({ method: "GET", url: "/api/system/update/check", headers: auth });
    expect(a.statusCode).toBe(200);
    expect(a.json().updateAvailable).toBe(true);
    expect(b.json()).toMatchObject({ cached: true, updateAvailable: true, latest: { version: "1.1.0" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://updater:8080/check");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);

    await app.inject({ method: "GET", url: "/api/system/update/check?force=1", headers: auth });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed checks", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "GitHub API returned 403" }, 502));
    const { app, auth } = await setUp({}, fetchImpl as unknown as typeof fetch);
    const a = await app.inject({ method: "GET", url: "/api/system/update/check", headers: auth });
    expect(a.statusCode).toBe(502);
    await app.inject({ method: "GET", url: "/api/system/update/check", headers: auth });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("validates and forwards an update request", async () => {
    const fetchImpl = vi.fn(async () => json({ state: "running", toVersion: "1.1.0" }, 202));
    const { app, auth } = await setUp({}, fetchImpl as unknown as typeof fetch);
    const bad = await app.inject({ method: "POST", url: "/api/system/update", headers: auth, payload: { version: "latest" } });
    expect(bad.statusCode).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();

    const ok = await app.inject({ method: "POST", url: "/api/system/update", headers: auth, payload: { version: "1.1.0" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().state).toBe("running");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://updater:8080/update");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ version: "1.1.0" });
  });

  it("passes through updater conflicts (e.g. already running)", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "An update is already running" }, 409));
    const { app, auth } = await setUp({}, fetchImpl as unknown as typeof fetch);
    const res = await app.inject({ method: "POST", url: "/api/system/update", headers: auth, payload: { version: "1.1.0" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already running/);
  });

  it("maps updater 401 to 502 so the UI doesn't log the user out", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "Unauthorized" }, 401));
    const { app, auth } = await setUp({}, fetchImpl as unknown as typeof fetch);
    const res = await app.inject({ method: "GET", url: "/api/system/update/status", headers: auth });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("updater_auth_failed");
  });

  it("returns 502 when the updater is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const { app, auth } = await setUp({}, fetchImpl as unknown as typeof fetch);
    const res = await app.inject({ method: "GET", url: "/api/system/update/status", headers: auth });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("updater_unreachable");
  });
});
