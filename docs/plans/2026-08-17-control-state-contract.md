# Control-State Contract and Producer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an ESP32 report what its control loop is doing and why, and have the backend store it queryably.

**Architecture:** `ControlLoop` records the reason for each decision additively, without changing any control behaviour. A fixed-capacity ring buffer holds decisions across an MQTT outage. Two new topics carry them: a retained `state` snapshot and a per-event `decision` message. The backend validates both with Zod, upserts current state, and appends decisions to a table.

**Tech Stack:** C++17 (PlatformIO, Unity for native tests), TypeScript, Zod, Fastify, better-sqlite3, mqtt.js, vitest.

**Spec:** `docs/plans/2026-08-17-control-state-reporting-design.md`

This is plan 1 of 2. It ends with decisions landing in the database and readable over HTTP. Plan 2 covers the dashboard that displays them.

## Global Constraints

- **`ControlLoop`'s control behaviour must not change.** Every edit is additive — recording what was already decided. The existing tests in `firmware/fermenter/test/test_control_loop/test_main.cpp` must pass **unmodified**. Needing to edit one is the signal the change went too far.
- **No dynamic allocation in firmware.** Fixed-size arrays only (spec §11).
- **All times from the device are durations in milliseconds, never timestamps.** An ESP32 has `millis()` and no reliable wall clock. The backend stamps arrival time.
- **Zod validation at every MQTT and API boundary** (spec §0.1). Invalid payloads are logged and dropped, never partially applied.
- **The firmware sends reason codes, never prose.** Enum plus the numbers that produced the decision.
- Firmware tests run with `pio test -e native` from `firmware/fermenter/`. Backend tests run with `pnpm --filter @brewhub/backend test`.
- Nothing here can be verified against hardware — no device has ever connected. Native and unit tests are the only verification.

---

### Task 1: Reason codes and the decision record in ControlLoop

**Files:**
- Modify: `firmware/shared/control/src/ControlLoop.h`
- Modify: `firmware/shared/control/src/ControlLoop.cpp`
- Test: `firmware/fermenter/test/test_control_decision/test_main.cpp` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `enum class DecisionReason : uint8_t`, `enum class DecisionKind : uint8_t`, `struct ControlDecision`, `bool ControlLoop::takeDecision(ControlDecision& out)`.

`takeDecision` is a *take*, not a peek: it returns false when no new decision has been recorded since the last call, and clears the pending flag when it returns true. That keeps the caller from republishing the same event on every loop iteration.

- [ ] **Step 1: Write the failing test**

Create `firmware/fermenter/test/test_control_decision/test_main.cpp`:

```cpp
#include <unity.h>
#include "ControlLoop.h"

using unibrew::ControlConfig;
using unibrew::ControlDecision;
using unibrew::ControlLoop;
using unibrew::ControlMode;
using unibrew::ControlOutput;
using unibrew::DecisionKind;
using unibrew::DecisionReason;

void setUp(void) {}
void tearDown(void) {}

void test_no_decision_pending_on_a_fresh_loop(void) {
    ControlLoop loop;
    ControlDecision d;
    TEST_ASSERT_FALSE(loop.takeDecision(d));
}

void test_records_cooling_above_deadband(void) {
    ControlConfig cfg;              // setpoint 20, hysteresis 0.5
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg);
    loop.update(21.0f, 1000);

    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(DecisionKind::TRANSITION, d.kind);
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, d.from);
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, d.to);
    TEST_ASSERT_EQUAL(DecisionReason::ABOVE_DEADBAND, d.reason);
    TEST_ASSERT_EQUAL_FLOAT(21.0f, d.temperatureC);
    TEST_ASSERT_EQUAL_FLOAT(20.5f, d.thresholdC);
}

void test_taking_a_decision_clears_it(void) {
    ControlConfig cfg;
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg);
    loop.update(21.0f, 1000);

    ControlDecision first;
    TEST_ASSERT_TRUE(loop.takeDecision(first));
    ControlDecision second;
    TEST_ASSERT_FALSE(loop.takeDecision(second));
}

void test_records_heating_below_deadband(void) {
    ControlConfig cfg;
    cfg.heatingEnabled = true;
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg);
    loop.update(19.0f, 1000);

    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(ControlOutput::HEATING, d.to);
    TEST_ASSERT_EQUAL(DecisionReason::BELOW_DEADBAND, d.reason);
    TEST_ASSERT_EQUAL_FLOAT(19.5f, d.thresholdC);
}

void test_records_returning_to_idle_within_deadband(void) {
    ControlConfig cfg;
    cfg.minOffTimeMs = 0;
    cfg.minOnTimeMs = 0;
    ControlLoop loop(cfg);
    loop.update(21.0f, 1000);
    ControlDecision ignored;
    loop.takeDecision(ignored);

    loop.update(20.0f, 2000);
    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, d.from);
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, d.to);
    TEST_ASSERT_EQUAL(DecisionReason::WITHIN_DEADBAND, d.reason);
}

void test_records_mode_off(void) {
    ControlConfig cfg;
    cfg.minOffTimeMs = 0;
    cfg.minOnTimeMs = 0;
    ControlLoop loop(cfg);
    loop.update(21.0f, 1000);
    ControlDecision ignored;
    loop.takeDecision(ignored);

    cfg.mode = ControlMode::OFF;
    loop.setConfig(cfg);
    loop.update(21.0f, 2000);

    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, d.to);
    TEST_ASSERT_EQUAL(DecisionReason::MODE_OFF, d.reason);
}

void test_records_sensor_fault_after_timeout(void) {
    ControlConfig cfg;
    cfg.minOffTimeMs = 0;
    cfg.minOnTimeMs = 0;
    ControlLoop loop(cfg);
    loop.update(21.0f, 1000);
    ControlDecision ignored;
    loop.takeDecision(ignored);

    loop.update(-127.0f, 2000);            // fault begins, output held
    TEST_ASSERT_FALSE(loop.takeDecision(ignored));
    loop.update(-127.0f, 2000 + 300001);   // past kSensorFaultTimeoutMs

    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, d.to);
    TEST_ASSERT_EQUAL(DecisionReason::SENSOR_FAULT, d.reason);
}

void test_records_forced_idle_from_polarity_change(void) {
    ControlConfig cfg;
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg);
    loop.update(21.0f, 1000);
    ControlDecision ignored;
    loop.takeDecision(ignored);

    loop.forceIdleAndArmMinOff(2000);
    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, d.to);
    TEST_ASSERT_EQUAL(DecisionReason::POLARITY_FORCED_IDLE, d.reason);
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_no_decision_pending_on_a_fresh_loop);
    RUN_TEST(test_records_cooling_above_deadband);
    RUN_TEST(test_taking_a_decision_clears_it);
    RUN_TEST(test_records_heating_below_deadband);
    RUN_TEST(test_records_returning_to_idle_within_deadband);
    RUN_TEST(test_records_mode_off);
    RUN_TEST(test_records_sensor_fault_after_timeout);
    RUN_TEST(test_records_forced_idle_from_polarity_change);
    return UNITY_END();
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd firmware/fermenter && pio test -e native -f test_control_decision`
Expected: compile error — `DecisionReason` and `takeDecision` do not exist.

