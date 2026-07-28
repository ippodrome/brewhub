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

void test_first_update_marks_everything_dirty(void) {
    DisplayPresenter p;
    p.update(makeModel());
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::DEVICE_ID));
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::CONNECTION));
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::CONTROL_TEMP));
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::SETPOINT));
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::OFFLINE_NOTICE));
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::OUTPUT_BAND));
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::SENSORS));
}

void test_identical_update_marks_nothing_dirty(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();
    p.update(m);
    p.clearDirty();
    p.update(m);
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::DEVICE_ID));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::CONNECTION));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::CONTROL_TEMP));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::SETPOINT));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::OFFLINE_NOTICE));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::OUTPUT_BAND));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::SENSORS));
}

void test_mqtt_drop_dirties_the_offline_notice(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();
    p.update(m);
    p.clearDirty();

    m.mqttConnected = false;
    p.update(m);
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::OFFLINE_NOTICE));
}

void test_wifi_drop_alone_does_not_dirty_the_offline_notice(void) {
    // The notice is about the broker specifically — it claims the control
    // loop is still running, which is a statement about MQTT, not WiFi.
    DisplayPresenter p;
    DisplayModel m = makeModel();
    p.update(m);
    p.clearDirty();

    m.wifiConnected = false;
    p.update(m);
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::CONNECTION));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::OFFLINE_NOTICE));
}

void test_sub_decimal_change_does_not_dirty_the_temperature(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();
    m.controlTemperatureC = 18.44f;
    p.update(m);
    p.clearDirty();

    m.controlTemperatureC = 18.43f; // still formats as "18.4"
    p.update(m);
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::CONTROL_TEMP));
}

// All 7 DisplayField enumerators, used to assert dirty/clean state across
// every field rather than a hand-picked subset.
static const DisplayField kAllDisplayFields[] = {
    DisplayField::DEVICE_ID,   DisplayField::CONNECTION,      DisplayField::CONTROL_TEMP,
    DisplayField::SETPOINT,    DisplayField::OFFLINE_NOTICE,  DisplayField::OUTPUT_BAND,
    DisplayField::SENSORS,
};

// Asserts that every field other than `except` is clean. Callers assert
// `except` itself dirty separately, so this only ever needs to check "not
// dirty" for the rest.
static void assertAllFieldsCleanExcept(const DisplayPresenter& p, DisplayField except) {
    for (DisplayField field : kAllDisplayFields) {
        if (field != except) {
            TEST_ASSERT_FALSE(p.isDirty(field));
        }
    }
}

void test_visible_temperature_change_dirties_only_that_field(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();
    p.update(m);
    p.clearDirty();

    m.controlTemperatureC = 19.1f;
    p.update(m);
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::CONTROL_TEMP));
    assertAllFieldsCleanExcept(p, DisplayField::CONTROL_TEMP);
}

void test_mqtt_drop_leaves_the_temperature_alone(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();
    p.update(m);
    p.clearDirty();

    m.mqttConnected = false;
    p.update(m);
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::CONNECTION));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::CONTROL_TEMP));
    TEST_ASSERT_FALSE(p.text().mqttConnected);
}

void test_output_change_dirties_the_band(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();
    p.update(m);
    p.clearDirty();

    m.output = ControlOutput::COOLING;
    p.update(m);
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::OUTPUT_BAND));
    TEST_ASSERT_EQUAL_STRING("COOLING", p.text().output);
}

void test_mode_change_dirties_the_band(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();
    p.update(m);
    p.clearDirty();

    m.mode = ControlMode::PID;
    p.update(m);
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::OUTPUT_BAND));
    TEST_ASSERT_EQUAL_STRING("mode: pid", p.text().mode);
}

void test_every_output_maps_to_its_label(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();

    m.output = ControlOutput::IDLE;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("IDLE", p.text().output);

    m.output = ControlOutput::HEATING;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("HEATING", p.text().output);

    m.output = ControlOutput::COOLING;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("COOLING", p.text().output);
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, p.text().outputState);
}

void test_every_mode_maps_to_its_label(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();

    m.mode = ControlMode::OFF;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("mode: off", p.text().mode);

    m.mode = ControlMode::THERMOSTAT;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("mode: thermostat", p.text().mode);

    m.mode = ControlMode::PID;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("mode: pid", p.text().mode);
}

void test_mark_all_dirty_forces_a_full_repaint(void) {
    DisplayPresenter p;
    p.update(makeModel());
    p.clearDirty();
    p.markAllDirty();
    for (DisplayField field : kAllDisplayFields) {
        TEST_ASSERT_TRUE(p.isDirty(field));
    }
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
    RUN_TEST(test_first_update_marks_everything_dirty);
    RUN_TEST(test_identical_update_marks_nothing_dirty);
    RUN_TEST(test_sub_decimal_change_does_not_dirty_the_temperature);
    RUN_TEST(test_visible_temperature_change_dirties_only_that_field);
    RUN_TEST(test_mqtt_drop_leaves_the_temperature_alone);
    RUN_TEST(test_mqtt_drop_dirties_the_offline_notice);
    RUN_TEST(test_wifi_drop_alone_does_not_dirty_the_offline_notice);
    RUN_TEST(test_output_change_dirties_the_band);
    RUN_TEST(test_mode_change_dirties_the_band);
    RUN_TEST(test_every_output_maps_to_its_label);
    RUN_TEST(test_every_mode_maps_to_its_label);
    RUN_TEST(test_mark_all_dirty_forces_a_full_repaint);
    return UNITY_END();
}
