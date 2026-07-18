import { describe, expect, it } from "vitest";
import { FirmwareBoardSchema } from "@brewhub/shared-types";
import { createDbClient } from "../client.js";
import { runMigrations } from "../migrate.js";
import { deleteFirmwareBuild, getFirmwareBuild, insertFirmwareBuild, listFirmwareBuilds } from "./firmware-builds.repo.js";

function setUp() {
  const db = createDbClient(":memory:");
  runMigrations(db);
  return db;
}

describe("firmware-builds.repo", () => {
  // Regression test, same class of bug as devices.repo.test.ts (see
  // DECISIONS.md ADR-018): FirmwareBoardSchema (Zod) and this table's board
  // CHECK constraint are independent, hand-maintained lists.
  it.each(FirmwareBoardSchema.options)("accepts every FirmwareBoardSchema value: %s", (board) => {
    const db = setUp();
    const build = insertFirmwareBuild(db, { deviceId: "test-device", board, version: "0.1.0" }, "test.bin", 100, "0".repeat(32));
    expect(build.board).toBe(board);
  });

  it("inserts a build for a not-yet-registered device (no FK to devices)", () => {
    const db = setUp();
    const build = insertFirmwareBuild(
      db,
      { deviceId: "fermenter-02", board: "fermenter-brewpi", version: "0.2.0" },
      "abc123.bin",
      987654,
      "d41d8cd98f00b204e9800998ecf8427e",
    );
    expect(build.deviceId).toBe("fermenter-02");
    expect(build.board).toBe("fermenter-brewpi");
    expect(build.sizeBytes).toBe(987654);
  });

  it("lists builds filtered by device, newest first", () => {
    const db = setUp();
    insertFirmwareBuild(db, { deviceId: "a", board: "keg-scale", version: "0.1.0" }, "a1.bin", 100, "0".repeat(32));
    insertFirmwareBuild(db, { deviceId: "b", board: "keg-scale", version: "0.1.0" }, "b1.bin", 100, "0".repeat(32));
    insertFirmwareBuild(db, { deviceId: "a", board: "keg-scale", version: "0.2.0" }, "a2.bin", 100, "0".repeat(32));

    const forA = listFirmwareBuilds(db, "a");
    expect(forA.map((b) => b.version)).toEqual(["0.2.0", "0.1.0"]);

    const all = listFirmwareBuilds(db);
    expect(all).toHaveLength(3);
  });

  it("deletes a build", () => {
    const db = setUp();
    const build = insertFirmwareBuild(
      db,
      { deviceId: "a", board: "kegerator-kegcop", version: "0.1.0" },
      "a.bin",
      100,
      "0".repeat(32),
    );
    expect(deleteFirmwareBuild(db, build.id)).toBe(true);
    expect(getFirmwareBuild(db, build.id)).toBeNull();
    expect(deleteFirmwareBuild(db, build.id)).toBe(false);
  });
});
