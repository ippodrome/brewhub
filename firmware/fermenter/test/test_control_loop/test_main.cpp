#include <unity.h>
#include <limits>

#include "ControlLoop.h"

using unibrew::ControlConfig;
using unibrew::ControlLoop;
using unibrew::ControlMode;
using unibrew::ControlOutput;
using unibrew::PidGains;

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

void test_pid_mode_heating_demand_turns_on_heating_within_window(void) {
    ControlConfig cfg;
    cfg.mode = ControlMode::PID;
    cfg.setpointC = 25.0f;
    cfg.pidGains = PidGains{10.0f, 0.0f, 0.0f};
    cfg.pidWindowMs = 1000;
    cfg.heatingEnabled = true;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg);

    // error=5, pidOutput=10*5=50 -> on for 50% of the 1000ms window.
    TEST_ASSERT_EQUAL(ControlOutput::HEATING, loop.update(20.0f, 0));
}

void test_pid_mode_cooling_demand_turns_on_cooling_within_window(void) {
    ControlConfig cfg;
    cfg.mode = ControlMode::PID;
    cfg.setpointC = 15.0f;
    cfg.pidGains = PidGains{10.0f, 0.0f, 0.0f};
    cfg.pidWindowMs = 1000;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg); // coolingEnabled defaults true

    // error=-5, pidOutput=-50 -> cooling demand.
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(20.0f, 0));
}

void test_pid_mode_respects_heating_disabled_even_with_positive_pid_output(void) {
    ControlConfig cfg;
    cfg.mode = ControlMode::PID;
    cfg.setpointC = 25.0f;
    cfg.pidGains = PidGains{10.0f, 0.0f, 0.0f};
    cfg.pidWindowMs = 1000;
    cfg.heatingEnabled = false; // PID wants to heat, but it's disabled
    cfg.coolingEnabled = false;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg);

    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(20.0f, 0));
}

void test_pid_mode_time_proportions_on_then_off_within_window(void) {
    ControlConfig cfg;
    cfg.mode = ControlMode::PID;
    cfg.setpointC = 25.0f;
    cfg.pidGains = PidGains{10.0f, 0.0f, 0.0f};
    cfg.pidWindowMs = 1000;
    cfg.heatingEnabled = true;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg);

    // onDuration = 1000 * (50/100) = 500ms within this window.
    TEST_ASSERT_EQUAL(ControlOutput::HEATING, loop.update(20.0f, 0));
    TEST_ASSERT_EQUAL(ControlOutput::HEATING, loop.update(20.0f, 300)); // still within on-portion
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(20.0f, 600));    // past on-portion, same window
}

void test_pid_mode_new_window_recomputes_from_current_temperature(void) {
    ControlConfig cfg;
    cfg.mode = ControlMode::PID;
    cfg.setpointC = 25.0f;
    cfg.pidGains = PidGains{10.0f, 0.0f, 0.0f};
    cfg.pidWindowMs = 1000;
    cfg.heatingEnabled = true;
    cfg.coolingEnabled = true;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg);

    TEST_ASSERT_EQUAL(ControlOutput::HEATING, loop.update(20.0f, 0)); // below setpoint

    // Window boundary reached (elapsed >= 1000ms): PID recomputes using the
    // NEW temperature, now above setpoint, flipping the direction entirely —
    // proving this is a fresh computation, not a stale carried-over window.
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(26.0f, 1000));
}

void test_pid_mode_respects_min_on_time_before_leaving_heating(void) {
    ControlConfig cfg;
    cfg.mode = ControlMode::PID;
    cfg.setpointC = 25.0f;
    cfg.pidGains = PidGains{10.0f, 0.0f, 0.0f};
    cfg.pidWindowMs = 1000;
    cfg.heatingEnabled = true;
    cfg.minOnTimeMs = 5000; // longer than the window itself
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg);

    TEST_ASSERT_EQUAL(ControlOutput::HEATING, loop.update(20.0f, 0));
    // Window logic wants to turn off at the 500ms mark, but min-on-time (5s)
    // must win — compressor/heater protection overrides PID time-proportioning.
    TEST_ASSERT_EQUAL(ControlOutput::HEATING, loop.update(20.0f, 600));
}

