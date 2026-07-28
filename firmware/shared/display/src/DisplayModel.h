#pragma once
#include <cmath>
#include <cstddef>
#include <cstdint>

#include "ControlLoop.h"
#include "SensorAddress.h"

namespace unibrew {

// Matches kMaxSensors in hal-temp's SensorManager.h. Deliberately redeclared
// rather than included: that header pulls in OneWire.h/DallasTemperature.h,
// which would make this library unbuildable under the native test
// environment. main.cpp converts SensorSample -> DisplaySensor at the
// boundary.
constexpr size_t kDisplayMaxSensors = 8;

struct DisplaySensor {
    char addressHex[kSensorAddressHexLength + 1];
    float temperatureC;
};

// There is deliberately no separate boot screen. setup() brings the status
// layout up immediately, before the blocking WiFi attempt, so the 15 seconds
// that would otherwise show a splash instead show the real screen with its
// connection indicators red and the temperature reading "--.-" — strictly
// more information than a splash, and one less state to maintain.
enum class DisplayScreen : uint8_t { STATUS, OTA };

struct DisplayModel {
    DisplayScreen screen = DisplayScreen::STATUS;

    const char* deviceId = "";

    float controlTemperatureC = NAN;
    float setpointC = 0.0f;
    ControlMode mode = ControlMode::THERMOSTAT;
    ControlOutput output = ControlOutput::IDLE;

    bool wifiConnected = false;
    bool mqttConnected = false;

    // Empty means "no sensor designated" — the control loop falls back to
    // the first discovered sensor, and the presenter mirrors that fallback
    // when deciding which sensor to omit from the secondary row.
    char controlSensorAddressHex[kSensorAddressHexLength + 1] = "";

    DisplaySensor sensors[kDisplayMaxSensors];
    size_t sensorCount = 0;
};

} // namespace unibrew
