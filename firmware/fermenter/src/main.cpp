#include <Arduino.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>

#include "ControlLoop.h"
#include "SensorManager.h"
#include "SensorAddress.h"
#include "ConfigStore.h"
#include "MqttClientWrapper.h"
#include "OtaUpdater.h"
#include "DisplayModel.h"
#include "DisplayPresenter.h"
#include "TftDisplay.h"
#include "pins.h"
#include "secrets.h"

using unibrew::ControlConfig;
using unibrew::ControlLoop;
using unibrew::ControlMode;
using unibrew::ControlOutput;
using unibrew::ConfigStore;
using unibrew::MqttClientWrapper;
using unibrew::OtaUpdater;
using unibrew::SensorManager;
using unibrew::SensorSample;
using unibrew::kSensorAddressHexLength;
using unibrew::DisplayModel;
using unibrew::DisplayPresenter;
using unibrew::DisplayScreen;
using unibrew::TftDisplay;

namespace {

constexpr uint32_t kTelemetryIntervalMs = 2000;
constexpr uint32_t kStatusIntervalMs = 30000;
// The screen ticks faster than telemetry so WiFi/MQTT indicators react
// promptly, but temperatures only change on the telemetry pass — the
// OneWire bus is not read any more often than before.
constexpr uint32_t kDisplayIntervalMs = 1000;
constexpr uint32_t kWatchdogTimeoutS = 30;
constexpr float kMinPlausibleC = -50.0f;
constexpr float kMaxPlausibleC = 150.0f;
// Mirrors MAX_SENSOR_OFFSET_C in packages/shared-types — a "calibration"
// larger than this is a broken sensor, not a miscalibrated one, and applying
// it would quietly shift the whole control loop.
constexpr float kMaxPlausibleSensorOffsetC = 10.0f;
// Must match shared-types' FirmwareBoardSchema exactly — used only for the
// MQTT discovery announcement (see MqttClientWrapper::begin).
constexpr const char* BOARD_NAME = "fermenter-brewpi";

ControlLoop controlLoop;
SensorManager sensorManager;
ConfigStore configStore;
MqttClientWrapper mqttClient;
OtaUpdater otaUpdater;
DisplayModel displayModel;
DisplayPresenter displayPresenter;
TftDisplay display;

uint32_t lastTelemetryMs = 0;
uint32_t lastStatusMs = 0;
uint32_t lastDisplayMs = 0;

// Empty = no control sensor designated yet (or the backend hasn't told us) —
// selectControlTemperature() falls back to the first discovered sensor.
// Deliberately NOT persisted to NVS: it's re-delivered on every MQTT
// reconnect via the retained config message, and for the common single
// -sensor case the fallback is already correct, so the only gap is a brief
// fallback-to-first-sensor window on a multi-sensor device rebooting while
// MQTT is simultaneously unreachable — never a loss of control entirely.
char controlSensorAddressHex[kSensorAddressHexLength + 1] = "";

// Which logic level energizes each relay. Seeded from the board's compiled-in
// default and overridden by pushed config; restored from NVS on boot so it
// survives an outage. Tracked separately per output because a fermenter
// commonly drives an SSR for heat and a mechanical relay for the compressor,
// which need not share a polarity. See ADR-022.
bool coolingRelayActiveLow = RELAY_ACTIVE_LOW;
bool heatingRelayActiveLow = RELAY_ACTIVE_LOW;

// Defined below, but needed by onConfigMessage to force the outputs safe the
// moment a polarity changes.
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

    controlLoop.setConfig(next);
    configStore.save(next);