void test_pid_mode_holds_last_output_on_invalid_reading(void) {
    ControlConfig cfg;
    cfg.mode = ControlMode::PID;
    cfg.setpointC = 25.0f;
    cfg.pidGains = PidGains{10.0f, 0.0f, 0.0f};
    cfg.pidWindowMs = 1000;
    cfg.heatingEnabled = true;
    cfg.coolingEnabled = false;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg);

    TEST_ASSERT_EQUAL(ControlOutput::HEATING, loop.update(20.0f, 0));
    // The mode-agnostic invalid-reading fail-safe must still apply in PID mode.
    TEST_ASSERT_EQUAL(ControlOutput::HEATING, loop.update(nan_temp(), 100));
}

void test_switching_modes_resets_pid_integral_state(void) {
    ControlConfig cfg;
    cfg.mode = ControlMode::PID;
    cfg.setpointC = 25.0f;
    cfg.pidGains = PidGains{0.0f, 1.0f, 0.0f}; // integral-only, for clear detection
    cfg.pidWindowMs = 1000;
    cfg.heatingEnabled = true;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg);

    loop.update(20.0f, 0);    // seeds PID's internal history, error=5, output=0 (first call, kp=0)
    loop.update(20.0f, 1000); // integral accumulates (error*dt=5), output becomes nonzero (HEATING)

    ControlConfig thermostatCfg = cfg;
    thermostatCfg.mode = ControlMode::THERMOSTAT;
    loop.setConfig(thermostatCfg); // mode change #1 -> resets PID state

    ControlConfig backToPid = cfg;
    loop.setConfig(backToPid); // mode change #2, back to PID -> resets again

    // If the integral from the earlier PID session had survived, this would
    // compute a nonzero (HEATING) output. Because it was reset, this behaves
    // exactly like PidController's fresh first call: proportional-only, and
    // kp=0 here, so the result must be exactly IDLE.
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(20.0f, 2000));
}

// --- Control sensor calibration offset -------------------------------------
// The offset shifts what the loop *believes* the temperature is, so the whole
// deadband moves with it. A sensor reading 1.0 too low (offset +1.0) must make
// the loop cool 1.0 earlier in raw terms, otherwise the chamber sits 1.0 warm
// while the UI insists it's on setpoint.

void test_offset_shifts_the_deadband(void) {
    ControlConfig cfg; // setpoint 20, hysteresis 0.5, cooling only
    cfg.controlSensorOffsetC = 1.0f;
    ControlLoop loop(cfg);

    // Raw 20.4 would be inside the deadband uncalibrated; calibrated it's
    // 21.4, above setpoint+hysteresis, so cooling must engage.
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(20.4f, 0));
}

void test_negative_offset_shifts_the_deadband_the_other_way(void) {
    ControlConfig cfg;
    cfg.controlSensorOffsetC = -1.0f;
    ControlLoop loop(cfg);

    // Raw 20.9 is above the uncalibrated high edge (20.5), but calibrated
    // it's 19.9 — inside the deadband, so no cooling.
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(20.9f, 0));
}

void test_zero_offset_is_identical_to_no_offset(void) {
    ControlConfig cfg;
    cfg.controlSensorOffsetC = 0.0f;
    ControlLoop loop(cfg);

    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(20.4f, 0));
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(20.6f, 1000));
}

void test_offset_does_not_rescue_a_faulted_reading(void) {
    // A disconnected DS18B20 reads -127. Even with the largest offset the
    // backend will ever send, that must stay a fault and never be treated as
    // a real temperature that happens to be in range.
    ControlConfig cfg;
    cfg.controlSensorOffsetC = 10.0f;
    ControlLoop loop(cfg);

    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(-127.0f, 0));
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(nan_temp(), 1000));
}

void test_offset_applies_in_pid_mode_too(void) {
    ControlConfig cfg;
    cfg.mode = ControlMode::PID;
    cfg.setpointC = 20.0f;
    cfg.pidGains = PidGains{10.0f, 0.0f, 0.0f};
    cfg.pidWindowMs = 10000;
    cfg.heatingEnabled = true;
    cfg.coolingEnabled = true;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 0;
    cfg.controlSensorOffsetC = 5.0f;
    ControlLoop loop(cfg);

    // Raw 18.0 reads below setpoint (would call for heat), but calibrated to
    // 23.0 it's above setpoint, so the PID must demand cooling instead.
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(18.0f, 0));
}

