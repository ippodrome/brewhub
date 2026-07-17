export interface TapPourInput {
  lastPulseCount: number;
  pourInProgressId: number | null;
  lastActivityAt: number | null;
  remainingVolumeMl: number;
  pulsesPerLiter: number;
}

/**
 * What the (impure) caller should do in response to one flow reading. This
 * function only decides — it never touches the database, so every branch
 * is directly testable without a DB fixture.
 */
export type FlowAction =
  | { type: "none" }
  | { type: "resync"; lastPulseCount: number; finalizePour: boolean }
  | { type: "start_pour"; volumeMl: number; lastPulseCount: number; remainingVolumeMl: number }
  | { type: "extend_pour"; addedVolumeMl: number; lastPulseCount: number; remainingVolumeMl: number }
  | { type: "finalize_pour"; lastPulseCount: number };

/**
 * pulseCount is cumulative and monotonic in normal operation. A firmware
 * reboot resets the device's in-memory counter to 0, which would otherwise
 * look like a huge negative pour — detected here as delta < 0 and handled
 * by resyncing rather than logging bogus volume.
 *
 * "Pours" are aggregated across consecutive telemetry ticks with activity,
 * finalized only once idleTimeoutMs passes with no new pulses — without
 * this, every ~2s telemetry tick during a single physical pour would create
 * its own tiny pour_events row instead of one row per actual pour.
 */
export function processFlowReading(
  tap: TapPourInput,
  newPulseCount: number,
  nowMs: number,
  idleTimeoutMs: number,
): FlowAction {
  const delta = newPulseCount - tap.lastPulseCount;

  if (delta < 0) {
    return {
      type: "resync",
      lastPulseCount: newPulseCount,
      finalizePour: tap.pourInProgressId !== null,
    };
  }

  if (delta === 0) {
    const idleLongEnough =
      tap.lastActivityAt !== null && nowMs - tap.lastActivityAt >= idleTimeoutMs;
    if (tap.pourInProgressId !== null && idleLongEnough) {
      return { type: "finalize_pour", lastPulseCount: tap.lastPulseCount };
    }
    return { type: "none" };
  }

  const volumeMl = (delta / tap.pulsesPerLiter) * 1000;
  const remainingVolumeMl = Math.max(0, tap.remainingVolumeMl - volumeMl);

  if (tap.pourInProgressId !== null) {
    return {
      type: "extend_pour",
      addedVolumeMl: volumeMl,
      lastPulseCount: newPulseCount,
      remainingVolumeMl,
    };
  }
  return { type: "start_pour", volumeMl, lastPulseCount: newPulseCount, remainingVolumeMl };
}