- [ ] **Step 3: Add the types to `ControlLoop.h`**

Insert after the existing `ControlOutput` / `ControlMode` enums:

```cpp
enum class DecisionKind : uint8_t { TRANSITION, BLOCKED };

enum class DecisionReason : uint8_t {
    ABOVE_DEADBAND,
    BELOW_DEADBAND,
    WITHIN_DEADBAND,
    PID_WINDOW,
    MIN_ON_NOT_MET,
    MIN_OFF_NOT_MET,
    SENSOR_FAULT,
    MODE_OFF,
    POLARITY_FORCED_IDLE,
};

// One control decision, recorded as it is made. Durations are relative to
// the loop's own millis() clock; nothing here is a wall-clock time, because
// the device has no reliable one.
struct ControlDecision {
    DecisionKind kind = DecisionKind::TRANSITION;
    ControlOutput from = ControlOutput::IDLE;
    ControlOutput to = ControlOutput::IDLE;
    DecisionReason reason = DecisionReason::WITHIN_DEADBAND;
    float temperatureC = 0.0f;   // calibrated reading that drove it
    float thresholdC = 0.0f;     // the limit it was compared against
    uint32_t elapsedMs = 0;      // how long the previous output had held
    uint32_t remainingMs = 0;    // BLOCKED only: time left on the timer
};
```

Add to the public section of `ControlLoop`:

```cpp
    // Returns the decision recorded since the last call and clears it.
    // False when nothing new has happened — which is the common case, since
    // the loop runs far more often than it decides anything.
    bool takeDecision(ControlDecision& out);
```

Add to the private section:

```cpp
    void recordDecision(DecisionKind kind, ControlOutput to, DecisionReason reason,
                        float temperatureC, float thresholdC, uint32_t nowMs,
                        uint32_t remainingMs);

    ControlDecision pendingDecision_;
    bool hasPendingDecision_ = false;
    // The reading and limit behind the desired output, stashed by
    // desiredThermostat/desiredPid so applyDesired can record them without
    // recomputing. Not part of the control decision itself.
    float lastReadingC_ = 0.0f;
    float lastThresholdC_ = 0.0f;
    DecisionReason lastDesiredReason_ = DecisionReason::WITHIN_DEADBAND;
```

- [ ] **Step 4: Implement recording in `ControlLoop.cpp`**

Add the take/record pair:

```cpp
bool ControlLoop::takeDecision(ControlDecision& out)
{
    if (!hasPendingDecision_) {
        return false;
    }
    out = pendingDecision_;
    hasPendingDecision_ = false;
    return true;
}

void ControlLoop::recordDecision(DecisionKind kind, ControlOutput to, DecisionReason reason,
                                 float temperatureC, float thresholdC, uint32_t nowMs,
                                 uint32_t remainingMs)
{
    pendingDecision_.kind = kind;
    pendingDecision_.from = output_;
    pendingDecision_.to = to;
    pendingDecision_.reason = reason;
    pendingDecision_.temperatureC = temperatureC;
    pendingDecision_.thresholdC = thresholdC;
    pendingDecision_.elapsedMs = nowMs - lastTransitionMs_;
    pendingDecision_.remainingMs = remainingMs;
    hasPendingDecision_ = true;
}
```

In `desiredThermostat`, set `lastReadingC_`, `lastThresholdC_` and `lastDesiredReason_` on each branch — `ABOVE_DEADBAND` with threshold `setpointC + hysteresisC`, `BELOW_DEADBAND` with `setpointC - hysteresisC`, `WITHIN_DEADBAND` with `setpointC`. In `desiredPid`, set `lastDesiredReason_ = DecisionReason::PID_WINDOW`, `lastThresholdC_ = config_.setpointC`.

In `update`, before each `transitionTo` in the OFF branch and the sensor-fault branch, call `recordDecision` with `MODE_OFF` and `SENSOR_FAULT` respectively, `temperatureC` as passed in, `thresholdC` as `config_.setpointC`, `remainingMs` 0.

