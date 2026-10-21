import { describe, expect, it, vi } from "vitest";
import type { MqttClient } from "mqtt";
import { buildApp } from "../app.js";
import { createDbClient } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { createUser } from "../db/repositories/users.repo.js";
import { hashPassword } from "../auth/password.js";
import { loadConfig } from "../config/env.js";
import { insertDevice, deleteDevice } from "../db/repositories/devices.repo.js";
import {
  ensureDefaultDeviceConfig,
  getActiveProfileState,
  getDeviceConfig,
  setActiveProfile,
} from "../db/repositories/device-configs.repo.js";
import { insertProfile, listProfilesForDevice, listTemplates } from "../db/repositories/profiles.repo.js";

const STEPS = [
  { atMinutes: 0, targetC: 18 },
  { atMinutes: 6000, targetC: 18 },
  { atMinutes: 9000, targetC: 21 },
];

async function setUp() {
  const db = createDbClient(":memory:");
  runMigrations(db);
  createUser(db, "admin", hashPassword("correct-password"));
  for (const id of ["fermenter-01", "fermenter-02"]) {
    insertDevice(db, { id, name: id, type: "fermenter" });
    ensureDefaultDeviceConfig(db, id);
  }
  const config = loadConfig({ NODE_ENV: "test", JWT_SECRET: "test-secret-at-least-16-chars" });
  const app = await buildApp({ db, config });
  const publish = vi.fn();
  app.decorate("mqttClient", { publish } as unknown as MqttClient);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "correct-password" },
  });
  const headers = { authorization: `Bearer ${login.json().token as string}` };
  return { app, db, headers, publish };
}

