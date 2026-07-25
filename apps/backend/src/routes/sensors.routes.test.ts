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
import { recordSensorSeen, setControlSensor } from "../db/repositories/device-sensors.repo.js";
import { getDeviceConfig } from "../db/repositories/device-configs.repo.js";

const CONTROL = "28FF641F0417033A";
const OTHER = "28AA112233445566";

/**
 * ADR-020 hinges on the control sensor's offset actually reaching the device:
 * the backend correcting only its own copy would leave the UI and the ESP32
 * disagreeing about the temperature. These tests assert the publish, not just
 * the stored value.
 */
async function setUp(): Promise<{ app: FastifyInstance; token: string; publish: ReturnType<typeof vi.fn> }> {
  const db = createDbClient(":memory:");
  runMigrations(db);
  createUser(db, "admin", hashPassword("correct-password"));
  insertDevice(db, { id: "fermenter-01", name: "Chamber", type: "fermenter" });
  recordSensorSeen(db, "fermenter-01", CONTROL, Date.now());
  recordSensorSeen(db, "fermenter-01", OTHER, Date.now());
  setControlSensor(db, "fermenter-01", CONTROL);

  const config = loadConfig({ NODE_ENV: "test", JWT_SECRET: "test-secret-at-least-16-chars" });
  const app = await buildApp({ db, config });
  const publish = vi.fn();
  app.decorate("mqttClient", { publish } as unknown as MqttClient);

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "correct-password" },
  });

  return { app, token: login.json().token as string, publish };
}

function patchSensor(
  app: FastifyInstance,
  token: string,
  address: string,
  body: { label?: string | null; offsetC?: number; isControlSensor?: boolean },
) {
  return app.inject({
    method: "PATCH",
    url: `/api/devices/fermenter-01/sensors/${address}`,
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  });
}

/** The config JSON from the most recent publish to the device's config topic. */
function lastPublishedConfig(publish: ReturnType<typeof vi.fn>): Record<string, unknown> | null {
  const calls = publish.mock.calls.filter((call) => call[0] === "unibrew/fermenter-01/config");
  const last = calls.at(-1);
  return last ? (JSON.parse(last[1] as string) as Record<string, unknown>) : null;
}

describe("PATCH /api/devices/:id/sensors/:address", () => {
  it("pushes the control sensor's offset to the device", async () => {
    const { app, token, publish } = await setUp();

    const res = await patchSensor(app, token, CONTROL, { offsetC: -0.4 });

    expect(res.statusCode).toBe(200);
    expect(getDeviceConfig(app.db, "fermenter-01")!.controlSensorOffsetC).toBeCloseTo(-0.4);
    expect(lastPublishedConfig(publish)!.controlSensorOffsetC).toBeCloseTo(-0.4);
  });

  it("does not republish config for a non-control sensor's offset", async () => {
    const { app, token, publish } = await setUp();

    await patchSensor(app, token, OTHER, { offsetC: 0.7 });

    // Stored for display/ingest correction, but the device's control input is
    // unaffected, so there is nothing to tell it.
    const sensors = (await app.inject({
      method: "GET",
      url: "/api/devices/fermenter-01/sensors",
      headers: { authorization: `Bearer ${token}` },
    })).json() as Array<{ address: string; offsetC: number }>;
    expect(sensors.find((s) => s.address === OTHER)!.offsetC).toBeCloseTo(0.7);
    expect(lastPublishedConfig(publish)).toBeNull();
  });

  it("carries the new sensor's own offset when the control sensor changes", async () => {
    const { app, token, publish } = await setUp();

    await patchSensor(app, token, OTHER, { offsetC: 0.7 });
    await patchSensor(app, token, OTHER, { isControlSensor: true });

    const config = getDeviceConfig(app.db, "fermenter-01")!;
    expect(config.controlSensorAddress).toBe(OTHER);
    expect(config.controlSensorOffsetC).toBeCloseTo(0.7);
    expect(lastPublishedConfig(publish)!.controlSensorOffsetC).toBeCloseTo(0.7);
  });

  it("rejects an offset beyond the plausible band without storing it", async () => {
    const { app, token, publish } = await setUp();

    const res = await patchSensor(app, token, CONTROL, { offsetC: 25 });

    expect(res.statusCode).toBe(400);
    const sensors = (await app.inject({
      method: "GET",
      url: "/api/devices/fermenter-01/sensors",
      headers: { authorization: `Bearer ${token}` },
    })).json() as Array<{ address: string; offsetC: number }>;
    expect(sensors.find((s) => s.address === CONTROL)!.offsetC).toBe(0);
    expect(lastPublishedConfig(publish)).toBeNull();
  });

  it("leaves the label alone when only the offset is patched", async () => {
    const { app, token } = await setUp();

    await patchSensor(app, token, CONTROL, { label: "Beer" });
    const res = await patchSensor(app, token, CONTROL, { offsetC: -0.4 });

    const sensors = res.json() as Array<{ address: string; label: string | null; offsetC: number }>;
    const control = sensors.find((s) => s.address === CONTROL)!;
    expect(control.label).toBe("Beer");
    expect(control.offsetC).toBeCloseTo(-0.4);
  });
});
