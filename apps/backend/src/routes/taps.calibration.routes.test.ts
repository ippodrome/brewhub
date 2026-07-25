import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { MqttClient } from "mqtt";
import { buildApp } from "../app.js";
import { createDbClient } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { createUser } from "../db/repositories/users.repo.js";
import { hashPassword } from "../auth/password.js";
import { loadConfig } from "../config/env.js";
import { insertDevice } from "../db/repositories/devices.repo.js";
import { getTap, insertTap } from "../db/repositories/taps.repo.js";
import { applyFlowReading } from "../taps/apply-flow-reading.js";

/**
 * End-to-end over the real router, schema validation and migrated SQLite —
 * the unit tests cover the arithmetic, this covers the parts only the wired-up
 * system has: session persistence, the 422 contract, and the remaining-volume
 * restatement interacting with the live pour path.
 */
async function setUp(): Promise<{ app: FastifyInstance; token: string; tapId: number }> {
  const db = createDbClient(":memory:");
  runMigrations(db);
  createUser(db, "admin", hashPassword("correct-password"));
  insertDevice(db, { id: "kegerator-01", name: "Keezer", type: "kegerator" });

  const tap = insertTap(db, "kegerator-01", {
    measurementType: "flow",
    flowIndex: 0,
    pulsesPerLiter: 5000,
    name: "Pale Ale",
    fullVolumeMl: 19000,
  });

  const config = loadConfig({ NODE_ENV: "test", JWT_SECRET: "test-secret-at-least-16-chars" });
  const app = await buildApp({ db, config });
  app.decorate("mqttClient", { publish: vi.fn() } as unknown as MqttClient);

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "correct-password" },
  });

  return { app, token: login.json().token as string, tapId: tap.id };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** Simulates the device reporting a cumulative pulse count, driving the same path live telemetry does. */
function pour(app: FastifyInstance, cumulativePulses: number, nowMs: number): void {
  applyFlowReading(app.db, "kegerator-01", { index: 0, pulseCount: cumulativePulses }, nowMs);
}

describe("flow calibration routes", () => {
  it("runs a full calibration and installs the measured factor", async () => {
    const { app, token, tapId } = await setUp();
    const url = `/api/devices/kegerator-01/taps/${tapId}/calibration`;

    const started = await app.inject({ method: "POST", url, headers: auth(token) });
    expect(started.statusCode).toBe(201);
    expect(started.json().pulsesSoFar).toBe(0);

    // The meter really counts 5400 pulses while one litre goes through.
    pour(app, 5400, 1000);

    const progress = await app.inject({ method: "GET", url, headers: auth(token) });
    expect(progress.json().pulsesSoFar).toBe(5400);

    const finished = await app.inject({
      method: "POST",
      url: `${url}/finish`,
      headers: auth(token),
      payload: { method: "volume", actualVolumeMl: 1000 },
    });

    expect(finished.statusCode).toBe(200);
    expect(finished.json().pulsesPerLiter).toBeCloseTo(5400);
    expect(finished.json().driftPercent).toBeCloseTo(8); // 5000 -> 5400

    expect(getTap(app.db, tapId)!.pulsesPerLiter).toBeCloseTo(5400);

    // Session is consumed, so a second finish has nothing to act on.
    const again = await app.inject({ method: "GET", url, headers: auth(token) });
    expect(again.statusCode).toBe(404);
  });

  it("restates remaining volume from the measured pour, not the old factor's estimate", async () => {
    const { app, token, tapId } = await setUp();
    const url = `/api/devices/kegerator-01/taps/${tapId}/calibration`;

    await app.inject({ method: "POST", url, headers: auth(token) });

    // Live pour processing subtracts using the OLD factor: 5400 pulses at
    // 5000 pulses/L looks like 1080 mL, so the tap now reads 17920.
    pour(app, 5400, 1000);
    expect(getTap(app.db, tapId)!.remainingVolumeMl).toBeCloseTo(19000 - 1080);

    await app.inject({
      method: "POST",
      url: `${url}/finish`,
      headers: auth(token),
      payload: { method: "volume", actualVolumeMl: 1000 },
    });

    // ...but only 1000 mL actually left the keg, so the estimate is replaced.
    expect(getTap(app.db, tapId)!.remainingVolumeMl).toBeCloseTo(18000);
  });

  it("rejects an implausible result with 422 and keeps the session open to retry", async () => {
    const { app, token, tapId } = await setUp();
    const url = `/api/devices/kegerator-01/taps/${tapId}/calibration`;

    await app.inject({ method: "POST", url, headers: auth(token) });
    pour(app, 5400, 1000);

    const rejected = await app.inject({
      method: "POST",
      url: `${url}/finish`,
      headers: auth(token),
      payload: { method: "volume", actualVolumeMl: 500_000 }, // mistyped
    });

    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().rejection.reason).toBe("implausible_factor");
    // Factor untouched, and the baseline is still there so a corrected
    // amount can be submitted without pouring again.
    expect(getTap(app.db, tapId)!.pulsesPerLiter).toBe(5000);
    expect((await app.inject({ method: "GET", url, headers: auth(token) })).statusCode).toBe(200);

    const retried = await app.inject({
      method: "POST",
      url: `${url}/finish`,
      headers: auth(token),
      payload: { method: "volume", actualVolumeMl: 1000 },
    });
    expect(retried.statusCode).toBe(200);
  });

  it("survives a backend restart mid-calibration, because the session is persisted", async () => {
    const { app, token, tapId } = await setUp();
    const url = `/api/devices/kegerator-01/taps/${tapId}/calibration`;

    await app.inject({ method: "POST", url, headers: auth(token) });
    pour(app, 5400, 1000);

    // A fresh Fastify instance over the same database — what a container
    // restart looks like from the session's point of view.
    const restarted = await buildApp({ db: app.db, config: app.appConfig });
    restarted.decorate("mqttClient", { publish: vi.fn() } as unknown as MqttClient);

    const finished = await restarted.inject({
      method: "POST",
      url: `${url}/finish`,
      headers: auth(token),
      payload: { method: "volume", actualVolumeMl: 1000 },
    });

    expect(finished.statusCode).toBe(200);
    expect(finished.json().pulsesPerLiter).toBeCloseTo(5400);
  });

  it("refuses to calibrate a weight-measured tap, which has no flow meter", async () => {
    const { app, token } = await setUp();
    insertDevice(app.db, { id: "scale-01", name: "Scale", type: "keg_scale" });
    const weightTap = insertTap(app.db, "kegerator-01", {
      measurementType: "weight",
      weightDeviceId: "scale-01",
      weightIndex: 0,
      tareWeightG: 4000,
      fullWeightG: 23000,
      name: "Stout",
      fullVolumeMl: 19000,
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/devices/kegerator-01/taps/${weightTap.id}/calibration`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(400);
  });

  it("requires authentication", async () => {
    const { app, tapId } = await setUp();
    const res = await app.inject({
      method: "POST",
      url: `/api/devices/kegerator-01/taps/${tapId}/calibration`,
    });
    expect(res.statusCode).toBe(401);
  });
});
