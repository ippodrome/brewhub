#include <unity.h>
#include <limits>

#include "ControlLoop.h"

using unibrew::ControlConfig;
using unibrew::ControlLoop;
using unibrew::ControlMode;
using unibrew::ControlOutput;

namespace {
float nan_temp() { return std::numeric_limits<float>::quiet_NaN(); }
}

void setUp(void) {}
void tearDown(void) {}

void test_new_controlloop_uses_safe_default_config(void) {
    ControlLoop loop;
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.currentOutput());
    TEST_ASSERT_EQUAL_FLOAT(20.0f, loop.config().setpointC);
    TEST_ASSERT_EQUAL(ControlMode::THERMOSTAT, loop.config().mode);
    TEST_ASSERT_FALSE(loop.config().heatingEnabled);
    TEST_ASSERT_TRUE(loop.config().coolingEnabled);
}

void test_mode_off_always_idle(void) {
    ControlConfig cfg;
    cfg.mode = ControlMode::OFF;
    ControlLoop loop(cfg);
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(35.0f, 0));
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(-10.0f, 100000));
}

void test_stays_idle_within_deadband(void) {
    ControlLoop loop; // setpoint 20, hysteresis 0.5
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(20.0f, 0));
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(19.6f, 1000));
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(20.4f, 2000));
}

void test_turns_on_cooling_when_above_setpoint_plus_hysteresis(void) {
    ControlLoop loop; // coolingEnabled true by default
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(21.0f, 0));
}

void test_turns_on_heating_when_below_setpoint_minus_hysteresis(void) {
    ControlConfig cfg;
    cfg.heatingEnabled = true;
    ControlLoop loop(cfg);
    TEST_ASSERT_EQUAL(ControlOutput::HEATING, loop.update(18.0f, 0));
}

void test_cooling_disabled_by_config_never_activates(void) {
    ControlConfig cfg;
    cfg.coolingEnabled = false;
    ControlLoop loop(cfg);
    for (uint32_t t = 0; t < 5000; t += 1000) {
        TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(30.0f, t));
    }
}

void test_heating_disabled_by_config_never_activates(void) {
    ControlLoop loop; // heatingEnabled false by default
    for (uint32_t t = 0; t < 5000; t += 1000) {
        TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(5.0f, t));
    }
}

void test_respects_min_on_time_before_leaving_cooling(void) {
    ControlConfig cfg; // minOnTimeMs default 60000, heatingEnabled false
    ControlLoop loop(cfg);
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(25.0f, 0));
    // Drop below the low threshold shortly after — wants to leave cooling, but min-on gate blocks it.
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(18.0f, 1000));
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(18.0f, 59999));
    // Once min-on has elapsed, it's allowed to leave.
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(18.0f, 61000));
}

void test_respects_min_on_time_before_leaving_heating(void) {
    ControlConfig cfg;
    cfg.heatingEnabled = true;
    cfg.coolingEnabled = false;
    ControlLoop loop(cfg);
    TEST_ASSERT_EQUAL(ControlOutput::HEATING, loop.update(15.0f, 0));
    TEST_ASSERT_EQUAL(ControlOutput::HEATING, loop.update(25.0f, 1000));
    TEST_ASSERT_EQUAL(ControlOutput::HEATING, loop.update(25.0f, 59999));
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(25.0f, 61000));
}

void test_respects_min_off_time_before_reentering_cooling(void) {
    ControlConfig cfg;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 60000;
    ControlLoop loop(cfg);
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(25.0f, 0));
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(18.0f, 10)); // leaves cooling, min-on satisfied instantly
    // Temperature calls for cooling again almost immediately — min-off should block it.
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(25.0f, 20));
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(25.0f, 60009));
    // After min-off has elapsed since leaving cooling (t=10), re-entry is allowed.
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(25.0f, 60011));
}

void test_respects_min_off_time_before_reentering_heating(void) {
    ControlConfig cfg;
    cfg.heatingEnabled = true;
    cfg.coolingEnabled = false;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 60000;
    ControlLoop loop(cfg);
    TEST_ASSERT_EQUAL(ControlOutput::HEATING, loop.update(15.0f, 0));
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(25.0f, 10));
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(15.0f, 20));
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(15.0f, 60009));
    TEST_ASSERT_EQUAL(ControlOutput::HEATING, loop.update(15.0f, 60011));
}