In `applyDesired`, call `recordDecision(DecisionKind::TRANSITION, desired, lastDesiredReason_, lastReadingC_, lastThresholdC_, nowMs, 0)` immediately before each successful `transitionTo`.

In `forceIdleAndArmMinOff`, call `recordDecision(DecisionKind::TRANSITION, ControlOutput::IDLE, DecisionReason::POLARITY_FORCED_IDLE, lastReadingC_, config_.setpointC, nowMs, 0)` before forcing idle.

**Order matters:** `recordDecision` reads `output_` and `lastTransitionMs_` to fill `from` and `elapsedMs`, so it must run *before* `transitionTo` updates them.

- [ ] **Step 5: Run the new test and the existing control tests**

Run: `cd firmware/fermenter && pio test -e native -f test_control_decision`
Expected: PASS, 8 tests.

Run: `cd firmware/fermenter && pio test -e native`
Expected: PASS, every suite. **`test_control_loop` must pass with no edits to its file** — if it does not, the change altered behaviour and must be reworked.

- [ ] **Step 6: Commit**

```bash
git add firmware/shared/control/src/ControlLoop.h firmware/shared/control/src/ControlLoop.cpp firmware/fermenter/test/test_control_decision
git commit -m "Record why the control loop decided what it decided"
```

---

### Task 2: Blocked decisions fire on the edge only

**Files:**
- Modify: `firmware/shared/control/src/ControlLoop.cpp`
- Modify: `firmware/shared/control/src/ControlLoop.h`
- Test: `firmware/fermenter/test/test_control_decision/test_main.cpp:appended`

**Interfaces:**
- Consumes: Task 1's `recordDecision`, `DecisionKind::BLOCKED`.
- Produces: no new public API. Behaviour: a blocked request records exactly one decision, on the first iteration it is refused.

A min-off block is true on every iteration while it holds. Recording each one would publish hundreds of identical events, so the loop tracks whether it has already reported the current block.

- [ ] **Step 1: Write the failing tests**

Append to `test_control_decision/test_main.cpp` (and add the `RUN_TEST` lines to `main`):

```cpp
void test_records_blocked_when_min_off_not_met(void) {
    ControlConfig cfg;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 600000;   // 10 min
    ControlLoop loop(cfg);
    loop.update(21.0f, 1000);    // wants cooling, min-off not satisfied

    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(DecisionKind::BLOCKED, d.kind);
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, d.to);
    TEST_ASSERT_EQUAL(DecisionReason::MIN_OFF_NOT_MET, d.reason);
    TEST_ASSERT_TRUE(d.remainingMs > 0);
}

void test_a_continuing_block_is_reported_once(void) {
    ControlConfig cfg;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 600000;
    ControlLoop loop(cfg);
    loop.update(21.0f, 1000);
    ControlDecision first;
    TEST_ASSERT_TRUE(loop.takeDecision(first));

    loop.update(21.0f, 2000);
    loop.update(21.0f, 3000);
    ControlDecision again;
    TEST_ASSERT_FALSE(loop.takeDecision(again));
}

void test_block_is_reported_again_after_it_clears(void) {
    ControlConfig cfg;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 600000;
    ControlLoop loop(cfg);
    loop.update(21.0f, 1000);
    ControlDecision ignored;
    loop.takeDecision(ignored);

    loop.update(20.0f, 2000);              // back inside the band, no request
    loop.takeDecision(ignored);
    loop.update(21.0f, 3000);              // requests again, still blocked

    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(DecisionReason::MIN_OFF_NOT_MET, d.reason);
}

void test_records_blocked_when_min_on_not_met(void) {
    ControlConfig cfg;
    cfg.minOffTimeMs = 0;
    cfg.minOnTimeMs = 600000;
    ControlLoop loop(cfg);
    loop.update(21.0f, 1000);              // cooling starts
    ControlDecision ignored;
    loop.takeDecision(ignored);

    loop.update(20.0f, 2000);              // wants idle, min-on holds it
    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(DecisionKind::BLOCKED, d.kind);
    TEST_ASSERT_EQUAL(DecisionReason::MIN_ON_NOT_MET, d.reason);
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.currentOutput());
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd firmware/fermenter && pio test -e native -f test_control_decision`
Expected: FAIL — the blocked branches record nothing, so `takeDecision` returns false.

- [ ] **Step 3: Implement edge-triggered blocking**

Add to `ControlLoop`'s private section in the header:

```cpp
    // Which request is currently being refused, so a block that persists for
    // minutes produces one decision rather than one per iteration.
    ControlOutput blockedRequest_ = ControlOutput::IDLE;
    bool hasReportedBlock_ = false;
```

In `applyDesired`, replace each bare `return` in a refusal path with a recording guarded on the edge. For the min-on refusal:

```cpp
    if (output_ == ControlOutput::HEATING || output_ == ControlOutput::COOLING) {
        if (!canLeaveActive(nowMs)) {
            if (!hasReportedBlock_ || blockedRequest_ != desired) {
                recordDecision(DecisionKind::BLOCKED, desired, DecisionReason::MIN_ON_NOT_MET,
                               lastReadingC_, lastThresholdC_, nowMs, minOnRemainingMs(nowMs));
                blockedRequest_ = desired;
                hasReportedBlock_ = true;
            }
            return;
        }
    }
```

Use the same shape for the two `canEnterHeating` / `canEnterCooling` refusals with `MIN_OFF_NOT_MET` and `minOffRemainingMs(nowMs, desired)`.