    // Relay polarity is handled after the control config, and deliberately
    // not through ControlConfig: flipping it changes what the outputs
    // physically mean, so it is a safety event rather than a setting. Null
    // (or absent) means "keep using the board's compiled-in default".
    bool polarityChanged = false;
    if (doc["coolingRelayActiveLow"].is<bool>()) {
        bool requested = doc["coolingRelayActiveLow"];
        if (requested != coolingRelayActiveLow) {
            coolingRelayActiveLow = requested;
            configStore.saveCoolingRelayActiveLow(requested);
            polarityChanged = true;
            Serial.printf("[config] cooling relay polarity changed to active-%s\n", requested ? "low" : "high");
        }
    }
    if (doc["heatingRelayActiveLow"].is<bool>()) {
        bool requested = doc["heatingRelayActiveLow"];
        if (requested != heatingRelayActiveLow) {
            heatingRelayActiveLow = requested;
            configStore.saveHeatingRelayActiveLow(requested);
            polarityChanged = true;
            Serial.printf("[config] heating relay polarity changed to active-%s\n", requested ? "low" : "high");
        }
    }
    if (polarityChanged) {
        // Under the previous (wrong) polarity an actuator may have been
        // running while the loop believed it was idle. Force IDLE and arm
        // min-off before writing the pins, so the corrected outputs start
        // from a known-off state and cannot be re-energized until the
        // compressor has had time to equalize.
        controlLoop.forceIdleAndArmMinOff(millis());
        applyRelayOutput(ControlOutput::IDLE);
        Serial.println("[config] forced idle after relay polarity change");
    }

    Serial.printf(
        "[config] applied: setpoint=%.2f hysteresis=%.2f mode=%s minOn=%lu minOff=%lu "
        "pid(kp=%.2f ki=%.2f kd=%.2f window=%lu) controlSensor=%s offset=%.2f\n",
        next.setpointC, next.hysteresisC, controlModeToString(next.mode),
        static_cast<unsigned long>(next.minOnTimeMs),
        static_cast<unsigned long>(next.minOffTimeMs),
        next.pidGains.kp, next.pidGains.ki, next.pidGains.kd,
        static_cast<unsigned long>(next.pidWindowMs),
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

    // Drawn before begin(), which blocks with the watchdog disabled and
    // reboots on success — nothing after it runs.
    displayModel.screen = DisplayScreen::OTA;
    display.showOta();

    esp_task_wdt_delete(nullptr);
    otaUpdater.begin(url, md5);
    esp_task_wdt_add(nullptr); // only reached on failure

    // begin() only reaches ESP.restart() on success; every failure path
    // (bad URL, GET failure, missing content-length, Update.begin failure,
    // MD5/write mismatch) returns normally instead. Without handing the
    // screen back here it would stay frozen on "Updating firmware" for the
    // rest of the device's uptime while the control loop keeps running
    // underneath — the exact "looks dead but isn't" failure mode the
    // display exists to prevent (ADR-025). No markAllDirty() call is
    // needed: showOta() cleared chromeDrawn_, so the next STATUS render
    // redraws the chrome and force-dirties every field.
    displayModel.screen = DisplayScreen::STATUS;
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
        // Designated address isn't among currently discovered sensors (e.g.
        // physically unplugged) — fall back rather than control on nothing.
    }
    return samples[0].temperatureC;
}