describe("PUT /api/devices/:id/profiles/:profileId", () => {
  it("updates an inactive profile without publishing", async () => {
    const { app, headers, publish } = await setUp();
    const p = insertProfile(app.db, "fermenter-01", { name: "Ale", triggerType: "time", steps: STEPS });
    const res = await app.inject({
      method: "PUT",
      url: `/api/devices/fermenter-01/profiles/${p.id}`,
      headers,
      payload: { name: "Ale v2", triggerType: "time", steps: [{ atMinutes: 0, targetC: 17 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: p.id, name: "Ale v2", steps: [{ atMinutes: 0, targetC: 17 }] });
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects invalid steps with the existing schema", async () => {
    const { app, headers } = await setUp();
    const p = insertProfile(app.db, "fermenter-01", { name: "Ale", triggerType: "time", steps: STEPS });
    const res = await app.inject({
      method: "PUT",
      url: `/api/devices/fermenter-01/profiles/${p.id}`,
      headers,
      payload: { name: "Ale", triggerType: "time", steps: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s a profile that belongs to another device", async () => {
    const { app, headers } = await setUp();
    const p = insertProfile(app.db, "fermenter-02", { name: "Ale", triggerType: "time", steps: STEPS });
    const res = await app.inject({
      method: "PUT",
      url: `/api/devices/fermenter-01/profiles/${p.id}`,
      headers,
      payload: { name: "x", triggerType: "time", steps: STEPS },
    });
    expect(res.statusCode).toBe(404);
  });

  it("keeps profile_started_at and publishes the new setpoint when editing the active profile", async () => {
    const { app, headers, publish } = await setUp();
    const p = insertProfile(app.db, "fermenter-01", { name: "Ale", triggerType: "time", steps: STEPS });
    const startedAt = Date.now() - 60 * 60000; // one hour in
    setActiveProfile(app.db, "fermenter-01", p.id, startedAt);

    const res = await app.inject({
      method: "PUT",
      url: `/api/devices/fermenter-01/profiles/${p.id}`,
      headers,
      payload: { name: "Ale", triggerType: "time", steps: [{ atMinutes: 0, targetC: 16.5 }, { atMinutes: 9000, targetC: 16.5 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(getActiveProfileState(app.db, "fermenter-01")).toEqual({ activeProfileId: p.id, profileStartedAt: startedAt });
    expect(getDeviceConfig(app.db, "fermenter-01")!.setpointC).toBe(16.5);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(JSON.parse(publish.mock.calls[0]![1] as string).setpointC).toBe(16.5);
  });
});

describe("profile templates", () => {
  it("saves a device profile as a template, which survives device removal", async () => {
    const { app, headers } = await setUp();
    const p = insertProfile(app.db, "fermenter-01", { name: "Lager", triggerType: "time", steps: STEPS });
    const saved = await app.inject({
      method: "POST",
      url: `/api/devices/fermenter-01/profiles/${p.id}/save-as-template`,
      headers,
      payload: {},
    });
    expect(saved.statusCode).toBe(201);
    expect(saved.json()).toMatchObject({ name: "Lager", triggerType: "time", steps: STEPS });

    // Templates don't show up as device profiles…
    expect(listProfilesForDevice(app.db, "fermenter-01")).toHaveLength(1);
    // …and outlive the device the profile came from.
    deleteDevice(app.db, "fermenter-01");
    expect(listTemplates(app.db).map((t) => t.name)).toEqual(["Lager"]);
  });

  it("supports create, list, update and delete", async () => {
    const { app, headers } = await setUp();
    const created = await app.inject({
      method: "POST",
      url: "/api/profile-templates",
      headers,
      payload: { name: "Kveik", triggerType: "time", steps: STEPS },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as number;

    const updated = await app.inject({
      method: "PUT",
      url: `/api/profile-templates/${id}`,
      headers,
      payload: { name: "Kveik hot", triggerType: "time", steps: [{ atMinutes: 0, targetC: 30 }] },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().name).toBe("Kveik hot");

    const list = await app.inject({ method: "GET", url: "/api/profile-templates", headers });
    expect(list.json()).toHaveLength(1);

    // A template id is not reachable through the device profile routes.
    const viaDevice = await app.inject({
      method: "PUT",
      url: `/api/devices/fermenter-01/profiles/${id}`,
      headers,
      payload: { name: "x", triggerType: "time", steps: STEPS },
    });
    expect(viaDevice.statusCode).toBe(404);

    const del = await app.inject({ method: "DELETE", url: `/api/profile-templates/${id}`, headers });
    expect(del.statusCode).toBe(204);
    expect(listTemplates(app.db)).toHaveLength(0);
  });

  it("applies a template as an independent copy", async () => {
    const { app, headers, publish } = await setUp();
    const t = (
      await app.inject({ method: "POST", url: "/api/profile-templates", headers, payload: { name: "Ale", triggerType: "time", steps: STEPS } })
    ).json() as { id: number };
    insertProfile(app.db, "fermenter-02", { name: "Ale", triggerType: "time", steps: STEPS });

    const res = await app.inject({
      method: "POST",
      url: `/api/profile-templates/${t.id}/apply`,
      headers,
      payload: { deviceId: "fermenter-02" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ activated: false, profile: { deviceId: "fermenter-02", name: "Ale (2)" } });
    expect(getActiveProfileState(app.db, "fermenter-02")).toBeNull();
    expect(publish).not.toHaveBeenCalled();

    // Editing the template afterwards leaves the copy alone.
    await app.inject({
      method: "PUT",
      url: `/api/profile-templates/${t.id}`,
      headers,
      payload: { name: "Ale", triggerType: "time", steps: [{ atMinutes: 0, targetC: 25 }] },
    });
    const copy = listProfilesForDevice(app.db, "fermenter-02").find((p) => p.name === "Ale (2)")!;
    expect(copy.steps).toEqual(STEPS);
  });

  it("applies and activates immediately", async () => {
    const { app, headers, publish } = await setUp();
    const t = (
      await app.inject({ method: "POST", url: "/api/profile-templates", headers, payload: { name: "Ale", triggerType: "time", steps: STEPS } })
    ).json() as { id: number };

    const res = await app.inject({
      method: "POST",
      url: `/api/profile-templates/${t.id}/apply`,
      headers,
      payload: { deviceId: "fermenter-01", activate: true },
    });
    expect(res.statusCode).toBe(201);
    const profileId = res.json().profile.id as number;
    expect(getActiveProfileState(app.db, "fermenter-01")?.activeProfileId).toBe(profileId);
    expect(getDeviceConfig(app.db, "fermenter-01")!.setpointC).toBe(18);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("refuses to activate a gravity template without a hydrometer", async () => {
    const { app, headers } = await setUp();
    const t = (
      await app.inject({
        method: "POST",
        url: "/api/profile-templates",
        headers,
        payload: { name: "G", triggerType: "gravity", steps: [{ atGravitySg: 1.05, targetC: 18 }] },
      })
    ).json() as { id: number };
    const res = await app.inject({
      method: "POST",
      url: `/api/profile-templates/${t.id}/apply`,
      headers,
      payload: { deviceId: "fermenter-01", activate: true },
    });
    expect(res.statusCode).toBe(400);
    expect(listProfilesForDevice(app.db, "fermenter-01")).toHaveLength(0);
  });
});

describe("active profile progress and restart", () => {
  it("reports the current step and next change, and restart resets the clock", async () => {
    const { app, headers, publish } = await setUp();
    const p = insertProfile(app.db, "fermenter-01", { name: "Ale", triggerType: "time", steps: STEPS });
    setActiveProfile(app.db, "fermenter-01", p.id, Date.now() - 7000 * 60000);

    const progress = (await app.inject({ method: "GET", url: "/api/devices/fermenter-01/profiles/active", headers })).json();
    expect(progress).toMatchObject({ active: true, stepIndex: 1, stepCount: 3, nextChangeAtMinutes: 9000, nextTargetC: 21 });
    expect(progress.elapsedMinutes).toBeGreaterThanOrEqual(7000);

    const restarted = await app.inject({ method: "POST", url: "/api/devices/fermenter-01/profiles/active/restart", headers });
    expect(restarted.statusCode).toBe(200);
    expect(restarted.json()).toMatchObject({ stepIndex: 0 });
    expect(restarted.json().elapsedMinutes).toBeLessThan(1);
    expect(publish).toHaveBeenCalled();
  });

  it("reports inactive when nothing is running", async () => {
    const { app, headers } = await setUp();
    const res = await app.inject({ method: "GET", url: "/api/devices/fermenter-01/profiles/active", headers });
    expect(res.json()).toEqual({ active: false });
    const restart = await app.inject({ method: "POST", url: "/api/devices/fermenter-01/profiles/active/restart", headers });
    expect(restart.statusCode).toBe(409);
  });
});