Clear the flag whenever a transition actually happens — add `hasReportedBlock_ = false;` inside `transitionTo`.

Add the two private helpers returning how much of each timer is left, clamped at 0:

```cpp
uint32_t ControlLoop::minOnRemainingMs(uint32_t nowMs) const
{
    const uint32_t held = nowMs - lastTransitionMs_;
    return held >= config_.minOnTimeMs ? 0u : config_.minOnTimeMs - held;
}

uint32_t ControlLoop::minOffRemainingMs(uint32_t nowMs, ControlOutput desired) const
{
    const uint32_t lastOff = (desired == ControlOutput::HEATING) ? heatingLastOffMs_ : coolingLastOffMs_;
    const uint32_t idle = nowMs - lastOff;
    return idle >= config_.minOffTimeMs ? 0u : config_.minOffTimeMs - idle;
}
```

- [ ] **Step 4: Run all firmware tests**

Run: `cd firmware/fermenter && pio test -e native`
Expected: PASS, all suites, `test_control_loop` still unmodified.

- [ ] **Step 5: Commit**

```bash
git add firmware/shared/control/src/ControlLoop.h firmware/shared/control/src/ControlLoop.cpp firmware/fermenter/test/test_control_decision
git commit -m "Report a blocked control request once, on the edge"
```

---

### Task 3: The decision ring buffer

**Files:**
- Create: `firmware/shared/control/src/DecisionBuffer.h`
- Test: `firmware/fermenter/test/test_decision_buffer/test_main.cpp` (create)

**Interfaces:**
- Consumes: `ControlDecision` from Task 1.
- Produces: `class DecisionBuffer` with `void push(const ControlDecision&)`, `bool pop(ControlDecision& out)`, `size_t size() const`, `bool overflowed() const`, `void clearOverflow()`, and `static constexpr size_t kCapacity = 32`.

Header-only: it is a small template-free container and every consumer is in the same library.

- [ ] **Step 1: Write the failing test**

Create `firmware/fermenter/test/test_decision_buffer/test_main.cpp`:

```cpp
#include <unity.h>
#include "DecisionBuffer.h"

using unibrew::ControlDecision;
using unibrew::ControlOutput;
using unibrew::DecisionBuffer;
using unibrew::DecisionReason;

namespace {
ControlDecision make(uint32_t elapsedMs) {
    ControlDecision d;
    d.to = ControlOutput::COOLING;
    d.reason = DecisionReason::ABOVE_DEADBAND;
    d.elapsedMs = elapsedMs;
    return d;
}
}

void setUp(void) {}
void tearDown(void) {}

void test_a_new_buffer_is_empty(void) {
    DecisionBuffer buf;
    ControlDecision out;
    TEST_ASSERT_EQUAL_UINT32(0, buf.size());
    TEST_ASSERT_FALSE(buf.pop(out));
    TEST_ASSERT_FALSE(buf.overflowed());
}

void test_pops_in_the_order_pushed(void) {
    DecisionBuffer buf;
    buf.push(make(1));
    buf.push(make(2));
    buf.push(make(3));

    ControlDecision out;
    TEST_ASSERT_TRUE(buf.pop(out));
    TEST_ASSERT_EQUAL_UINT32(1, out.elapsedMs);
    TEST_ASSERT_TRUE(buf.pop(out));
    TEST_ASSERT_EQUAL_UINT32(2, out.elapsedMs);
    TEST_ASSERT_TRUE(buf.pop(out));
    TEST_ASSERT_EQUAL_UINT32(3, out.elapsedMs);
    TEST_ASSERT_FALSE(buf.pop(out));
}

void test_holds_capacity_entries(void) {
    DecisionBuffer buf;
    for (uint32_t i = 0; i < DecisionBuffer::kCapacity; i++) {
        buf.push(make(i));
    }
    TEST_ASSERT_EQUAL_UINT32(DecisionBuffer::kCapacity, buf.size());
    TEST_ASSERT_FALSE(buf.overflowed());
}

// A long outage must not cost the newest decisions — those are the ones
// closest to whatever the brewer is looking at when the link returns.
void test_overflow_drops_the_oldest(void) {
    DecisionBuffer buf;
    for (uint32_t i = 0; i < DecisionBuffer::kCapacity + 3; i++) {
        buf.push(make(i));
    }
    TEST_ASSERT_EQUAL_UINT32(DecisionBuffer::kCapacity, buf.size());
    TEST_ASSERT_TRUE(buf.overflowed());

    ControlDecision out;
    TEST_ASSERT_TRUE(buf.pop(out));
    TEST_ASSERT_EQUAL_UINT32(3, out.elapsedMs);   // 0,1,2 were dropped
}

void test_clear_overflow_resets_the_flag(void) {
    DecisionBuffer buf;
    for (uint32_t i = 0; i < DecisionBuffer::kCapacity + 1; i++) {
        buf.push(make(i));
    }
    TEST_ASSERT_TRUE(buf.overflowed());
    buf.clearOverflow();
    TEST_ASSERT_FALSE(buf.overflowed());
}

void test_can_be_refilled_after_draining(void) {
    DecisionBuffer buf;
    buf.push(make(1));
    ControlDecision out;
    buf.pop(out);
    buf.push(make(2));

    TEST_ASSERT_EQUAL_UINT32(1, buf.size());
    TEST_ASSERT_TRUE(buf.pop(out));
    TEST_ASSERT_EQUAL_UINT32(2, out.elapsedMs);
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_a_new_buffer_is_empty);
    RUN_TEST(test_pops_in_the_order_pushed);
    RUN_TEST(test_holds_capacity_entries);
    RUN_TEST(test_overflow_drops_the_oldest);
    RUN_TEST(test_clear_overflow_resets_the_flag);
    RUN_TEST(test_can_be_refilled_after_draining);
    return UNITY_END();
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd firmware/fermenter && pio test -e native -f test_decision_buffer`
Expected: compile error — `DecisionBuffer.h` does not exist.

