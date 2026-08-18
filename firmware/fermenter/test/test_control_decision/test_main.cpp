#include <unity.h>

#include "ControlLoop.h"

using unibrew::ControlConfig;
using unibrew::ControlDecision;
using unibrew::ControlLoop;
using unibrew::ControlMode;
using unibrew::ControlOutput;
using unibrew::DecisionKind;
using unibrew::DecisionReason;
using unibrew::PidGains;

void setUp(void) {}
void tearDown(void) {}

void test_no_decision_pending_on_a_fresh_loop(void) {
    ControlLoop loop;
    ControlDecision d;
    TEST_ASSERT_FALSE(loop.takeDecision(d));
}

void test_records_cooling_above_deadband(void) {
    ControlLoop loop; // setpoint 20, hysteresis 0.5, cooling enabled
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
    ControlLoop loop;
    loop.update(21.0f, 1000);

    ControlDecision first;
    TEST_ASSERT_TRUE(loop.takeDecision(first));
    ControlDecision second;
    TEST_ASSERT_FALSE(loop.takeDecision(second));
}

void test_records_heating_below_deadband(void) {
    ControlConfig cfg;
    cfg.heatingEnabled = true;
    ControlLoop loop(cfg);
    loop.update(19.0f, 1000);

    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(ControlOutput::HEATING, d.to);
    TEST_ASSERT_EQUAL(DecisionReason::BELOW_DEADBAND, d.reason);
    TEST_ASSERT_EQUAL_FLOAT(19.5f, d.thresholdC);
}

// The deadband is a full swing: cooling starts above the upper limit and runs
// until the reading falls below the LOWER one, not back to the setpoint. A
// reading inside the band changes nothing, which is the point of hysteresis.
void test_a_reading_inside_the_band_decides_nothing(void) {
    ControlConfig cfg;
    cfg.minOnTimeMs = 0;
    ControlLoop loop(cfg);
    loop.update(21.0f, 1000);
    ControlDecision ignored;
    loop.takeDecision(ignored);

    loop.update(20.0f, 2000);
    TEST_ASSERT_FALSE(loop.takeDecision(ignored));
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.currentOutput());
}

void test_records_cooling_stopping_below_the_band(void) {
    ControlConfig cfg;
    cfg.minOnTimeMs = 0;
    ControlLoop loop(cfg);
    loop.update(21.0f, 1000);
    ControlDecision ignored;
    loop.takeDecision(ignored);

    loop.update(19.4f, 2000);
    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, d.from);
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, d.to);
    TEST_ASSERT_EQUAL(DecisionReason::BELOW_DEADBAND, d.reason);
    TEST_ASSERT_EQUAL_FLOAT(19.5f, d.thresholdC);
}

// elapsedMs is how long the previous output had held. It is what lets the UI
// say "cooled for 8m41s" without the device owning a wall clock.
void test_reports_how_long_the_previous_output_had_held(void) {
    ControlConfig cfg;
    cfg.minOnTimeMs = 0;
    ControlLoop loop(cfg);
    loop.update(21.0f, 1000);
    ControlDecision ignored;
    loop.takeDecision(ignored);

    loop.update(19.4f, 61000);
    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL_UINT32(60000, d.elapsedMs);
}

void test_records_mode_off(void) {
    ControlConfig cfg;
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
    ControlLoop loop;
    loop.update(21.0f, 1000);
    ControlDecision ignored;
    loop.takeDecision(ignored);

    loop.forceIdleAndArmMinOff(2000);
    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, d.to);
    TEST_ASSERT_EQUAL(DecisionReason::POLARITY_FORCED_IDLE, d.reason);
}


