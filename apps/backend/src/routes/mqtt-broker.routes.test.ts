import { describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { createDbClient } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { createUser } from "../db/repositories/users.repo.js";
import { hashPassword } from "../auth/password.js";
import { loadConfig } from "../config/env.js";
import { MqttConnectionManager } from "../mqtt/manager.js";
import { FakeMqttClient } from "../mqtt/fake-client.test-helper.js";

async function setUp(probeOutcome: "connect" | "error" = "connect") {
  const db = createDbClient(":memory:");
  runMigrations(db);
  createUser(db, "admin", hashPassword("correct-password"));
  const config = loadConfig({
    NODE_ENV: "test",
    JWT_SECRET: "test-secret-at-least-16-chars",
    MQTT_URL: "mqtt://backend:envpw@mosquitto:1883",
  });
  const app: FastifyInstance = await buildApp({ db, config, mqttTimeoutMs: 200 });
  const created: FakeMqttClient[] = [];
  const probes: FakeMqttClient[] = [];
  const manager = new MqttConnectionManager({
    logger: app.log as FastifyBaseLogger,
    factory: (p) => {
      const c = new FakeMqttClient(p.url, { username: p.username, password: p.password });
      created.push(c);
      // Connect asynchronously, like a real broker would.
      setImmediate(() => c.emit("connect"));
      return c.asClient();
    },
    connectFn: (url, opts) => {
      const c = new FakeMqttClient(url, opts as Record<string, unknown>);
      probes.push(c);
      setImmediate(() => (probeOutcome === "connect" ? c.emit("connect") : c.emit("error", new Error("Connection refused: Not authorized"))));
      return c.asClient();
    },
  });
  manager.start({ url: config.MQTT_URL });
  app.decorate("mqttManager", manager);
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "correct-password" } });
  const headers = { authorization: `Bearer ${login.json().token as string}` };
  return { app, headers, created, probes };
}

describe("MQTT broker routes", () => {
  it("require auth", async () => {
    const { app } = await setUp();
    for (const [method, url] of [["GET", "/api/mqtt/broker"], ["PUT", "/api/mqtt/broker"], ["POST", "/api/mqtt/broker/test"]] as const) {
      const res = await app.inject({ method, url, payload: method === "GET" ? undefined : { mode: "builtin" } });
      expect(res.statusCode).toBe(401);
    }
  });

  it("GET returns env defaults with credentials stripped", async () => {
    const { app, headers } = await setUp();
    const res = await app.inject({ method: "GET", url: "/api/mqtt/broker", headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mode: "builtin", saved: false, hasPassword: false, builtinUrl: "mqtt://mosquitto:1883" });
    expect(res.body).not.toContain("envpw");
  });

  it("rejects invalid bodies", async () => {
    const { app, headers } = await setUp();
    for (const payload of [{ mode: "custom" }, { mode: "custom", host: "mqtt://ha:1883" }, { mode: "custom", host: "ha", port: 70000 }, { mode: "other" }]) {
      const res = await app.inject({ method: "PUT", url: "/api/mqtt/broker", headers, payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it("PUT custom saves, reconnects live and never returns the password", async () => {
    const { app, headers, created } = await setUp();
    const res = await app.inject({
      method: "PUT",
      url: "/api/mqtt/broker",
      headers,
      payload: { mode: "custom", host: "192.168.1.20", port: 1883, tls: false, username: "brewhub", password: "hunter2" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("hunter2");
    expect(res.json()).toMatchObject({ mode: "custom", saved: true, hasPassword: true, status: { state: "connected", url: "mqtt://192.168.1.20:1883" } });
    expect(created).toHaveLength(2);
    expect(created[0]!.ended).toBe(true);
    expect(created[1]!.opts).toMatchObject({ username: "brewhub", password: "hunter2" });

    // Saving again without a password keeps the stored one.
    await app.inject({ method: "PUT", url: "/api/mqtt/broker", headers, payload: { mode: "custom", host: "192.168.1.20", port: 1884, username: "brewhub", password: "" } });
    expect(created[2]!.opts).toMatchObject({ password: "hunter2" });
    expect(created[2]!.url).toBe("mqtt://192.168.1.20:1884");

    // Back to built-in → env URL again.
    const back = await app.inject({ method: "PUT", url: "/api/mqtt/broker", headers, payload: { mode: "builtin" } });
    expect(back.json().status.url).toBe("mqtt://mosquitto:1883");
    expect(created[3]!.url).toBe("mqtt://backend:envpw@mosquitto:1883");
  });

  it("POST test reports success without saving or touching the running client", async () => {
    const { app, headers, created, probes } = await setUp();
    const res = await app.inject({ method: "POST", url: "/api/mqtt/broker/test", headers, payload: { mode: "custom", host: "ha.local", port: 1883, username: "u", password: "p" } });
    expect(res.json()).toMatchObject({ ok: true, url: "mqtt://ha.local:1883", error: null });
    expect(probes).toHaveLength(1);
    expect(created).toHaveLength(1);
    const get = await app.inject({ method: "GET", url: "/api/mqtt/broker", headers });
    expect(get.json()).toMatchObject({ mode: "builtin", saved: false });
  });

  it("POST test surfaces broker errors", async () => {
    const { app, headers } = await setUp("error");
    const res = await app.inject({ method: "POST", url: "/api/mqtt/broker/test", headers, payload: { mode: "custom", host: "ha.local" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, error: "Connection refused: Not authorized" });
  });
});
