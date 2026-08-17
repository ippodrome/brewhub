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
    return UNITY_END();
}
