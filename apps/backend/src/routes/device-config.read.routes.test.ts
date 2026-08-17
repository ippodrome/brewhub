import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { createDbClient } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { createUser } from "../db/repositories/users.repo.js";
import { hashPassword } from "../auth/password.js";
import { loadConfig } from "../config/env.js";
import { insertDevice } from "../db/repositories/devices.repo.js";

/**
 * The frontend could write a device's control config but never read it back,
 * which is why DeviceConfigForm starts at hardcoded defaults rather than the
 * device's real values. The display view needs the setpoint and hysteresis to
 * draw its temperature band at all — a band without them is just a
 * thermometer strip.
 */
async function setUp(): Promise<{ app: FastifyInstance; token: string }> {
  const db = createDbClient(":memory:");
  runMigrations(db);
  createUser(db, "admin", hashPassword("correct-password"));
  insertDevice(db, { id: "fermenter-01", name: "Chamber", type: "fermenter" });

  const config = loadConfig({ NODE_ENV: "test", JWT_SECRET: "test-secret-at-least-16-chars" });
  const app = await buildApp({ db, config });

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "correct-password" },
  });

  return { app, token: JSON.parse(login.body).token as string };
}

describe("GET /api/devices/:id/config", () => {
  it("returns the device's stored control config", async () => {
    const { app, token } = await setUp();

    const response = await app.inject({
      method: "GET",
      url: "/api/devices/fermenter-01/config",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({
      setpointC: expect.any(Number),
      hysteresisC: expect.any(Number),
      mode: expect.any(String),
    });
  });

  it("reflects a setpoint written through the config route", async () => {
    const { app, token } = await setUp();

    await app.inject({
      method: "PATCH",
      url: "/api/devices/fermenter-01/config",
      headers: { authorization: `Bearer ${token}` },
      payload: { setpointC: 18.5 },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/devices/fermenter-01/config",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(JSON.parse(response.body).setpointC).toBe(18.5);
  });

  it("404s for a device that does not exist", async () => {
    const { app, token } = await setUp();

    const response = await app.inject({
      method: "GET",
      url: "/api/devices/nope/config",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  // Same gate as every other device route — a wall tablet still authenticates.
  it("rejects an unauthenticated request", async () => {
    const { app } = await setUp();

    const response = await app.inject({
      method: "GET",
      url: "/api/devices/fermenter-01/config",
    });

    expect(response.statusCode).toBe(401);
  });
});