void test_never_produces_simultaneous_heat_and_cool(void) {
    ControlConfig cfg;
    cfg.heatingEnabled = true;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg);
    float temps[] = {25.0f, 15.0f, 20.0f, 30.0f, 10.0f, 20.0f};
    uint32_t t = 0;
    for (float temp : temps) {
        ControlOutput out = loop.update(temp, t);
        // A single enum value structurally cannot be both HEATING and COOLING at once;
        // this asserts every observed value is one of the three valid states.
        TEST_ASSERT_TRUE(out == ControlOutput::IDLE || out == ControlOutput::HEATING || out == ControlOutput::COOLING);
        t += 1000;
    }
}

void test_holds_last_output_on_nan_reading(void) {
    ControlLoop loop;
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(25.0f, 0));
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(nan_temp(), 1000));
}

void test_holds_last_output_on_out_of_range_reading(void) {
    ControlLoop loop;
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(25.0f, 0));
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(200.0f, 1000));
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(-100.0f, 2000));
}

void test_forces_idle_after_prolonged_sensor_fault(void) {
    ControlLoop loop;
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(25.0f, 0));
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(nan_temp(), 100));
    // Still under the 300000ms fault timeout.
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(nan_temp(), 100000));
    // Past the 300000ms timeout since the first invalid reading at t=100.
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(nan_temp(), 100 + 300001));
}

void test_recovers_normal_control_after_reading_resumes(void) {
    ControlConfig cfg;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg);
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(25.0f, 0));
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(nan_temp(), 100));
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(nan_temp(), 100 + 300001));
    // A valid reading resumes normal hysteresis-based control immediately.
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(25.0f, 100 + 300001 + 10));
}

void test_config_update_takes_effect_on_next_update_call(void) {
    ControlLoop loop; // heatingEnabled false by default
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(10.0f, 0));

    ControlConfig cfg = loop.config();
    cfg.heatingEnabled = true;
    loop.setConfig(cfg);

    TEST_ASSERT_EQUAL(ControlOutput::HEATING, loop.update(10.0f, 1000));
}

void test_behavior_stays_consistent_across_many_updates_with_unchanged_config(void) {
    ControlLoop loop;
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(25.0f, 0));
    for (uint32_t i = 1; i <= 100; ++i) {
        // Same above-band temperature repeated many times with no config change:
        // output must remain deterministic and unchanged.
        TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(25.0f, i * 1000));
    }
}

int main(int argc, char **argv) {
    UNITY_BEGIN();
    RUN_TEST(test_new_controlloop_uses_safe_default_config);
    RUN_TEST(test_mode_off_always_idle);
    RUN_TEST(test_stays_idle_within_deadband);
    RUN_TEST(test_turns_on_cooling_when_above_setpoint_plus_hysteresis);
    RUN_TEST(test_turns_on_heating_when_below_setpoint_minus_hysteresis);
    RUN_TEST(test_cooling_disabled_by_config_never_activates);
    RUN_TEST(test_heating_disabled_by_config_never_activates);
    RUN_TEST(test_respects_min_on_time_before_leaving_cooling);
    RUN_TEST(test_respects_min_on_time_before_leaving_heating);
    RUN_TEST(test_respects_min_off_time_before_reentering_cooling);
    RUN_TEST(test_respects_min_off_time_before_reentering_heating);
    RUN_TEST(test_never_produces_simultaneous_heat_and_cool);
    RUN_TEST(test_holds_last_output_on_nan_reading);
    RUN_TEST(test_holds_last_output_on_out_of_range_reading);
    RUN_TEST(test_forces_idle_after_prolonged_sensor_fault);
    RUN_TEST(test_recovers_normal_control_after_reading_resumes);
    RUN_TEST(test_config_update_takes_effect_on_next_update_call);
    RUN_TEST(test_behavior_stays_consistent_across_many_updates_with_unchanged_config);
    return UNITY_END();
}
