import { describe, expect, it } from "vitest";
import { createDbClient } from "../client.js";
import { runMigrations } from "../migrate.js";
import { insertFirmwareBuild } from "./firmware-builds.repo.js";
import { consumeOtaToken, createOtaToken } from "./ota-tokens.repo.js";

function setUp() {
  const db = createDbClient(":memory:");
  runMigrations(db);
  const build = insertFirmwareBuild(
    db,
    { deviceId: "fermenter-01", board: "fermenter-brewpi", version: "0.1.0" },
    "f.bin",
    100,
    "0".repeat(32),
  );
  return { db, firmwareId: build.id };
}

describe("ota-tokens.repo", () => {
  it("accepts a fresh, unexpired token for the right firmware id", () => {
    const { db, firmwareId } = setUp();
    const token = createOtaToken(db, firmwareId, 1000, 60000);
    expect(consumeOtaToken(db, token, firmwareId, 2000)).toBe(true);
  });

  it("rejects reuse of an already-consumed token", () => {
    const { db, firmwareId } = setUp();
    const token = createOtaToken(db, firmwareId, 1000, 60000);
    expect(consumeOtaToken(db, token, firmwareId, 2000)).toBe(true);
    expect(consumeOtaToken(db, token, firmwareId, 2000)).toBe(false);
  });

  it("rejects an expired token", () => {
    const { db, firmwareId } = setUp();
    const token = createOtaToken(db, firmwareId, 1000, 60000);
    expect(consumeOtaToken(db, token, firmwareId, 1000 + 60000 + 1)).toBe(false);
  });

  it("rejects a token presented against the wrong firmware id", () => {
    const { db, firmwareId } = setUp();
    const token = createOtaToken(db, firmwareId, 1000, 60000);
    expect(consumeOtaToken(db, token, firmwareId + 999, 2000)).toBe(false);
  });

  it("rejects an unknown token", () => {
    const { db, firmwareId } = setUp();
    expect(consumeOtaToken(db, "not-a-real-token", firmwareId, 2000)).toBe(false);
  });
});
