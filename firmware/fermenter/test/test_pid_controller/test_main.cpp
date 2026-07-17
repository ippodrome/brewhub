#include <unity.h>

#include "PidController.h"

using unibrew::PidController;
using unibrew::PidGains;

void setUp(void) {}
void tearDown(void) {}

void test_zero_gains_produces_zero_output(void) {
    PidController pid;
    TEST_ASSERT_EQUAL_FLOAT(0.0f, pid.update(20.0f, 18.0f, 0));
}

void test_first_call_uses_proportional_only(void) {
    PidController pid(PidGains{2.0f, 0.0f, 0.0f});
    TEST_ASSERT_EQUAL_FLOAT(4.0f, pid.update(20.0f, 18.0f, 0)); // error=2, p=2*2=4
}

void test_positive_error_produces_heating_demand(void) {
    PidController pid(PidGains{1.0f, 0.0f, 0.0f});
    float out = pid.update(20.0f, 18.0f, 0); // setpoint above measured
    TEST_ASSERT_TRUE(out > 0.0f);
}

void test_negative_error_produces_cooling_demand(void) {
    PidController pid(PidGains{1.0f, 0.0f, 0.0f});
    float out = pid.update(18.0f, 20.0f, 0); // setpoint below measured
    TEST_ASSERT_TRUE(out < 0.0f);
}

void test_integral_accumulates_over_time(void) {
    PidController pid(PidGains{0.0f, 1.0f, 0.0f});
    TEST_ASSERT_EQUAL_FLOAT(0.0f, pid.update(20.0f, 18.0f, 0));       // first call: no integral yet
    TEST_ASSERT_EQUAL_FLOAT(2.0f, pid.update(20.0f, 18.0f, 1000));    // integral = 2*1s = 2
    TEST_ASSERT_EQUAL_FLOAT(4.0f, pid.update(20.0f, 18.0f, 2000));    // integral = 2+2*1s = 4
}

void test_integral_anti_windup_bounds_recovery_time(void) {
    PidController pid(PidGains{0.0f, 1.0f, 0.0f});
    pid.update(70.0f, 20.0f, 0);                                     // seed, error=50
    pid.update(70.0f, 20.0f, 1000);                                  // integral=50, output=50
    float saturated = pid.update(70.0f, 20.0f, 2000);                // integral clamped to 100
    TEST_ASSERT_EQUAL_FLOAT(100.0f, saturated);
    float stillSaturated = pid.update(70.0f, 20.0f, 3000);           // integral stays clamped at 100
    TEST_ASSERT_EQUAL_FLOAT(100.0f, stillSaturated);

    // Error reverses sign. If the integral term weren't clamped, it would have
    // grown far past 100 during saturation and take many steps to unwind.
    // Because it's capped at exactly 100, a single reversal step already
    // brings output down to a predictable, bounded value.
    float afterReversal = pid.update(20.0f, 70.0f, 4000); // error now -50
    TEST_ASSERT_EQUAL_FLOAT(50.0f, afterReversal);
}

void test_derivative_responds_to_rate_of_change(void) {
    PidController pid(PidGains{0.0f, 0.0f, 1.0f});
    pid.update(20.0f, 18.0f, 0);                                     // seed, error=2
    float out1 = pid.update(20.0f, 15.0f, 1000);                     // error=5, d=(5-2)/1=3
    TEST_ASSERT_EQUAL_FLOAT(3.0f, out1);
    float out2 = pid.update(20.0f, 15.0f, 2000);                     // error unchanged=5, d=0
    TEST_ASSERT_EQUAL_FLOAT(0.0f, out2);
}

void test_output_clamped_to_valid_range(void) {
    PidController pidHigh(PidGains{1000.0f, 0.0f, 0.0f});
    TEST_ASSERT_EQUAL_FLOAT(100.0f, pidHigh.update(20.0f, 18.0f, 0));

    PidController pidLow(PidGains{1000.0f, 0.0f, 0.0f});
    TEST_ASSERT_EQUAL_FLOAT(-100.0f, pidLow.update(0.0f, 1000.0f, 0));
}

void test_reset_clears_integral_and_derivative_state(void) {
    PidController pid(PidGains{0.0f, 1.0f, 0.0f});
    pid.update(20.0f, 18.0f, 0);
    pid.update(20.0f, 18.0f, 1000); // integral now nonzero (output was 2.0)

    pid.reset();

    // Post-reset, this must behave exactly like a fresh first call: proportional
    // only (here 0, since kp=0), not carrying forward the accumulated integral.
    TEST_ASSERT_EQUAL_FLOAT(0.0f, pid.update(20.0f, 18.0f, 5000));
}

void test_gains_update_takes_effect_on_next_update_call(void) {
    PidController pid(PidGains{1.0f, 0.0f, 0.0f});
    TEST_ASSERT_EQUAL_FLOAT(2.0f, pid.update(20.0f, 18.0f, 0)); // p=1*2=2

    PidGains updated{5.0f, 0.0f, 0.0f};
    pid.setGains(updated);
    TEST_ASSERT_EQUAL_FLOAT(10.0f, pid.update(20.0f, 18.0f, 1000)); // p=5*2=10
}

int main(int argc, char** argv) {
    UNITY_BEGIN();
    RUN_TEST(test_zero_gains_produces_zero_output);
    RUN_TEST(test_first_call_uses_proportional_only);
    RUN_TEST(test_positive_error_produces_heating_demand);
    RUN_TEST(test_negative_error_produces_cooling_demand);
    RUN_TEST(test_integral_accumulates_over_time);
    RUN_TEST(test_integral_anti_windup_bounds_recovery_time);
    RUN_TEST(test_derivative_responds_to_rate_of_change);
    RUN_TEST(test_output_clamped_to_valid_range);
    RUN_TEST(test_reset_clears_integral_and_derivative_state);
    RUN_TEST(test_gains_update_takes_effect_on_next_update_call);
    return UNITY_END();
}
