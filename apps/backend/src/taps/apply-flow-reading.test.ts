import { describe, expect, it } from "vitest";
import { createDbClient } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { insertDevice } from "../db/repositories/devices.repo.js";
import { getTap, insertTap, resetKeg } from "../db/repositories/taps.repo.js";
import { listPourEventsForTap } from "../db/repositories/pour-events.repo.js";
import { applyFlowReading } from "./apply-flow-reading.js";

/** 1000 pulses/L keeps the arithmetic readable: 1 pulse = 1 mL. */
const PULSES_PER_LITER = 1000;

function setUp() {
  const db = createDbClient(":memory:");
  runMigrations(db);
  insertDevice(db, { id: "kegerator-01", name: "Keezer", type: "kegerator" });
  const tap = insertTap(db, "kegerator-01", {
    measurementType: "flow",
    flowIndex: 0,
    pulsesPerLiter: PULSES_PER_LITER,
    name: "Pale Ale",
    fullVolumeMl: 19000,
  });
  return { db, tapId: tap.id };
}

function tick(db: ReturnType<typeof setUp>["db"], cumulativePulses: number, atMs: number) {
  return applyFlowReading(db, "kegerator-01", { index: 0, pulseCount: cumulativePulses }, atMs);
}

/**
 * Pours at a realistic ~20 mL/s (40 mL per 2 s tick) until the pour has
 * delivered enough for kick detection to start judging its rate, and asserts
 * nothing trips along the way. Returns the cumulative pulse count and time
 * reached, so a test can continue from there.
 */
function pourNormallyPastTheFloor(
  db: ReturnType<typeof setUp>["db"],
  startPulses = 0,
  startMs = 0,
): { pulses: number; atMs: number } {
  let pulses = startPulses;
  let atMs = startMs;
  for (let i = 0; i < 11; i++) {
    pulses += 40;
    atMs += 2000;
    expect(tick(db, pulses, atMs).kick).toBeNull();
  }
  return { pulses, atMs };
}

describe("applyFlowReading — kick detection", () => {
  it("accumulates a pour's running total across ticks", () => {
    const { db, tapId } = setUp();

    tick(db, 100, 1000);
    tick(db, 250, 3000);
    tick(db, 400, 5000);

    const pours = listPourEventsForTap(db, tapId);
    expect(pours).toHaveLength(1);
    expect(pours[0]!.volumeMl).toBeCloseTo(400); // one pour, not three
  });

  it("does not flag a normal pour", () => {
    const { db, tapId } = setUp();

    // ~20 mL/s over several ticks — a pint poured properly.
    let pulses = 0;
    for (let t = 2000; t <= 24000; t += 2000) {
      pulses += 40;
      expect(tick(db, pulses, t).kick).toBeNull();
    }
    expect(getTap(db, tapId)!.kickedAt).toBeNull();
  });

  it("flags a keg that blows mid-pour", () => {
    const { db, tapId } = setUp();
    const { pulses, atMs } = pourNormallyPastTheFloor(db);

    // The keg blows: 200 mL of "flow" in one 2 s tick = 100 mL/s.
    const events = tick(db, pulses + 200, atMs + 2000);

    expect(events.kick).not.toBeNull();
    expect(events.kick!.tapName).toBe("Pale Ale");
    expect(events.kick!.rateMlPerS).toBeCloseTo(100);
    expect(getTap(db, tapId)!.kickedAt).toBe(atMs + 2000);
  });

  it("notifies once per keg, not on every subsequent tick", () => {
    const { db } = setUp();
    const { pulses, atMs } = pourNormallyPastTheFloor(db);

    expect(tick(db, pulses + 200, atMs + 2000).kick).not.toBeNull();

    // Gas keeps rushing through — already flagged, so stays quiet.
    expect(tick(db, pulses + 400, atMs + 4000).kick).toBeNull();
    expect(tick(db, pulses + 600, atMs + 6000).kick).toBeNull();
  });

  it("can flag again after a new keg is tapped", () => {
    const { db, tapId } = setUp();
    const first = pourNormallyPastTheFloor(db);
    expect(tick(db, first.pulses + 200, first.atMs + 2000).kick).not.toBeNull();

    resetKeg(db, tapId);
    expect(getTap(db, tapId)!.kickedAt).toBeNull();
    expect(getTap(db, tapId)!.remainingVolumeMl).toBe(19000);

    // Let the pour finish (past the idle timeout) so the next one is fresh.
    const restartAt = first.atMs + 60_000;
    tick(db, first.pulses + 200, restartAt);

    const second = pourNormallyPastTheFloor(db, first.pulses + 200, restartAt);
    expect(tick(db, second.pulses + 200, second.atMs + 2000).kick).not.toBeNull();
  });

  it("treats a firmware reboot as a resync, never as an infinitely fast pour", () => {
    const { db, tapId } = setUp();
    const { pulses, atMs } = pourNormallyPastTheFloor(db);

    // Cumulative counter drops back to near zero — the device rebooted.
    const events = tick(db, 5, atMs + 2000);

    expect(events.kick).toBeNull();
    expect(getTap(db, tapId)!.kickedAt).toBeNull();
    // And the baseline resyncs rather than logging a negative pour.
    expect(getTap(db, tapId)!.remainingVolumeMl).toBeCloseTo(19000 - pulses);
  });
});
