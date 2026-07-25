#include <Arduino.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>

#include "ControlLoop.h"
#include "SensorManager.h"
#include "SensorAddress.h"
#include "ConfigStore.h"
#include "MqttClientWrapper.h"
#include "FlowMeterManager.h"
#include "OtaUpdater.h"
#include "pins.h"
#include "secrets.h"

using unibrew::ControlConfig;
using unibrew::ControlLoop;
using unibrew::ControlMode;
using unibrew::ControlOutput;
using unibrew::ConfigStore;
using unibrew::FlowMeterManager;
using unibrew::MqttClientWrapper;
using unibrew::OtaUpdater;
using unibrew::SensorManager;
using unibrew::SensorSample;
using unibrew::kSensorAddressHexLength;

namespace {

constexpr uint32_t kTelemetryIntervalMs = 2000;
constexpr uint32_t kStatusIntervalMs = 30000;
constexpr uint32_t kWatchdogTimeoutS = 30;
constexpr float kMinPlausibleC = -50.0f;
constexpr float kMaxPlausibleC = 150.0f;
// Mirrors MAX_SENSOR_OFFSET_C in packages/shared-types — a "calibration"
// larger than this is a broken sensor, not a miscalibrated one, and applying
// it would quietly shift the whole control loop.
constexpr float kMaxPlausibleSensorOffsetC = 10.0f;
// Must match shared-types' FirmwareBoardSchema exactly — used only for the
// MQTT discovery announcement (see MqttClientWrapper::begin).
constexpr const char* BOARD_NAME = "kegerator-kegcop";

ControlLoop controlLoop;
ConfigStore configStore;
MqttClientWrapper mqttClient;
OtaUpdater otaUpdater;

// Keg Cop wires each sensor role to its own separate OneWire bus (see
// pins.h) rather than a shared bus — one SensorManager per pin, each
// expected to discover 0 or 1 sensor. Upper chamber is listed first since
// it's the most sensible default control input for the cooling loop before
// a user explicitly picks one via the Sensors UI.
SensorManager upperChamberSensor;
SensorManager lowerChamberSensor;
SensorManager kegSensor;
SensorManager roomSensor;
SensorManager towerSensor;

struct SensorBus {
    SensorManager* manager;
    uint8_t pin;
};

SensorBus sensorBuses[] = {
    {&upperChamberSensor, UPPER_CHAMBER_SENSE_PIN},
    {&lowerChamberSensor, LOWER_CHAMBER_SENSE_PIN},
    {&kegSensor, KEG_SENSE_PIN},
    {&roomSensor, ROOM_SENSE_PIN},
    {&towerSensor, TOWER_SENSE_PIN},
};
constexpr size_t kSensorBusCount = sizeof(sensorBuses) / sizeof(sensorBuses[0]);

FlowMeterManager flowMeterManager;

uint32_t lastTelemetryMs = 0;
uint32_t lastStatusMs = 0;

// Empty = no control sensor designated yet (or the backend hasn't told us).
// With 5 differently-purposed sensors and no way to know which one the
// backend's "first discovered" default picked, this matters more here than
// on the fermenter board — expect to need a manual "Set as control" via the
// Sensors UI on first setup. See main.cpp's fermenter equivalent for why
// this isn't persisted to NVS (same reasoning applies).
char controlSensorAddressHex[kSensorAddressHexLength + 1] = "";

// Which logic level energizes the cooling relay. Seeded from the board's
// compiled-in default and overridden by pushed config; restored from NVS on
// boot so it survives an outage. See ADR-022 for why this is runtime state
// rather than the constexpr it used to be.
bool coolingRelayActiveLow = RELAY_ACTIVE_LOW;

// Defined below, but needed by onConfigMessage to force the output safe the
// moment polarity changes.
void applyRelayOutput(ControlOutput output);

const char* controlModeToString(ControlMode mode) {
    switch (mode) {
        case ControlMode::OFF: return "off";
        case ControlMode::PID: return "pid";
        default: return "thermostat";
    }
}

ControlMode controlModeFromString(const char* mode) {
    if (mode == nullptr) {
        return ControlMode::THERMOSTAT;
    }
    if (strcmp(mode, "off") == 0) {
        return ControlMode::OFF;
    }
    if (strcmp(mode, "pid") == 0) {
        return ControlMode::PID;
    }
    return ControlMode::THERMOSTAT;
}

void onConfigMessage(const uint8_t* payload, unsigned int length) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, payload, length);
    if (err) {
        Serial.printf("[config] invalid JSON: %s\n", err.c_str());
        return;
    }

    ControlConfig next = controlLoop.config();

    if (doc["setpointC"].is<float>()) {
        float setpointC = doc["setpointC"];
        if (!isnan(setpointC) && setpointC >= kMinPlausibleC && setpointC <= kMaxPlausibleC) {
            next.setpointC = setpointC;
        } else {
            Serial.println("[config] rejected implausible setpointC");
        }
    }
    if (doc["hysteresisC"].is<float>()) {
        float hysteresisC = doc["hysteresisC"];
        if (hysteresisC > 0.0f) {
            next.hysteresisC = hysteresisC;
        } else {
            Serial.println("[config] rejected non-positive hysteresisC");
        }
    }
    if (doc["mode"].is<const char*>()) {
        next.mode = controlModeFromString(doc["mode"]);
    }
    if (doc["minOnTimeMs"].is<uint32_t>()) {
        next.minOnTimeMs = doc["minOnTimeMs"];
    }
    if (doc["minOffTimeMs"].is<uint32_t>()) {
        next.minOffTimeMs = doc["minOffTimeMs"];
    }
    if (doc["pidGains"].is<JsonObject>()) {
        JsonObject gains = doc["pidGains"];
        if (gains["kp"].is<float>()) next.pidGains.kp = gains["kp"];
        if (gains["ki"].is<float>()) next.pidGains.ki = gains["ki"];
        if (gains["kd"].is<float>()) next.pidGains.kd = gains["kd"];
    }
    if (doc["pidWindowMs"].is<uint32_t>()) {
        uint32_t pidWindowMs = doc["pidWindowMs"];
        if (pidWindowMs > 0) {
            next.pidWindowMs = pidWindowMs;
        } else {
            Serial.println("[config] rejected non-positive pidWindowMs");
        }
    }
    if (doc["controlSensorAddress"].is<const char*>()) {
        const char* address = doc["controlSensorAddress"];
        strncpy(controlSensorAddressHex, address, sizeof(controlSensorAddressHex) - 1);
        controlSensorAddressHex[sizeof(controlSensorAddressHex) - 1] = '\0';
    } else if (doc["controlSensorAddress"].isNull()) {
        controlSensorAddressHex[0] = '\0';
    }
    if (doc["controlSensorOffsetC"].is<float>()) {
        float offsetC = doc["controlSensorOffsetC"];
        if (!isnan(offsetC) && fabsf(offsetC) <= kMaxPlausibleSensorOffsetC) {
            next.controlSensorOffsetC = offsetC;
        } else {
            Serial.println("[config] rejected implausible controlSensorOffsetC");
        }
    }

    // No heating on a kegerator — never let a misconfigured backend push
    // heatingEnabled=true here regardless of what was sent.
    next.heatingEnabled = false;

    controlLoop.setConfig(next);
    configStore.save(next);

    // Relay polarity is handled after the control config, and deliberately
    // not through ControlConfig: flipping it changes what every output
    // physically means, so it is a safety event rather than a setting.
    // Null (or absent) means "keep using the board's compiled-in default".
    if (doc["coolingRelayActiveLow"].is<bool>()) {
        bool requested = doc["coolingRelayActiveLow"];
        if (requested != coolingRelayActiveLow) {
            coolingRelayActiveLow = requested;
            configStore.saveCoolingRelayActiveLow(requested);

            // Under the previous (wrong) polarity the compressor may have
            // been running while the loop believed it was idle. Force IDLE
            // and arm min-off before writing the pin, so the corrected
            // output starts from a known-off state and cannot be
            // re-energized until the compressor has had time to equalize.
            controlLoop.forceIdleAndArmMinOff(millis());
            applyRelayOutput(ControlOutput::IDLE);
            Serial.printf("[config] cooling relay polarity changed to active-%s; forced idle\n",
                          requested ? "low" : "high");
        }
    }

    Serial.printf(
        "[config] applied: setpoint=%.2f hysteresis=%.2f mode=%s minOn=%lu minOff=%lu "
        "controlSensor=%s offset=%.2f\n",
        next.setpointC, next.hysteresisC, controlModeToString(next.mode),
        static_cast<unsigned long>(next.minOnTimeMs),
        static_cast<unsigned long>(next.minOffTimeMs),
        controlSensorAddressHex[0] != '\0' ? controlSensorAddressHex : "(none, using first sensor)",
        next.controlSensorOffsetC);
}

