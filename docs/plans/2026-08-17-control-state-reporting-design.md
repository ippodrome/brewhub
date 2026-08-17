# Control-state reporting and the decision log

Status: design, awaiting review
Date: 2026-08-17

## The problem

The web UI cannot say what the control loop is doing. `TelemetryPayload`
carries `sensors`, `flows` and `weights` — nothing about actuators. So the
dashboard can show that the beer is at 19.4 °C and that the target is 19.0,
but not whether the compressor is running, how hard it has been working, or
why it last switched.

The ESP32's own TFT shows all of this, because it reads `ControlLoop`
directly. That asymmetry is the whole gap: the device knows, and never says.

Two parts of the spec already ask for this and were never built:

- **§6** lists `unibrew/{device_id}/state` for "current control state,
  setpoints, mode". No such topic exists — `mqtt-topics.ts` defines status,
  telemetry, config, ota, discovery and gravity only.
- **§8** requires "logging of every control decision (why did it turn the
  compressor on/off?) for later analysis". Nothing records it. `ControlLoop`
  knows *when* it transitioned (`lastTransitionMs_`) but discards *why* — the
  reason is implicit in which branch `update()` took.

This is worth building for its own sake, not just for the dashboard. When a
fermentation goes wrong, "what was the chamber actually doing at 03:00" is
the question, and today nothing can answer it.

## Decisions taken

**Two topics, not one.** The UI asks two different questions and they have
different delivery requirements.

- `unibrew/{id}/state` — retained, republished every 30 s and immediately on
  any change. Answers "what is it doing right now", and being retained it
  survives a backend restart and is correct the moment a client connects.
- `unibrew/{id}/decision` — one message per event, not retained. Answers
  "what happened and why". Exact, and cheap because events are rare.

A single topic cannot do both: a retained snapshot loses short cycles between
samples, and an event stream leaves the UI showing a stale state for hours if
one message is dropped.

**Decisions are buffered in RAM across an outage.** ADR-004 has the device
keep controlling when MQTT is down, which means the decisions made during an
outage are exactly the ones worth reading afterwards. A fixed-capacity ring
buffer (32 entries) in the firmware holds them and flushes oldest-first on
reconnect. No dynamic allocation, a few hundred bytes.

It does not survive a reboot. Writing to LittleFS from a control loop trades
flash wear and a new failure mode for a case — power loss — that is rarer
than a network blip and already visible through the gap in the log.

**The firmware sends reason codes, never prose.** An enum plus the numbers
that produced the decision. The UI composes the sentence, so the wording can
change without reflashing every device, and can be translated.

## The reason codes

Taken from the actual branches in `ControlLoop::update` and `applyDesired`,
not invented:

| Code | Where it comes from |
|---|---|
| `above_deadband` | `desiredThermostat` wants cooling |
| `below_deadband` | `desiredThermostat` wants heating |
| `within_deadband` | reading returned inside the band |
| `pid_window` | PID time-proportioning window boundary |
| `min_on_not_met` | `canLeaveActive` refused — held active |
| `min_off_not_met` | `canEnterHeating`/`canEnterCooling` refused |
| `sensor_fault` | invalid reading past `kSensorFaultTimeoutMs`, forced idle |
| `mode_off` | `ControlMode::OFF` |
| `polarity_forced_idle` | `forceIdleAndArmMinOff`, see ADR-022 |

## Two kinds of event

`applyDesired` reveals a distinction the payload has to carry: a decision is
either a **transition** that happened, or a **block** where the loop wanted
to act and the min-on/min-off timers refused. The blocked case is what
explains an apparently idle chamber sitting above its setpoint, so it is the
more valuable of the two to a confused brewer.

Blocked conditions are true on every iteration while they hold, so a naive
implementation would publish continuously. **Only the edge is published** —
the first iteration on which a request becomes blocked — and it carries how
long the block still has to run.

## Payloads

```
unibrew/{id}/state          retained, 30 s + on change
{ output: "cooling" | "heating" | "idle",
  sinceMs: 134000,
  setpointC: 19.0,
  mode: "thermostat" | "pid" | "off",
  controlTempC: 19.42 | null }

unibrew/{id}/decision       per event
{ kind: "transition" | "blocked",
  from: "idle", to: "cooling",
  reason: "above_deadband",
  tempC: 19.42,
  thresholdC: 19.20,
  elapsedMs: 372000,
  remainingMs: 0 }
```

Everything time-related is a **duration**, deliberately. An ESP32 has
`millis()` since boot and no reliable wall clock, so absolute timestamps from
the device would be fiction. The backend stamps arrival time and derives
absolute times from the durations. This also makes buffered offline decisions
correct: a decision that sat in the ring buffer for ten minutes still says
how long the compressor had been off when it was made.

## Layers

**Firmware.** `ControlLoop` records its last decision in an additive
`ControlDecision` struct — no change to any existing branch, no change to
behaviour, so the existing native tests must stay green unmodified. A
`DecisionBuffer` in `firmware/shared/control` holds the ring. `main.cpp`
publishes state on change and on a 30 s timer, and drains the buffer on
reconnect.

**shared-types.** `ControlStatePayloadSchema`, `ControlDecisionPayloadSchema`,
`stateTopic()`, `decisionTopic()`, their wildcards, and `parseTopic` extended.
Zod at the boundary, per §0.1.

**Backend.** Subscribes to both wildcards. `device_control_state` upserted per
device; `control_decisions` append-only, indexed by `(device_id, ts)`.
Decisions are low volume — a handful an hour — so a 90-day retention sweep
reusing the existing rollup scheduler is enough. New WS message types
`control_state` and `control_decision` so the dashboard updates live, and
`GET /api/devices/:id/decisions` for history on load.

**Frontend.** `WsProvider` tracks `controlStateByDevice`. New components for
the relay pill, the duty rail and the decision log; the dashboard moves to
the two-column layout from the design proposal, fermenter primary.

## Testing

- Firmware, native: one test per reason code, asserting the branch that
  produces it; ring buffer drops oldest at capacity; flush order is oldest
  first; blocked events fire once on the edge and not repeatedly.
- Backend: ingestion of both topics, retention sweep, the history route.
- Frontend: reason code to sentence is a pure function and gets tests.

## Risks

**This touches the safety-critical path.** `ControlLoop` decides whether a
compressor runs. The mitigation is that every change is additive — recording
what was already decided, never influencing it — and that the existing tests
pass unmodified. If a change requires editing an existing control test, that
is the signal it went too far.

**Nothing can be verified against hardware.** No device has ever connected;
`last_seen_at` is null on all four registered devices, and the fermenter's
`pins.h` is still a placeholder pending the board schematic. Everything here
is verifiable only against simulated input until that changes.

**MQTT volume** is negligible: one retained state message per device per 30 s,
and events measured in a handful per hour.
