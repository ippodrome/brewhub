import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { createDbClient } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { createUser } from "../db/repositories/users.repo.js";
import { hashPassword } from "../auth/password.js";
import { loadConfig } from "../config/env.js";
import { insertDevice } from "../db/repositories/devices.repo.js";
import { insertDecision } from "../db/repositories/control-state.repo.js";
import type { ControlDecisionPayload } from "@brewhub/shared-types";

const DECISION: ControlDecisionPayload = {
  deviceId: "fermenter-01",
  kind: "transition",
  from: "idle",
  to: "cooling",
  reason: "above_deadband",
  temperatureC: 19.42,
  thresholdC: 19.2,
  elapsedMs: 372000,
  remainingMs: 0,
};

async function setUp(): Promise<{ app: FastifyInstance; token: string; db: ReturnType<typeof createDbClient> }> {
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

  return { app, token: JSON.parse(login.body).token as string, db };
}

describe("GET /api/devices/:id/decisions", () => {
  it("returns the device's decisions, newest first", async () => {
    const { app, token, db } = await setUp();
    insertDecision(db, DECISION, 1_700_000_000_000);
    insertDecision(db, { ...DECISION, reason: "below_deadband" }, 1_700_000_060_000);

    const response = await app.inject({
      method: "GET",
      url: "/api/devices/fermenter-01/decisions",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(2);
    expect(body[0].reason).toBe("below_deadband");
  });

  it("carries the reason and its numbers, not a formatted sentence", async () => {
    const { app, token, db } = await setUp();
    insertDecision(db, { ...DECISION, kind: "blocked", reason: "min_off_not_met", remainingMs: 221000 }, 1_700_000_000_000);

    const response = await app.inject({
      method: "GET",
      url: "/api/devices/fermenter-01/decisions",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(JSON.parse(response.body)[0]).toMatchObject({
      kind: "blocked",
      reason: "min_off_not_met",
      temperatureC: 19.42,
      thresholdC: 19.2,
      remainingMs: 221000,
    });
  });

  it("honours an explicit limit", async () => {
    const { app, token, db } = await setUp();
    for (let i = 0; i < 5; i++) insertDecision(db, DECISION, 1_700_000_000_000 + i * 1000);

    const response = await app.inject({
      method: "GET",
      url: "/api/devices/fermenter-01/decisions?limit=2",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(JSON.parse(response.body)).toHaveLength(2);
  });

  // A wall display reconnecting with a huge limit must not be able to pull the
  // whole table across the wire.
  it("refuses a limit beyond the cap rather than honouring it", async () => {
    const { app, token } = await setUp();

    const response = await app.inject({
      method: "GET",
      url: "/api/devices/fermenter-01/decisions?limit=999999",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(400);
  });

  it("404s for a device that does not exist", async () => {
    const { app, token } = await setUp();

    const response = await app.inject({
      method: "GET",
      url: "/api/devices/nope/decisions",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it("rejects an unauthenticated request", async () => {
    const { app } = await setUp();

    const response = await app.inject({ method: "GET", url: "/api/devices/fermenter-01/decisions" });

    expect(response.statusCode).toBe(401);
  });
});
