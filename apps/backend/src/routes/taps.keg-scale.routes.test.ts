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
import { getTap } from "../db/repositories/taps.repo.js";
import { insertWeightReading } from "../db/repositories/weight-readings.repo.js";
import { applyWeightReading } from "../taps/apply-weight-reading.js";

async function setUp(): Promise<{ app: FastifyInstance; token: string }> {
  const db = createDbClient(":memory:");
  runMigrations(db);
  createUser(db, "admin", hashPassword("correct-password"));
  insertDevice(db, { id: "kegerator-01", name: "Keezer", type: "kegerator" });
  insertDevice(db, { id: "scale-01", name: "Scale", type: "keg_scale" });
  const config = loadConfig({ NODE_ENV: "test", JWT_SECRET: "test-secret-at-least-16-chars" });
  const app = await buildApp({ db, config });
  app.decorate("mqttClient", { publish: vi.fn() } as unknown as MqttClient);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "correct-password" },
  });
  return { app, token: login.json().token as string };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function createWeightTap(app: FastifyInstance, token: string, extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/api/devices/kegerator-01/taps",
    headers: auth(token),
    payload: {
      measurementType: "weight",
      weightDeviceId: "scale-01",
      weightIndex: 0,
      tareWeightG: 4000,
      name: "Pils",
      fullVolumeMl: 19000,
      ...extra,
    },
  });
  return res;
}

describe("keg-scale taps", () => {
  it("creates a weight tap without a full weight and derives volume from density", async () => {
    const { app, token } = await setUp();
    const res = await createWeightTap(app, token);
    expect(res.statusCode).toBe(201);
    const tap = res.json();
    expect(tap.beerDensityKgPerL).toBeCloseTo(1.01);
    expect(tap.fullWeightG).toBeCloseTo(4000 + 19000 * 1.01);

    applyWeightReading(app.db, "scale-01", { index: 0, grams: 4000 + 10100 });
    expect(getTap(app.db, tap.id)!.remainingVolumeMl).toBeCloseTo(10000);
  });

  it("uses FG over density and can clear it again", async () => {
    const { app, token } = await setUp();
    const tap = (await createWeightTap(app, token, { finalGravitySg: 1.02 })).json();
    insertWeightReading(app.db, "scale-01", 0, 1, 4000 + 10200);
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/devices/kegerator-01/taps/${tap.id}`,
      headers: auth(token),
      payload: { name: "Pils" },
    });
    expect(patched.json().remainingVolumeMl).toBeCloseTo(10000);

    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/devices/kegerator-01/taps/${tap.id}`,
      headers: auth(token),
      payload: { finalGravitySg: null },
    });
    expect(cleared.json().finalGravitySg).toBeNull();
    expect(cleared.json().remainingVolumeMl).toBeCloseTo(10200 / 1.01);
  });

  it("rejects implausible density and requires auth", async () => {
    const { app, token } = await setUp();
    expect((await createWeightTap(app, token, { beerDensityKgPerL: 10 })).statusCode).toBe(400);
    const unauth = await app.inject({ method: "GET", url: "/api/devices/scale-01/weight-taps" });
    expect(unauth.statusCode).toBe(401);
  });

  it("lists weight taps for a scale", async () => {
    const { app, token } = await setUp();
    await createWeightTap(app, token);
    const res = await app.inject({ method: "GET", url: "/api/devices/scale-01/weight-taps", headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    const notScale = await app.inject({ method: "GET", url: "/api/devices/kegerator-01/weight-taps", headers: auth(token) });
    expect(notScale.statusCode).toBe(400);
  });

  it("tare-now captures the latest reading as the empty keg weight", async () => {
    const { app, token } = await setUp();
    const tap = (await createWeightTap(app, token)).json();
    const url = `/api/devices/kegerator-01/taps/${tap.id}/tare-now`;

    const noReading = await app.inject({ method: "POST", url, headers: auth(token), payload: {} });
    expect(noReading.statusCode).toBe(409);

    insertWeightReading(app.db, "scale-01", 0, 1, 4321);
    const res = await app.inject({ method: "POST", url, headers: auth(token), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().tareWeightG).toBe(4321);
    expect(res.json().remainingVolumeMl).toBe(0);

    const bad = await app.inject({ method: "POST", url, headers: auth(token), payload: { grams: 1 } });
    expect(bad.statusCode).toBe(400);
  });
});