// A block is only reachable once the device has run that output before -
// coolingLastOffMs_ starts at "never", so the very first start is free.
void test_records_blocked_when_min_off_not_met(void) {
    ControlConfig cfg;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 600000;   // 10 min
    ControlLoop loop(cfg);
    ControlDecision ignored;

    loop.update(21.0f, 1000);    // first cool, allowed
    loop.takeDecision(ignored);
    loop.update(19.4f, 2000);    // stops, arms min-off
    loop.takeDecision(ignored);

    loop.update(21.0f, 3000);    // wants to cool again, refused
    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(DecisionKind::BLOCKED, d.kind);
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, d.to);
    TEST_ASSERT_EQUAL(DecisionReason::MIN_OFF_NOT_MET, d.reason);
    TEST_ASSERT_EQUAL_UINT32(599000, d.remainingMs);
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.currentOutput());
}

void test_a_continuing_block_is_reported_once(void) {
    ControlConfig cfg;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 600000;
    ControlLoop loop(cfg);
    ControlDecision ignored;

    loop.update(21.0f, 1000);
    loop.takeDecision(ignored);
    loop.update(19.4f, 2000);
    loop.takeDecision(ignored);

    loop.update(21.0f, 3000);
    TEST_ASSERT_TRUE(loop.takeDecision(ignored));
    loop.update(21.0f, 4000);
    loop.update(21.0f, 5000);
    TEST_ASSERT_FALSE(loop.takeDecision(ignored));
}

void test_records_blocked_when_min_on_not_met(void) {
    ControlConfig cfg;
    cfg.minOnTimeMs = 600000;
    ControlLoop loop(cfg);
    ControlDecision ignored;

    loop.update(21.0f, 1000);              // cooling starts
    loop.takeDecision(ignored);

    loop.update(19.4f, 2000);              // wants idle, min-on holds it
    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(DecisionKind::BLOCKED, d.kind);
    TEST_ASSERT_EQUAL(DecisionReason::MIN_ON_NOT_MET, d.reason);
    TEST_ASSERT_EQUAL_UINT32(599000, d.remainingMs);
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.currentOutput());
}


// The state report needs "how long has it been doing this", which it derives
// from this against its own clock.
void test_exposes_when_the_output_last_changed(void) {
    ControlLoop loop;
    TEST_ASSERT_EQUAL_UINT32(0, loop.lastTransitionMs());
    loop.update(21.0f, 7000);
    TEST_ASSERT_EQUAL_UINT32(7000, loop.lastTransitionMs());
}


void test_side_switch_min_off_records_idle_then_blocked(void) {
    ControlConfig cfg;
    cfg.heatingEnabled = true;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 600000;
    ControlLoop loop(cfg);
    ControlDecision ignored;

    loop.update(21.0f, 1000);  // cooling
    loop.takeDecision(ignored);
    loop.update(19.0f, 2000);  // heating (first heat is free)
    loop.takeDecision(ignored);

    loop.update(21.0f, 3000);  // wants cooling, min-off refuses, goes idle
    ControlDecision first, second;
    TEST_ASSERT_TRUE(loop.takeDecision(first));
    TEST_ASSERT_EQUAL(DecisionKind::TRANSITION, first.kind);
    TEST_ASSERT_EQUAL(ControlOutput::HEATING, first.from);
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, first.to);
    TEST_ASSERT_TRUE(loop.takeDecision(second));
    TEST_ASSERT_EQUAL(DecisionKind::BLOCKED, second.kind);
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, second.to);
    TEST_ASSERT_EQUAL(DecisionReason::MIN_OFF_NOT_MET, second.reason);
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.currentOutput());
    TEST_ASSERT_FALSE(loop.takeDecision(ignored));

    loop.update(21.0f, 4000);
    TEST_ASSERT_FALSE(loop.takeDecision(ignored));
}

void test_polarity_then_blocked_are_both_kept(void) {
    ControlConfig cfg;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 600000;
    ControlLoop loop(cfg);
    ControlDecision ignored;

    loop.update(21.0f, 1000);
    loop.takeDecision(ignored);

    loop.forceIdleAndArmMinOff(2000);
    ControlDecision polarity;
    TEST_ASSERT_TRUE(loop.takeDecision(polarity));
    TEST_ASSERT_EQUAL(DecisionReason::POLARITY_FORCED_IDLE, polarity.reason);

    loop.update(21.0f, 3000);
    ControlDecision blocked;
    TEST_ASSERT_TRUE(loop.takeDecision(blocked));
    TEST_ASSERT_EQUAL(DecisionKind::BLOCKED, blocked.kind);
    TEST_ASSERT_EQUAL(DecisionReason::MIN_OFF_NOT_MET, blocked.reason);
    TEST_ASSERT_FALSE(loop.takeDecision(ignored));
}

