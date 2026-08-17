import { describe, expect, test } from "vitest";
import { freshnessOf } from "./freshness";

const STALE_AFTER_MS = 60_000;
const NOW = 1_700_000_000_000;

describe("freshnessOf", () => {
  test("reports never when no reading has arrived", () => {
    expect(freshnessOf(null, NOW, STALE_AFTER_MS)).toBe("never");
  });

  test("reports live for a reading that just arrived", () => {
    expect(freshnessOf(NOW, NOW, STALE_AFTER_MS)).toBe("live");
  });

  test("reports live just inside the threshold", () => {
    expect(freshnessOf(NOW - (STALE_AFTER_MS - 1), NOW, STALE_AFTER_MS)).toBe("live");
  });

  // The boundary is stated as a test rather than left to the reader: at
  // exactly the threshold the reading is stale.
  test("reports stale exactly at the threshold", () => {
    expect(freshnessOf(NOW - STALE_AFTER_MS, NOW, STALE_AFTER_MS)).toBe("stale");
  });

  test("reports stale for a reading well past the threshold", () => {
    expect(freshnessOf(NOW - 10 * STALE_AFTER_MS, NOW, STALE_AFTER_MS)).toBe("stale");
  });

  // The ESP32 stamps telemetry with its own clock, which is not the tablet's.
  // A device running slightly ahead must not make a perfectly good reading
  // look like a fault on the wall screen.
  test("treats a timestamp from the near future as live", () => {
    expect(freshnessOf(NOW + 5_000, NOW, STALE_AFTER_MS)).toBe("live");
  });
});
