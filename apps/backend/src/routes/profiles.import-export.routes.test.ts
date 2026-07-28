import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { createDbClient } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { createUser } from "../db/repositories/users.repo.js";
import { hashPassword } from "../auth/password.js";
import { loadConfig } from "../config/env.js";
import { insertDevice } from "../db/repositories/devices.repo.js";
import { insertProfile, listProfilesForDevice } from "../db/repositories/profiles.repo.js";

const TIME_STEPS = [
  { atMinutes: 0, targetC: 18 },
  { atMinutes: 4320, targetC: 21 },
];

async function setUp(): Promise<{ app: FastifyInstance; token: string }> {
  const db = createDbClient(":memory:");
  runMigrations(db);
  createUser(db, "admin", hashPassword("correct-password"));
  insertDevice(db, { id: "fermenter-01", name: "Chamber", type: "fermenter" });
  insertDevice(db, { id: "fermenter-02", name: "Chamber 2", type: "fermenter" });

  const config = loadConfig({ NODE_ENV: "test", JWT_SECRET: "test-secret-at-least-16-chars" });
  const app = await buildApp({ db, config });

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "correct-password" },
  });

  return { app, token: login.json().token as string };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("profile import/export", () => {
  it("round-trips a profile onto another device", async () => {
    const { app, token } = await setUp();
    insertProfile(app.db, "fermenter-01", { name: "Ale", triggerType: "time", steps: TIME_STEPS });

    const exported = await app.inject({
      method: "GET",
      url: "/api/devices/fermenter-01/profiles/export",
      headers: auth(token),
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-disposition"]).toContain("brewhub-profiles-fermenter-01");

    // Import the exact bytes that were downloaded onto a different device.
    const imported = await app.inject({
      method: "POST",
      url: "/api/devices/fermenter-02/profiles/import",
      headers: auth(token),
      payload: JSON.parse(exported.body),
    });

    expect(imported.statusCode).toBe(201);
    expect(imported.json().imported).toHaveLength(1);

    const onSecondDevice = listProfilesForDevice(app.db, "fermenter-02");
    expect(onSecondDevice).toHaveLength(1);
    expect(onSecondDevice[0]!.name).toBe("Ale");
    expect(onSecondDevice[0]!.steps).toEqual(TIME_STEPS);
    // It's a copy, not a move — and it belongs to the device it landed on.
    expect(listProfilesForDevice(app.db, "fermenter-01")).toHaveLength(1);
    expect(onSecondDevice[0]!.deviceId).toBe("fermenter-02");
  });

  it("exports a gravity profile without mangling its steps", async () => {
    const { app, token } = await setUp();
    const steps = [
      { atGravitySg: 1.05, targetC: 18 },
      { atGravitySg: 1.02, targetC: 20 },
    ];
    insertProfile(app.db, "fermenter-01", { name: "Hefe", triggerType: "gravity", steps });

    const exported = await app.inject({
      method: "GET",
      url: "/api/devices/fermenter-01/profiles/export",
      headers: auth(token),
    });
    await app.inject({
      method: "POST",
      url: "/api/devices/fermenter-02/profiles/import",
      headers: auth(token),
      payload: JSON.parse(exported.body),
    });

    const copied = listProfilesForDevice(app.db, "fermenter-02")[0]!;
    expect(copied.triggerType).toBe("gravity");
    expect(copied.steps).toEqual(steps);
  });

  it("suffixes a clashing name instead of overwriting, and says so", async () => {
    const { app, token } = await setUp();
    insertProfile(app.db, "fermenter-01", { name: "Ale", triggerType: "time", steps: TIME_STEPS });

    const exported = await app.inject({
      method: "GET",
      url: "/api/devices/fermenter-01/profiles/export",
      headers: auth(token),
    });

    // Import back onto the SAME device, where the name is already taken.
    const imported = await app.inject({
      method: "POST",
      url: "/api/devices/fermenter-01/profiles/import",
      headers: auth(token),
      payload: JSON.parse(exported.body),
    });

    expect(imported.json().imported[0]).toMatchObject({ name: "Ale (2)", renamedFrom: "Ale" });
    // The original is untouched — import never overwrites.
    const names = listProfilesForDevice(app.db, "fermenter-01").map((p) => p.name).sort();
    expect(names).toEqual(["Ale", "Ale (2)"]);
  });

  it("exports a single profile in the same envelope shape as a bulk export", async () => {
    const { app, token } = await setUp();
    const a = insertProfile(app.db, "fermenter-01", { name: "Ale", triggerType: "time", steps: TIME_STEPS });
    insertProfile(app.db, "fermenter-01", { name: "Lager", triggerType: "time", steps: TIME_STEPS });

    const one = await app.inject({
      method: "GET",
      url: `/api/devices/fermenter-01/profiles/${a.id}/export`,
      headers: auth(token),
    });

    expect(one.statusCode).toBe(200);
    const body = JSON.parse(one.body);
    expect(body.formatVersion).toBe(1);
    expect(body.profiles).toHaveLength(1);
    expect(body.profiles[0].name).toBe("Ale");

    // ...and it imports through the same endpoint.
    const imported = await app.inject({
      method: "POST",
      url: "/api/devices/fermenter-02/profiles/import",
      headers: auth(token),
      payload: body,
    });
    expect(imported.statusCode).toBe(201);
  });

  it("rejects a file from an unknown format version rather than half-reading it", async () => {
    const { app, token } = await setUp();

    const res = await app.inject({
      method: "POST",
      url: "/api/devices/fermenter-01/profiles/import",
      headers: auth(token),
      payload: { formatVersion: 99, profiles: [{ name: "X", triggerType: "time", steps: TIME_STEPS }] },
    });

    expect(res.statusCode).toBe(400);
    expect(listProfilesForDevice(app.db, "fermenter-01")).toHaveLength(0);
  });

  it("rejects a structurally invalid profile without importing the valid ones alongside it", async () => {
    const { app, token } = await setUp();

    const res = await app.inject({
      method: "POST",
      url: "/api/devices/fermenter-01/profiles/import",
      headers: auth(token),
      payload: {
        formatVersion: 1,
        profiles: [
          { name: "Good", triggerType: "time", steps: TIME_STEPS },
          { name: "Bad", triggerType: "time", steps: [] }, // steps must be non-empty
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    // All or nothing — a partially applied import would be worse than none.
    expect(listProfilesForDevice(app.db, "fermenter-01")).toHaveLength(0);
  });

  it("ignores id/deviceId/createdAt if someone pastes a raw profile from the API", async () => {
    const { app, token } = await setUp();

    const res = await app.inject({
      method: "POST",
      url: "/api/devices/fermenter-02/profiles/import",
      headers: auth(token),
      payload: {
        formatVersion: 1,
        profiles: [
          { id: 999, deviceId: "somewhere-else", createdAt: 1, name: "Ale", triggerType: "time", steps: TIME_STEPS },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const created = listProfilesForDevice(app.db, "fermenter-02")[0]!;
    expect(created.id).not.toBe(999);
    expect(created.deviceId).toBe("fermenter-02");
  });

  it("404s exporting a device with no profiles", async () => {
    const { app, token } = await setUp();

    const res = await app.inject({
      method: "GET",
      url: "/api/devices/fermenter-01/profiles/export",
      headers: auth(token),
    });

    expect(res.statusCode).toBe(404);
  });

  it("requires authentication", async () => {
    const { app } = await setUp();
    expect((await app.inject({ method: "GET", url: "/api/devices/fermenter-01/profiles/export" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/devices/fermenter-01/profiles/import" })).statusCode).toBe(401);
  });
});