// Drives the two relay outputs from ControlLoop's decision. Safe by
// construction: ControlOutput is a single enum value, so HEATING and
// COOLING can never both be requested at once — this function still writes
// both pins explicitly every call (not just the changed one) so a missed
// update can never leave a relay stuck from a prior state.
void applyRelayOutput(ControlOutput output) {
    bool heatingOn = (output == ControlOutput::HEATING);
    bool coolingOn = (output == ControlOutput::COOLING);

    digitalWrite(HEATING_RELAY_PIN, heatingOn == heatingRelayActiveLow ? LOW : HIGH);
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

// Copies the freshly read samples into the display model, converting each
// raw address to hex at this boundary. The display library deliberately
// does not include SensorManager.h — that header pulls in OneWire and
// DallasTemperature, which would make it unbuildable natively.
void refreshDisplaySensors(const SensorSample* samples, size_t count, float controlTemperatureC) {
    size_t limit = count < unibrew::kDisplayMaxSensors ? count : unibrew::kDisplayMaxSensors;
    for (size_t i = 0; i < limit; i++) {
        unibrew::formatSensorAddress(samples[i].address,
                                     displayModel.sensors[i].addressHex,
                                     sizeof(displayModel.sensors[i].addressHex));
        displayModel.sensors[i].temperatureC = samples[i].temperatureC;
    }
    displayModel.sensorCount = limit;
    displayModel.controlTemperatureC = controlTemperatureC;
}

// Fields that can change without a sensor read: connection state and
// anything the backend may have pushed since the last tick.
void refreshDisplayState() {
    const ControlConfig& config = controlLoop.config();
    displayModel.setpointC = config.setpointC;
    displayModel.mode = config.mode;
    displayModel.output = controlLoop.currentOutput();
    displayModel.wifiConnected = (WiFi.status() == WL_CONNECTED);
    displayModel.mqttConnected = mqttClient.connected();
    strncpy(displayModel.controlSensorAddressHex,
            controlSensorAddressHex,
            sizeof(displayModel.controlSensorAddressHex) - 1);
    displayModel.controlSensorAddressHex[sizeof(displayModel.controlSensorAddressHex) - 1] = '\0';
}

void publishTelemetry(const SensorSample* samples, size_t count) {
    JsonDocument doc;
    doc["deviceId"] = DEVICE_ID;
    doc["ts"] = static_cast<uint64_t>(millis());

    JsonArray sensorsArray = doc["sensors"].to<JsonArray>();
    for (size_t i = 0; i < count; i++) {
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

    char buf[512];
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
    Serial.println("\n[boot] UniBrew fermenter firmware starting");

    display.begin();
    displayModel.screen = DisplayScreen::STATUS;
    displayModel.deviceId = DEVICE_ID;
    refreshDisplayState();
    displayPresenter.update(displayModel);
    display.render(displayPresenter);

    esp_task_wdt_init(kWatchdogTimeoutS, true);
    esp_task_wdt_add(nullptr);

    pinMode(HEATING_RELAY_PIN, OUTPUT);
    pinMode(COOLING_RELAY_PIN, OUTPUT);

    // NVS is opened, and the persisted relay polarities restored, BEFORE the
    // first output write — otherwise that write would use the compiled-in
    // defaults and could briefly energize an actuator on every boot of a
    // device whose polarity has been corrected.
    configStore.begin();
    coolingRelayActiveLow = configStore.loadCoolingRelayActiveLow(RELAY_ACTIVE_LOW);
    heatingRelayActiveLow = configStore.loadHeatingRelayActiveLow(RELAY_ACTIVE_LOW);
    applyRelayOutput(ControlOutput::IDLE); // safe default before any control decision has run

    controlLoop.setConfig(configStore.load());

    sensorManager.begin(ONE_WIRE_PIN);
    size_t sensorsFound = sensorManager.discover();
    Serial.printf("[sensors] discovered %u sensor(s) on the bus\n", static_cast<unsigned>(sensorsFound));

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
        SensorSample samples[unibrew::kMaxSensors];
        size_t count = sensorManager.readAll(samples, unibrew::kMaxSensors);
        float controlTemperatureC = selectControlTemperature(samples, count);
        ControlOutput output = controlLoop.update(controlTemperatureC, now);
        applyRelayOutput(output);
        refreshDisplaySensors(samples, count, controlTemperatureC);
        publishTelemetry(samples, count);
    }

    if (now - lastStatusMs >= kStatusIntervalMs) {
        lastStatusMs = now;
        publishStatus();
    }

    if (now - lastDisplayMs >= kDisplayIntervalMs) {
        lastDisplayMs = now;
        if (displayModel.screen == DisplayScreen::STATUS) {
            refreshDisplayState();
            displayPresenter.update(displayModel);
            display.render(displayPresenter);
        }
    }
}