- [ ] **Step 3: Implement the buffer**

Create `firmware/shared/control/src/DecisionBuffer.h`:

```cpp
#pragma once
#include <cstddef>
#include <cstdint>

#include "ControlLoop.h"

namespace unibrew {

// Holds control decisions until MQTT can carry them.
//
// ADR-004 has the device keep controlling while disconnected, so the
// decisions made during an outage are exactly the ones worth reading
// afterwards. Fixed storage, no allocation: this lives on a device with a
// few hundred kilobytes of RAM and a watchdog.
//
// When full it drops the oldest, not the newest. A brewer reconnecting after
// an hour wants what just happened, and the overflow flag tells the UI the
// history has a hole rather than letting it imply completeness.
class DecisionBuffer {
public:
    static constexpr size_t kCapacity = 32;

    void push(const ControlDecision& decision)
    {
        if (count_ == kCapacity) {
            head_ = next(head_);
            count_--;
            overflowed_ = true;
        }
        entries_[tail_] = decision;
        tail_ = next(tail_);
        count_++;
    }

    bool pop(ControlDecision& out)
    {
        if (count_ == 0) {
            return false;
        }
        out = entries_[head_];
        head_ = next(head_);
        count_--;
        return true;
    }

    size_t size() const { return count_; }
    bool overflowed() const { return overflowed_; }
    void clearOverflow() { overflowed_ = false; }

private:
    static size_t next(size_t index) { return (index + 1) % kCapacity; }

    ControlDecision entries_[kCapacity];
    size_t head_ = 0;
    size_t tail_ = 0;
    size_t count_ = 0;
    bool overflowed_ = false;
};

} // namespace unibrew
```

- [ ] **Step 4: Run the tests**

Run: `cd firmware/fermenter && pio test -e native -f test_decision_buffer`
Expected: PASS, 6 tests.

Run: `cd firmware/fermenter && pio test -e native`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add firmware/shared/control/src/DecisionBuffer.h firmware/fermenter/test/test_decision_buffer
git commit -m "Buffer control decisions across an MQTT outage"
```

---

### Task 4: The wire contract in shared-types

**Files:**
- Modify: `packages/shared-types/src/mqtt-topics.ts`
- Create: `packages/shared-types/src/control-state.ts`
- Modify: `packages/shared-types/src/index.ts`
- Modify: `packages/shared-types/src/index.test.ts`

**Interfaces:**
- Consumes: the enum names from Tasks 1–2, lower-cased on the wire.
- Produces: `ControlStatePayloadSchema` / `ControlStatePayload`, `ControlDecisionPayloadSchema` / `ControlDecisionPayload`, `ControlOutputSchema`, `DecisionReasonSchema`, `stateTopic(deviceId)`, `decisionTopic(deviceId)`, `stateWildcardTopic()`, `decisionWildcardTopic()`.

`parseTopic` already accepts `state` — `TopicKind` lists it and it was never used. `decision` must be added to both.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared-types/src/index.test.ts`:

```ts
describe("control state and decisions", () => {
  it("builds the state and decision topics", () => {
    expect(stateTopic("fermenter-01")).toBe("unibrew/fermenter-01/state");
    expect(decisionTopic("fermenter-01")).toBe("unibrew/fermenter-01/decision");
  });

  it("parses both new topics", () => {
    expect(parseTopic("unibrew/fermenter-01/state")).toEqual({ deviceId: "fermenter-01", kind: "state" });
    expect(parseTopic("unibrew/fermenter-01/decision")).toEqual({ deviceId: "fermenter-01", kind: "decision" });
  });

  it("accepts a well-formed state payload", () => {
    const parsed = ControlStatePayloadSchema.parse({
      deviceId: "fermenter-01",
      output: "cooling",
      sinceMs: 134000,
      setpointC: 19,
      mode: "thermostat",
      controlTempC: 19.42,
    });
    expect(parsed.output).toBe("cooling");
  });

  it("allows a null control temperature, for a faulted sensor", () => {
    const parsed = ControlStatePayloadSchema.parse({
      deviceId: "fermenter-01",
      output: "idle",
      sinceMs: 0,
      setpointC: 19,
      mode: "thermostat",
      controlTempC: null,
    });
    expect(parsed.controlTempC).toBeNull();
  });

  it("rejects an unknown output", () => {
    expect(() =>
      ControlStatePayloadSchema.parse({
        deviceId: "fermenter-01",
        output: "defrosting",
        sinceMs: 0,
        setpointC: 19,
        mode: "thermostat",
        controlTempC: 19,
      }),
    ).toThrow();
  });

  it("accepts a transition decision", () => {
    const parsed = ControlDecisionPayloadSchema.parse({
      deviceId: "fermenter-01",
      kind: "transition",
      from: "idle",
      to: "cooling",
      reason: "above_deadband",
      temperatureC: 19.42,
      thresholdC: 19.2,
      elapsedMs: 372000,
      remainingMs: 0,
    });
    expect(parsed.reason).toBe("above_deadband");
  });

  it("accepts a blocked decision", () => {
    const parsed = ControlDecisionPayloadSchema.parse({
      deviceId: "fermenter-01",
      kind: "blocked",
      from: "idle",
      to: "cooling",
      reason: "min_off_not_met",
      temperatureC: 19.42,
      thresholdC: 19.2,
      elapsedMs: 41000,
      remainingMs: 221000,
    });
    expect(parsed.kind).toBe("blocked");
  });

  it("rejects an unknown reason rather than passing it through", () => {
    expect(() =>
      ControlDecisionPayloadSchema.parse({
        deviceId: "fermenter-01",
        kind: "transition",
        from: "idle",
        to: "cooling",
        reason: "vibes",
        temperatureC: 19.42,
        thresholdC: 19.2,
        elapsedMs: 0,
        remainingMs: 0,
      }),
    ).toThrow();
  });
});
```

