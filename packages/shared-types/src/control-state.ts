import { z } from "zod";

export const ControlOutputSchema = z.enum(["idle", "heating", "cooling"]);
export type ControlOutputValue = z.infer<typeof ControlOutputSchema>;

/**
 * Why the control loop did what it did.
 *
 * These mirror the branches in the firmware's ControlLoop one for one. The
 * device sends the code and the numbers behind it, never a sentence — so the
 * wording lives in the UI, can be reworded or translated, and does not
 * require reflashing every device to change.
 */
export const DecisionReasonSchema = z.enum([
  "above_deadband",
  "below_deadband",
  "within_deadband",
  "pid_window",
  "min_on_not_met",
  "min_off_not_met",
  "sensor_fault",
  "mode_off",
  "polarity_forced_idle",
]);
export type DecisionReason = z.infer<typeof DecisionReasonSchema>;

/**
 * A decision either happened, or was refused by the min-on/min-off timers.
 * The refused case is what explains a chamber sitting above its setpoint with
 * the compressor off — usually the more confusing of the two to look at.
 */
export const DecisionKindSchema = z.enum(["transition", "blocked"]);
export type DecisionKind = z.infer<typeof DecisionKindSchema>;

/**
 * Published retained to unibrew/{deviceId}/state, every 30 s and immediately
 * on any change.
 *
 * Retained because a client that has just connected — or a backend that has
 * just restarted — must know the current state without waiting for the next
 * transition, which can be hours away.
 */
export const ControlStatePayloadSchema = z.object({
  deviceId: z.string().min(1),
  output: ControlOutputSchema,
  /** How long the current output has held. A duration, not a timestamp. */
  sinceMs: z.number().int().nonnegative(),
  setpointC: z.number(),
  mode: z.enum(["off", "thermostat", "pid"]),
  /** Null when no valid reading is available — a faulted or missing sensor. */
  controlTempC: z.number().nullable(),
});
export type ControlStatePayload = z.infer<typeof ControlStatePayloadSchema>;

/**
 * Published per event to unibrew/{deviceId}/decision. Not retained: these are
 * a log, and a retained one would replay a single stale entry forever.
 *
 * Every time here is a duration against the device's own millis(), because an
 * ESP32 has no reliable wall clock and any absolute timestamp it produced
 * would be fiction. The backend stamps arrival and derives absolute times from
 * these — which is also what keeps a decision truthful after it has sat in the
 * firmware's buffer through an outage.
 */
export const ControlDecisionPayloadSchema = z.object({
  deviceId: z.string().min(1),
  kind: DecisionKindSchema,
  from: ControlOutputSchema,
  to: ControlOutputSchema,
  reason: DecisionReasonSchema,
  temperatureC: z.number(),
  thresholdC: z.number(),
  /** How long the previous output had held when the decision was made. */
  elapsedMs: z.number().int().nonnegative(),
  /** Blocked decisions only: how much of the timer was still to run. */
  remainingMs: z.number().int().nonnegative(),
});
export type ControlDecisionPayload = z.infer<typeof ControlDecisionPayloadSchema>;