// Blocking (see OtaUpdater doc comment) — the watchdog can't be fed from
// loop() during this call, so it's suspended around it and only re-armed if
// the update failed (success reboots before returning at all).
void onOtaMessage(const uint8_t* payload, unsigned int length) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, payload, length);
    if (err) {
        Serial.printf("[ota] invalid JSON: %s\n", err.c_str());
        return;
    }
    if (!doc["url"].is<const char*>() || !doc["md5"].is<const char*>()) {
        Serial.println("[ota] message missing url/md5");
        return;
    }

    const char* url = doc["url"];
    const char* md5 = doc["md5"];
    Serial.printf("[ota] update requested: version=%s url=%s\n",
                  doc["version"].is<const char*>() ? doc["version"].as<const char*>() : "?", url);

    esp_task_wdt_delete(nullptr);
    otaUpdater.begin(url, md5);
    esp_task_wdt_add(nullptr); // only reached on failure
}

float selectControlTemperature(const SensorSample* samples, size_t count) {
    if (count == 0) {
        return NAN;
    }
    if (controlSensorAddressHex[0] != '\0') {
        for (size_t i = 0; i < count; i++) {
            if (unibrew::sensorAddressMatches(samples[i].address, controlSensorAddressHex)) {
                return samples[i].temperatureC;
            }
        }
    }
    return samples[0].temperatureC;
}

