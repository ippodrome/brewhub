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

static void addSensor(DisplayModel& m, const char* hex, float tempC) {
    std::strcpy(m.sensors[m.sensorCount].addressHex, hex);
    m.sensors[m.sensorCount].temperatureC = tempC;
    m.sensorCount++;
}

void test_sensor_row_is_empty_with_no_sensors(void) {
    DisplayPresenter p;
    p.update(makeModel());
    TEST_ASSERT_EQUAL_STRING("", p.text().sensors);
}

void test_sensor_row_omits_the_designated_control_sensor(void) {
    DisplayModel m = makeModel();
    addSensor(m, "28FF641F0417033A", 18.4f);
    addSensor(m, "28AA112233445566", 21.7f);
    std::strcpy(m.controlSensorAddressHex, "28FF641F0417033A");

    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("5566 21.7", p.text().sensors);
}

void test_sensor_row_uses_the_last_four_hex_characters(void) {
    DisplayModel m = makeModel();
    addSensor(m, "28FF641F0417033A", 18.4f);
    addSensor(m, "28AA1122334455AB", 21.7f);
    std::strcpy(m.controlSensorAddressHex, "28FF641F0417033A");

    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("55AB 21.7", p.text().sensors);
}

void test_sensor_row_falls_back_to_omitting_the_first_sensor(void) {
    // No control sensor designated — ControlLoop controls on samples[0], so
    // the row must omit that one to match.
    DisplayModel m = makeModel();
    addSensor(m, "28FF641F0417033A", 18.4f);
    addSensor(m, "28AA112233445566", 21.7f);

    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("5566 21.7", p.text().sensors);
}

void test_sensor_row_omits_first_sensor_when_designated_address_is_unknown(void) {
    // Designated address matches nothing discovered, so ControlLoop falls
    // back to samples[0] — the row must omit index 0 or the big readout and
    // the bottom row show the same temperature.
    DisplayModel m = makeModel();
    addSensor(m, "28FF641F0417033A", 18.4f);
    addSensor(m, "28AA112233445566", 21.7f);
    std::strcpy(m.controlSensorAddressHex, "28CC000000000000");

    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("5566 21.7", p.text().sensors);
}

void test_sensor_row_joins_multiple_sensors(void) {
    DisplayModel m = makeModel();
    addSensor(m, "28FF641F0417033A", 18.4f);
    addSensor(m, "28AA112233445566", 21.7f);
    addSensor(m, "28BB112233447788", 19.0f);
    std::strcpy(m.controlSensorAddressHex, "28FF641F0417033A");

    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("5566 21.7  7788 19.0", p.text().sensors);
}

void test_sensor_row_renders_a_faulted_sensor_as_placeholder(void) {
    DisplayModel m = makeModel();
    addSensor(m, "28FF641F0417033A", 18.4f);
    addSensor(m, "28AA112233445566", NAN);
    std::strcpy(m.controlSensorAddressHex, "28FF641F0417033A");

    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("5566 --.-", p.text().sensors);
}

void test_sensor_row_caps_at_three_entries(void) {
    DisplayModel m = makeModel();
    addSensor(m, "28FF641F0417033A", 18.4f);
    addSensor(m, "28AA000000001111", 1.0f);
    addSensor(m, "28AA000000002222", 2.0f);
    addSensor(m, "28AA000000003333", 3.0f);
    addSensor(m, "28AA000000004444", 4.0f);
    std::strcpy(m.controlSensorAddressHex, "28FF641F0417033A");

    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("1111 1.0  2222 2.0  3333 3.0", p.text().sensors);
}

void test_sensor_row_change_dirties_only_the_sensor_field(void) {
    DisplayModel m = makeModel();
    addSensor(m, "28FF641F0417033A", 18.4f);
    addSensor(m, "28AA112233445566", 21.7f);
    std::strcpy(m.controlSensorAddressHex, "28FF641F0417033A");

    DisplayPresenter p;
    p.update(m);
    p.clearDirty();

    m.sensors[1].temperatureC = 22.3f;
    p.update(m);
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::SENSORS));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::CONTROL_TEMP));
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
    RUN_TEST(test_sensor_row_is_empty_with_no_sensors);
    RUN_TEST(test_sensor_row_omits_the_designated_control_sensor);
    RUN_TEST(test_sensor_row_uses_the_last_four_hex_characters);
    RUN_TEST(test_sensor_row_falls_back_to_omitting_the_first_sensor);
    RUN_TEST(test_sensor_row_omits_first_sensor_when_designated_address_is_unknown);
    RUN_TEST(test_sensor_row_joins_multiple_sensors);
    RUN_TEST(test_sensor_row_renders_a_faulted_sensor_as_placeholder);
    RUN_TEST(test_sensor_row_caps_at_three_entries);
    RUN_TEST(test_sensor_row_change_dirties_only_the_sensor_field);
    return UNITY_END();
}
