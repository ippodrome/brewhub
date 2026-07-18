import { describe, expect, it } from "vitest";
import { DeviceTypeSchema } from "@brewhub/shared-types";
import { createDbClient } from "../client.js";
import { runMigrations } from "../migrate.js";
import { insertDevice } from "./devices.repo.js";

// Regression test for a real bug: shared-types' DeviceTypeSchema (Zod) and
// the devices table's `type` CHECK constraint are two independent sources
// of truth that have to be kept in sync by hand — SQLite can't derive a
// CHECK constraint from a TypeScript enum. When gravity_bridge was added to
// DeviceTypeSchema (0011_gravity.sql), the CHECK constraint update was
// missed entirely: requests validated fine (Zod accepted "gravity_bridge"),
// but the actual INSERT failed with SQLITE_CONSTRAINT_CHECK, surfaced as an
// unhandled 500 at the route layer. Fixed in 0013_gravity_bridge_device_type.sql.
// This test parameterizes over every schema value specifically so the same
// class of bug can't reappear silently for a future device type either.
describe("insertDevice", () => {
  it.each(DeviceTypeSchema.options)("accepts every DeviceTypeSchema value: %s", (type) => {
    const db = createDbClient(":memory:");
    runMigrations(db);

    const device = insertDevice(db, { id: `test-${type}`, type, name: `Test ${type}` });
    expect(device.type).toBe(type);
  });
});