// --- forceIdleAndArmMinOff (relay polarity change) -------------------------
// Called when relay polarity is reconfigured, which changes what the outputs
// physically mean. The compressor may have been running under the old, wrong
// interpretation while this loop believed it was idle — so min-off has to
// start from now regardless of what the loop thought its output was.

void test_force_idle_drives_output_to_idle(void) {
    ControlConfig cfg;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg);

    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(25.0f, 0));
    loop.forceIdleAndArmMinOff(1000);
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.currentOutput());
}

void test_force_idle_arms_min_off_even_when_already_idle(void) {
    // The case that matters: under a wrong polarity the compressor ran while
    // the loop sat IDLE, so nothing ever armed the min-off timer. After
    // correcting polarity, cooling must still be held off.
    ControlConfig cfg;
    cfg.minOffTimeMs = 60000;
    ControlLoop loop(cfg);

    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(20.0f, 0)); // in deadband, never cooled
    loop.forceIdleAndArmMinOff(1000);

    // Demand cooling immediately: must be refused until min-off has elapsed.
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(25.0f, 2000));
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(25.0f, 60000));
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(25.0f, 61001));
}

void test_force_idle_arms_min_off_for_heating_too(void) {
    ControlConfig cfg;
    cfg.heatingEnabled = true;
    cfg.minOffTimeMs = 60000;
    ControlLoop loop(cfg);

    loop.forceIdleAndArmMinOff(1000);

    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(10.0f, 2000));
    TEST_ASSERT_EQUAL(ControlOutput::HEATING, loop.update(10.0f, 61001));
}

void test_force_idle_resets_pid_window(void) {
    // A duty cycle computed under the old output interpretation is
    // meaningless; the next window must be recomputed from current
    // conditions rather than finishing the old one.
    ControlConfig cfg;
    cfg.mode = ControlMode::PID;
    cfg.setpointC = 20.0f;
    cfg.pidGains = PidGains{10.0f, 0.0f, 0.0f};
    cfg.pidWindowMs = 10000;
    cfg.coolingEnabled = true;
    cfg.minOnTimeMs = 0;
    cfg.minOffTimeMs = 0;
    ControlLoop loop(cfg);

    TEST_ASSERT_EQUAL(ControlOutput::COOLING, loop.update(30.0f, 0));

    loop.forceIdleAndArmMinOff(1000);
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.currentOutput());

    // Temperature is now at setpoint, so the fresh window must demand
    // nothing — proof it recomputed rather than resuming the old duty cycle.
    TEST_ASSERT_EQUAL(ControlOutput::IDLE, loop.update(20.0f, 2000));
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
    RUN_TEST(test_pid_mode_heating_demand_turns_on_heating_within_window);
    RUN_TEST(test_pid_mode_cooling_demand_turns_on_cooling_within_window);
    RUN_TEST(test_pid_mode_respects_heating_disabled_even_with_positive_pid_output);
    RUN_TEST(test_pid_mode_time_proportions_on_then_off_within_window);
    RUN_TEST(test_pid_mode_new_window_recomputes_from_current_temperature);
    RUN_TEST(test_pid_mode_respects_min_on_time_before_leaving_heating);
    RUN_TEST(test_pid_mode_holds_last_output_on_invalid_reading);
    RUN_TEST(test_switching_modes_resets_pid_integral_state);
    RUN_TEST(test_offset_shifts_the_deadband);
    RUN_TEST(test_negative_offset_shifts_the_deadband_the_other_way);
    RUN_TEST(test_zero_offset_is_identical_to_no_offset);
    RUN_TEST(test_offset_does_not_rescue_a_faulted_reading);
    RUN_TEST(test_offset_applies_in_pid_mode_too);
    RUN_TEST(test_force_idle_drives_output_to_idle);
    RUN_TEST(test_force_idle_arms_min_off_even_when_already_idle);
    RUN_TEST(test_force_idle_arms_min_off_for_heating_too);
    RUN_TEST(test_force_idle_resets_pid_window);
    return UNITY_END();
}