void test_block_is_reported_again_after_request_withdraws(void) {
    ControlConfig cfg;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 600000;
    ControlLoop loop(cfg);
    ControlDecision ignored;

    loop.update(21.0f, 1000);
    loop.takeDecision(ignored);
    loop.update(19.4f, 2000);
    loop.takeDecision(ignored);

    loop.update(21.0f, 3000);
    TEST_ASSERT_TRUE(loop.takeDecision(ignored)); // blocked

    loop.update(20.0f, 4000); // inside band, desired == idle
    TEST_ASSERT_FALSE(loop.takeDecision(ignored));

    loop.update(21.0f, 5000); // request cooling again, still min-off
    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(DecisionKind::BLOCKED, d.kind);
    TEST_ASSERT_EQUAL(DecisionReason::MIN_OFF_NOT_MET, d.reason);
}


void test_pid_window_records_pid_window_reason(void) {
    ControlConfig cfg;
    cfg.mode = ControlMode::PID;
    cfg.setpointC = 25.0f;
    cfg.pidGains = PidGains{10.0f, 0.0f, 0.0f};
    cfg.pidWindowMs = 1000;
    cfg.heatingEnabled = true;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg);

    // error=5, pidOutput=50 -> heating for 50% of the window. Same fixture as
    // test_pid_mode_heating_demand_turns_on_heating_within_window.
    loop.update(20.0f, 0);
    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(DecisionKind::TRANSITION, d.kind);
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, d.from);
    TEST_ASSERT_EQUAL(ControlOutput::HEATING, d.to);
    TEST_ASSERT_EQUAL(DecisionReason::PID_WINDOW, d.reason);
    TEST_ASSERT_EQUAL_FLOAT(20.0f, d.temperatureC);
    TEST_ASSERT_EQUAL_FLOAT(25.0f, d.thresholdC);
}

void test_thermostat_decision_uses_calibrated_temperature(void) {
    ControlConfig cfg;
    cfg.controlSensorOffsetC = 0.5f;
    ControlLoop loop(cfg);
    loop.update(21.0f, 1000);  // raw 21, calibrated 21.5, above 20.5 high
    ControlDecision d;
    TEST_ASSERT_TRUE(loop.takeDecision(d));
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, d.to);
    TEST_ASSERT_EQUAL_FLOAT(21.5f, d.temperatureC);
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_no_decision_pending_on_a_fresh_loop);
    RUN_TEST(test_records_cooling_above_deadband);
    RUN_TEST(test_taking_a_decision_clears_it);
    RUN_TEST(test_records_heating_below_deadband);
    RUN_TEST(test_a_reading_inside_the_band_decides_nothing);
    RUN_TEST(test_records_cooling_stopping_below_the_band);
    RUN_TEST(test_reports_how_long_the_previous_output_had_held);
    RUN_TEST(test_records_mode_off);
    RUN_TEST(test_records_sensor_fault_after_timeout);
    RUN_TEST(test_records_forced_idle_from_polarity_change);
    RUN_TEST(test_records_blocked_when_min_off_not_met);
    RUN_TEST(test_a_continuing_block_is_reported_once);
    RUN_TEST(test_records_blocked_when_min_on_not_met);
    RUN_TEST(test_exposes_when_the_output_last_changed);
    RUN_TEST(test_side_switch_min_off_records_idle_then_blocked);
    RUN_TEST(test_polarity_then_blocked_are_both_kept);
    RUN_TEST(test_block_is_reported_again_after_request_withdraws);
    RUN_TEST(test_pid_window_records_pid_window_reason);
    RUN_TEST(test_thermostat_decision_uses_calibrated_temperature);
    return UNITY_END();
}
