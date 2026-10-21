import { describe, expect, it } from "vitest";
import { summarizeConnection, summarizeFleet, timeAgo } from "./status";

describe("summarizeFleet", () => {
  it("is idle with no devices", () => {
    expect(summarizeFleet([])).toMatchObject({ tone: "idle", total: 0, online: 0 });
  });
  it("is ok only when every device is online", () => {
    expect(summarizeFleet([{ isOnline: true }, { isOnline: true }])).toMatchObject({
      tone: "ok",
      label: "All 2 devices online",
    });
  });
  it("warns when some devices are offline", () => {
    expect(summarizeFleet([{ isOnline: true }, { isOnline: false }, { isOnline: true }])).toMatchObject({
      tone: "warn",
      label: "2 of 3 devices online",
    });
  });
  it("is critical when all devices are offline, even if the socket is up", () => {
    expect(summarizeFleet([{ isOnline: false }])).toMatchObject({ tone: "crit", label: "Device offline" });
  });
});

describe("summarizeConnection", () => {
  it("never reports ok while disconnected", () => {
    expect(summarizeConnection(false).tone).toBe("warn");
    expect(summarizeConnection(true).tone).toBe("ok");
  });
});

describe("timeAgo", () => {
  const now = 1_000_000_000;
  it.each([
    [null, "never"],
    [now - 3_000, "just now"],
    [now - 42_000, "42s ago"],
    [now - 5 * 60_000, "5 min ago"],
    [now - 3 * 3_600_000, "3 h ago"],
    [now - 72 * 3_600_000, "3 days ago"],
  ])("%s → %s", (ts, expected) => {
    expect(timeAgo(ts, now)).toBe(expected);
  });
  it("clamps future timestamps", () => {
    expect(timeAgo(now + 5_000, now)).toBe("just now");
  });
});