// Only cooling exists on a kegerator — no heating relay to drive.
void applyRelayOutput(ControlOutput output) {
    bool coolingOn = (output == ControlOutput::COOLING);
    digitalWrite(COOLING_RELAY_PIN, coolingOn == coolingRelayActiveLow ? LOW : HIGH);
}

void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) {
        return;
    }
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    Serial.print("[wifi] connecting");
    uint32_t startMs = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startMs < 15000) {
        delay(250);
        Serial.print(".");
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("[wifi] connected, IP=%s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("[wifi] not connected yet, will keep retrying in loop()");
    }
}

void publishTelemetry(const SensorSample* samples, size_t sensorCount) {
    JsonDocument doc;
    doc["deviceId"] = DEVICE_ID;
    doc["ts"] = static_cast<uint64_t>(millis());

    JsonArray sensorsArray = doc["sensors"].to<JsonArray>();
    for (size_t i = 0; i < sensorCount; i++) {
        JsonObject s = sensorsArray.add<JsonObject>();
        char hex[kSensorAddressHexLength + 1];
        unibrew::formatSensorAddress(samples[i].address, hex, sizeof(hex));
        s["address"] = hex;
        if (isnan(samples[i].temperatureC)) {
            s["temperatureC"] = nullptr;
        } else {
            s["temperatureC"] = samples[i].temperatureC;
        }
    }

    JsonArray flowsArray = doc["flows"].to<JsonArray>();
    for (size_t i = 0; i < flowMeterManager.count(); i++) {
        JsonObject f = flowsArray.add<JsonObject>();
        f["index"] = static_cast<unsigned>(i);
        f["pulseCount"] = flowMeterManager.pulseCount(i);
    }

    char buf[768];
    size_t len = serializeJson(doc, buf, sizeof(buf));
    (void)len;
    mqttClient.publishTelemetry(buf);
}

void publishStatus() {
    JsonDocument doc;
    doc["deviceId"] = DEVICE_ID;
    doc["online"] = true;
    doc["firmwareVersion"] = FIRMWARE_VERSION;
    doc["uptimeS"] = millis() / 1000;
    doc["ts"] = static_cast<uint64_t>(millis());

    char buf[192];
    size_t len = serializeJson(doc, buf, sizeof(buf));
    (void)len;
    mqttClient.publishStatus(buf);
}

} // namespace

void setup() {
    Serial.begin(115200);
    delay(200);
    Serial.println("\n[boot] UniBrew kegerator firmware starting");

    esp_task_wdt_init(kWatchdogTimeoutS, true);
    esp_task_wdt_add(nullptr);

    pinMode(COOLING_RELAY_PIN, OUTPUT);

    // NVS is opened, and the persisted relay polarity restored, BEFORE the
    // first output write — otherwise that write would use the compiled-in
    // default and could briefly energize the compressor on every boot of a
    // device whose polarity has been corrected.
    configStore.begin();
    coolingRelayActiveLow = configStore.loadCoolingRelayActiveLow(RELAY_ACTIVE_LOW);
    applyRelayOutput(ControlOutput::IDLE); // safe default before any control decision has run

    ControlConfig config = configStore.load();
    config.heatingEnabled = false; // no heating hardware on a kegerator, regardless of stored config
    controlLoop.setConfig(config);

    size_t totalDiscovered = 0;
    for (size_t i = 0; i < kSensorBusCount; i++) {
        sensorBuses[i].manager->begin(sensorBuses[i].pin);
        totalDiscovered += sensorBuses[i].manager->discover();
    }
    Serial.printf("[sensors] discovered %u of %u possible sensor(s)\n",
                  static_cast<unsigned>(totalDiscovered), static_cast<unsigned>(kSensorBusCount));

    flowMeterManager.begin(FLOW_PINS, kFlowPinCount);

    connectWiFi();

    mqttClient.begin(MQTT_HOST, MQTT_PORT, MQTT_USERNAME, MQTT_PASSWORD, DEVICE_ID, FIRMWARE_VERSION, BOARD_NAME);
    mqttClient.setConfigCallback(onConfigMessage);
    mqttClient.setOtaCallback(onOtaMessage);
}

void loop() {
    esp_task_wdt_reset();

    if (WiFi.status() != WL_CONNECTED) {
        connectWiFi();
    }
    mqttClient.loop();

    uint32_t now = millis();

    if (now - lastTelemetryMs >= kTelemetryIntervalMs) {
        lastTelemetryMs = now;

        SensorSample samples[kSensorBusCount];
        size_t count = 0;
        for (size_t i = 0; i < kSensorBusCount; i++) {
            SensorSample sample;
            if (sensorBuses[i].manager->readAll(&sample, 1) == 1) {
                samples[count++] = sample;
            }
        }

        float controlTemperatureC = selectControlTemperature(samples, count);
        ControlOutput output = controlLoop.update(controlTemperatureC, now);
        applyRelayOutput(output);
        publishTelemetry(samples, count);
    }

    if (now - lastStatusMs >= kStatusIntervalMs) {
        lastStatusMs = now;
        publishStatus();
    }
}