Add the new names to the import block at the top of that file.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @brewhub/shared-types test`
Expected: FAIL — the schemas and topic helpers are not exported.

- [ ] **Step 3: Create `control-state.ts`**

```ts
import { z } from "zod";

export const ControlOutputSchema = z.enum(["idle", "heating", "cooling"]);
export type ControlOutput = z.infer<typeof ControlOutputSchema>;

/**
 * Why the control loop did what it did. These mirror the branches in the
 * firmware's ControlLoop one for one — the device sends the code and the
 * numbers, never a sentence, so the wording can change without reflashing
 * every device and can be translated.
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

export const DecisionKindSchema = z.enum(["transition", "blocked"]);
export type DecisionKind = z.infer<typeof DecisionKindSchema>;

/**
 * Published retained to unibrew/{deviceId}/state, every 30 s and on any
 * change. Retained so a client that has just connected — or a backend that
 * has just restarted — knows the current state without waiting for the next
 * transition, which may be hours away.
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
 * Published per event to unibrew/{deviceId}/decision, not retained.
 *
 * Every duration is relative to the device's own millis(), because an ESP32
 * has no reliable wall clock. The backend stamps arrival time and derives
 * absolute times from these — which is also what keeps a decision correct
 * after sitting in the firmware's buffer through an outage.
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
```

- [ ] **Step 4: Add the topics**

In `mqtt-topics.ts`, add `"decision"` to the `TopicKind` union and to `VALID_KINDS`, then add beside the existing helpers:

```ts
export function stateTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/state`;
}

export function decisionTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/decision`;
}

export function stateWildcardTopic(): string {
  return `${TOPIC_PREFIX}/+/state`;
}

export function decisionWildcardTopic(): string {
  return `${TOPIC_PREFIX}/+/decision`;
}
```

Re-export everything from `control-state.js` in `index.ts`, following the existing `export * from` pattern.

- [ ] **Step 5: Run the tests and build**

Run: `pnpm --filter @brewhub/shared-types test`
Expected: PASS.

Run: `pnpm --filter @brewhub/shared-types build`
Expected: success. The backend imports compiled output, so this must be run before Task 6.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types
git commit -m "Add the control-state and decision wire contract"
```

---

### Task 5: Firmware publishes state and drains the buffer

**Files:**
- Modify: `firmware/fermenter/src/main.cpp`

**Interfaces:**
- Consumes: `ControlLoop::takeDecision`, `DecisionBuffer`, the topic strings from Task 4.
- Produces: MQTT traffic only. No new API.

This task has no native test — `main.cpp` is the Arduino wiring layer and is not built under `-e native`. Its verification is `pio run -e fermenter-brewpi` compiling, and the logic it calls being covered by Tasks 1–3.

- [ ] **Step 1: Add the publish helpers**

Near the other MQTT helpers in `main.cpp`, add functions that serialise a `ControlDecision` and the current state to JSON matching the Zod schemas from Task 4 exactly. Map the C++ enums to the wire strings:

```cpp
static const char* outputName(unibrew::ControlOutput o)
{
    switch (o) {
        case unibrew::ControlOutput::HEATING: return "heating";
        case unibrew::ControlOutput::COOLING: return "cooling";
        default:                              return "idle";
    }
}

static const char* reasonName(unibrew::DecisionReason r)
{
    switch (r) {
        case unibrew::DecisionReason::ABOVE_DEADBAND:       return "above_deadband";
        case unibrew::DecisionReason::BELOW_DEADBAND:       return "below_deadband";
        case unibrew::DecisionReason::WITHIN_DEADBAND:      return "within_deadband";
        case unibrew::DecisionReason::PID_WINDOW:           return "pid_window";
        case unibrew::DecisionReason::MIN_ON_NOT_MET:       return "min_on_not_met";
        case unibrew::DecisionReason::MIN_OFF_NOT_MET:      return "min_off_not_met";
        case unibrew::DecisionReason::SENSOR_FAULT:         return "sensor_fault";
        case unibrew::DecisionReason::MODE_OFF:             return "mode_off";
        case unibrew::DecisionReason::POLARITY_FORCED_IDLE: return "polarity_forced_idle";
    }
    return "within_deadband";
}
```

Build the JSON with the same fixed `char` buffer and `snprintf` approach the existing telemetry publish uses — no dynamic allocation.

- [ ] **Step 2: Wire it into the loop**

After the existing `controlLoop.update(...)` call:

```cpp
    unibrew::ControlDecision decision;
    if (controlLoop.takeDecision(decision)) {
        if (!publishDecision(decision)) {
            decisionBuffer.push(decision);
        }
        publishControlState();   // a change is worth reporting immediately
        lastStatePublishMs = nowMs;
    } else if (nowMs - lastStatePublishMs >= kStatePublishIntervalMs) {
        publishControlState();
        lastStatePublishMs = nowMs;
    }
```

with `static constexpr uint32_t kStatePublishIntervalMs = 30000;` and a file-scope `unibrew::DecisionBuffer decisionBuffer;`.

`publishControlState` publishes **retained**; `publishDecision` does not. `publishDecision` returns false when the client is not connected, which is what routes the decision into the buffer.

- [ ] **Step 3: Drain on reconnect**

In the branch that runs after MQTT reconnects and resubscribes, drain oldest first, stopping if a publish fails so nothing is lost:

```cpp
    unibrew::ControlDecision buffered;
    while (decisionBuffer.size() > 0) {
        if (!decisionBuffer.pop(buffered)) break;
        if (!publishDecision(buffered)) {
            decisionBuffer.push(buffered);   // put it back, try again later
            break;
        }
    }
```

- [ ] **Step 4: Compile for the real board**

Run: `cd firmware/fermenter && pio run -e fermenter-brewpi`
Expected: success.

Run: `cd firmware/fermenter && pio test -e native`
Expected: PASS, all suites — `main.cpp` is not in the native build, so this confirms nothing else broke.

- [ ] **Step 5: Commit**

```bash
git add firmware/fermenter/src/main.cpp
git commit -m "Publish control state and decisions from the fermenter"
```

---

### Task 6: Backend storage

**Files:**
- Create: `apps/backend/src/db/migrations/0018_control_state_and_decisions.sql`
- Create: `apps/backend/src/db/repositories/control-state.repo.ts`
- Test: `apps/backend/src/db/repositories/control-state.repo.test.ts` (create)

**Interfaces:**
- Consumes: `ControlStatePayload`, `ControlDecisionPayload` from Task 4.
- Produces: `upsertControlState(db, payload, receivedAt)`, `getControlState(db, deviceId)`, `insertDecision(db, payload, receivedAt)`, `listDecisions(db, deviceId, limit)`, `deleteDecisionsOlderThan(db, cutoffMs)`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/db/repositories/control-state.repo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDbClient } from "../client.js";
import { runMigrations } from "../migrate.js";
import { insertDevice } from "./devices.repo.js";
import {
  deleteDecisionsOlderThan,
  getControlState,
  insertDecision,
  listDecisions,
  upsertControlState,
} from "./control-state.repo.js";

function setUp() {
  const db = createDbClient(":memory:");
  runMigrations(db);
  insertDevice(db, { id: "fermenter-01", name: "Chamber", type: "fermenter" });
  return db;
}

const STATE = {
  deviceId: "fermenter-01",
  output: "cooling" as const,
  sinceMs: 134000,
  setpointC: 19,
  mode: "thermostat" as const,
  controlTempC: 19.42,
};

const DECISION = {
  deviceId: "fermenter-01",
  kind: "transition" as const,
  from: "idle" as const,
  to: "cooling" as const,
  reason: "above_deadband" as const,
  temperatureC: 19.42,
  thresholdC: 19.2,
  elapsedMs: 372000,
  remainingMs: 0,
};

describe("control state", () => {
  it("returns null before anything has been reported", () => {
    expect(getControlState(setUp(), "fermenter-01")).toBeNull();
  });

  it("stores and reads back the current state", () => {
    const db = setUp();
    upsertControlState(db, STATE, 1_700_000_000_000);
    const state = getControlState(db, "fermenter-01");
    expect(state).toMatchObject({ output: "cooling", setpointC: 19, controlTempC: 19.42 });
  });

  // The device reports every 30 s; keeping one row per device is the point.
  it("replaces the previous state rather than accumulating rows", () => {
    const db = setUp();
    upsertControlState(db, STATE, 1_700_000_000_000);
    upsertControlState(db, { ...STATE, output: "idle" }, 1_700_000_030_000);
    expect(getControlState(db, "fermenter-01")?.output).toBe("idle");
    expect(db.prepare("select count(*) as n from device_control_state").get()).toEqual({ n: 1 });
  });

  it("keeps a null control temperature null", () => {
    const db = setUp();
    upsertControlState(db, { ...STATE, controlTempC: null }, 1_700_000_000_000);
    expect(getControlState(db, "fermenter-01")?.controlTempC).toBeNull();
  });
});

describe("decisions", () => {
  it("appends rather than replacing", () => {
    const db = setUp();
    insertDecision(db, DECISION, 1_700_000_000_000);
    insertDecision(db, { ...DECISION, to: "idle", reason: "within_deadband" }, 1_700_000_060_000);
    expect(listDecisions(db, "fermenter-01", 10)).toHaveLength(2);
  });

  it("returns newest first", () => {
    const db = setUp();
    insertDecision(db, DECISION, 1_700_000_000_000);
    insertDecision(db, { ...DECISION, reason: "within_deadband" }, 1_700_000_060_000);
    expect(listDecisions(db, "fermenter-01", 10)[0].reason).toBe("within_deadband");
  });

  it("honours the limit", () => {
    const db = setUp();
    for (let i = 0; i < 5; i++) insertDecision(db, DECISION, 1_700_000_000_000 + i * 1000);
    expect(listDecisions(db, "fermenter-01", 2)).toHaveLength(2);
  });

  it("does not leak other devices' decisions", () => {
    const db = setUp();
    insertDevice(db, { id: "kegerator-01", name: "Keg", type: "kegerator" });
    insertDecision(db, DECISION, 1_700_000_000_000);
    expect(listDecisions(db, "kegerator-01", 10)).toHaveLength(0);
  });

  it("deletes only decisions older than the cutoff", () => {
    const db = setUp();
    insertDecision(db, DECISION, 1_000);
    insertDecision(db, DECISION, 9_000);
    deleteDecisionsOlderThan(db, 5_000);
    expect(listDecisions(db, "fermenter-01", 10)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @brewhub/backend test control-state.repo`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the migration**

Create `apps/backend/src/db/migrations/0018_control_state_and_decisions.sql`:

```sql
-- One row per device: what its control loop is doing right now. Replaced on
-- every report, so this is a cache of the retained MQTT message, not history.
CREATE TABLE IF NOT EXISTS device_control_state (
    device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    output TEXT NOT NULL,
    since_ms INTEGER NOT NULL,
    setpoint_c REAL NOT NULL,
    mode TEXT NOT NULL,
    control_temp_c REAL,
    received_at INTEGER NOT NULL
);

-- Append-only. Spec §8 wants every control decision kept for later analysis;
-- this is that record. Volume is a handful an hour per device, so the table
-- stays small even before the retention sweep runs.
CREATE TABLE IF NOT EXISTS control_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    from_output TEXT NOT NULL,
    to_output TEXT NOT NULL,
    reason TEXT NOT NULL,
    temperature_c REAL NOT NULL,
    threshold_c REAL NOT NULL,
    elapsed_ms INTEGER NOT NULL,
    remaining_ms INTEGER NOT NULL,
    received_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_control_decisions_device_time
    ON control_decisions (device_id, received_at DESC);
```

- [ ] **Step 4: Write the repository**

Create `apps/backend/src/db/repositories/control-state.repo.ts` with the five exported functions, following the existing repos' style: prepared statements, snake_case columns mapped to camelCase in the returned objects, `received_at` supplied by the caller rather than read from the clock inside the repo so tests can pin it.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @brewhub/backend test control-state.repo`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/db/migrations/0018_control_state_and_decisions.sql apps/backend/src/db/repositories/control-state.repo.ts apps/backend/src/db/repositories/control-state.repo.test.ts
git commit -m "Store control state and the decision log"
```

---

### Task 7: Backend ingestion

**Files:**
- Modify: `apps/backend/src/mqtt/client.ts`
- Modify: `apps/backend/src/index.ts`
- Test: `apps/backend/src/mqtt/control-state.ingest.test.ts` (create)

**Interfaces:**
- Consumes: Task 4's schemas and wildcards, Task 6's repository.
- Produces: `onControlState` and `onControlDecision` callbacks on the MQTT client options.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/mqtt/control-state.ingest.test.ts` asserting, against an in-memory database and the real handler wiring: a valid state message reaches `upsertControlState`; a valid decision reaches `insertDecision`; a payload failing Zod is dropped and stored nowhere; a message for an unregistered device is dropped rather than violating the foreign key.

That last case matters — a device can publish before it has been registered, and an unhandled constraint error would take the MQTT handler down.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @brewhub/backend test control-state.ingest`
Expected: FAIL.

- [ ] **Step 3: Extend the MQTT client**

Add both wildcards to the `client.subscribe([...])` array on `client.ts:32`, and two branches to the `if/else` chain following the exact shape of the existing ones — `safeParse`, `logger.warn` with `parsed.error.flatten()` and drop on failure, otherwise call the handler.

- [ ] **Step 4: Wire the handlers in `index.ts`**

Pass `onControlState` and `onControlDecision` into the MQTT client options, each guarding on the device existing before writing.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @brewhub/backend test`
Expected: PASS, whole suite.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/mqtt/client.ts apps/backend/src/index.ts apps/backend/src/mqtt/control-state.ingest.test.ts
git commit -m "Ingest control state and decisions from MQTT"
```

---

### Task 8: The history route and retention

**Files:**
- Modify: `apps/backend/src/routes/devices.routes.ts`
- Modify: `apps/backend/src/index.ts`
- Test: `apps/backend/src/routes/decisions.routes.test.ts` (create)

**Interfaces:**
- Consumes: Task 6's `listDecisions`, `deleteDecisionsOlderThan`.
- Produces: `GET /api/devices/:id/decisions?limit=` returning newest-first, and a daily retention sweep.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/routes/decisions.routes.test.ts` following the harness in `sensors.routes.test.ts` — build the app, log in, get a token. Assert: 200 with the decisions newest-first; `limit` respected; a limit above the cap is clamped rather than honoured; 404 for an unknown device; 401 unauthenticated.

The clamp matters: without it a wall display asking for `?limit=999999` would pull the whole table over the wire every reconnect.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @brewhub/backend test decisions.routes`
Expected: FAIL — route not registered.

- [ ] **Step 3: Add the route**

Beside the config route added earlier, guarded by `fastify.verifyAuth`, 404 when `getDevice` returns nothing, `limit` parsed with a Zod coercion defaulting to 50 and capped at 200.

- [ ] **Step 4: Add the retention sweep**

In `index.ts`, beside `startPresenceSweep`, run `deleteDecisionsOlderThan(db, Date.now() - 90 * 24 * 60 * 60 * 1000)` daily. Decisions are low volume, so 90 days costs little and covers a full fermentation plus the argument about it afterwards.

- [ ] **Step 5: Run the whole backend suite**

Run: `pnpm --filter @brewhub/backend test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes/devices.routes.ts apps/backend/src/index.ts apps/backend/src/routes/decisions.routes.test.ts
git commit -m "Serve the decision log and expire it after 90 days"
```

---

## Verification for the whole plan

```bash
cd firmware/fermenter && pio test -e native && pio run -e fermenter-brewpi
cd ../.. && pnpm -r build && pnpm -r typecheck && pnpm -r test
```

The firmware's existing `test_control_loop` suite must pass **with no edits to its file**. That is the plan's single most important check: it is what proves the control behaviour is unchanged.
