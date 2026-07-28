#include <unity.h>
#include <cmath>
#include <cstring>

#include "DisplayPresenter.h"

using namespace unibrew;

void setUp(void) {}
void tearDown(void) {}

static DisplayModel makeModel() {
    DisplayModel m;
    m.screen = DisplayScreen::STATUS;
    m.deviceId = "fermenter-01";
    m.controlTemperatureC = 18.44f;
    m.setpointC = 18.0f;
    m.mode = ControlMode::THERMOSTAT;
    m.output = ControlOutput::IDLE;
    m.wifiConnected = true;
    m.mqttConnected = true;
    m.sensorCount = 0;
    return m;
}

void test_formats_control_temperature_to_one_decimal(void) {
    DisplayPresenter p;
    p.update(makeModel());
    TEST_ASSERT_EQUAL_STRING("18.4", p.text().controlTemp);
}

void test_formats_negative_control_temperature(void) {
    DisplayModel m = makeModel();
    m.controlTemperatureC = -1.25f;
    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("-1.3", p.text().controlTemp);
}

void test_nan_control_temperature_renders_placeholder_and_fault(void) {
    DisplayModel m = makeModel();
    m.controlTemperatureC = NAN;
    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("--.-", p.text().controlTemp);
    TEST_ASSERT_TRUE(p.text().controlTempFault);
}

void test_no_sensors_renders_fault_even_with_a_number(void) {
    DisplayModel m = makeModel();
    m.sensorCount = 0;
    m.controlTemperatureC = 18.4f;
    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_TRUE(p.text().controlTempFault);
}

void test_valid_reading_with_sensors_is_not_a_fault(void) {
    DisplayModel m = makeModel();
    m.sensorCount = 1;
    std::strcpy(m.sensors[0].addressHex, "28FF641F0417033A");
    m.sensors[0].temperatureC = 18.4f;
    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_FALSE(p.text().controlTempFault);
}

void test_formats_setpoint(void) {
    DisplayPresenter p;
    p.update(makeModel());
    TEST_ASSERT_EQUAL_STRING("setpoint 18.0", p.text().setpoint);
}

void test_copies_device_id(void) {
    DisplayPresenter p;
    p.update(makeModel());
    TEST_ASSERT_EQUAL_STRING("fermenter-01", p.text().deviceId);
}

void test_truncates_overlong_device_id(void) {
    DisplayModel m = makeModel();
    m.deviceId = "a-really-very-long-device-identifier";
    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_UINT(23, std::strlen(p.text().deviceId));
}

int main(int argc, char** argv) {
    UNITY_BEGIN();
    RUN_TEST(test_formats_control_temperature_to_one_decimal);
    RUN_TEST(test_formats_negative_control_temperature);
    RUN_TEST(test_nan_control_temperature_renders_placeholder_and_fault);
    RUN_TEST(test_no_sensors_renders_fault_even_with_a_number);
    RUN_TEST(test_valid_reading_with_sensors_is_not_a_fault);
    RUN_TEST(test_formats_setpoint);
    RUN_TEST(test_copies_device_id);
    RUN_TEST(test_truncates_overlong_device_id);
    return UNITY_END();
}
