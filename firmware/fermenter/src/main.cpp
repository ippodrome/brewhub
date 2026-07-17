#include <Arduino.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>

#include "ControlLoop.h"
#include "SensorManager.h"
#include "ConfigStore.h"
#include "MqttClientWrapper.h"
#include "pins.h"
#include "secrets.h"

using unibrew::ControlConfig;
using unibrew::ControlLoop;
using unibrew::ControlMode;
using unibrew::ControlOutput;
using unibrew::ConfigStore;
using unibrew::MqttClientWrapper;
using unibrew::SensorManager;

namespace {

constexpr uint32_t kTelemetryIntervalMs = 2000;
constexpr uint32_t kStatusIntervalMs = 30000;
constexpr uint32_t kWatchdogTimeoutS = 30;
constexpr float kMinPlausibleC = -50.0f;
constexpr float kMaxPlausibleC = 150.0f;

ControlLoop controlLoop;
SensorManager sensorManager;
ConfigStore configStore;
MqttClientWrapper mqttClient;

uint32_t lastTelemetryMs = 0;
uint32_t lastStatusMs = 0;

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

    controlLoop.setConfig(next);
    configStore.save(next);

    Serial.printf(
        "[config] applied: setpoint=%.2f hysteresis=%.2f mode=%s minOn=%lu minOff=%lu "
        "pid(kp=%.2f ki=%.2f kd=%.2f window=%lu)\n",
        next.setpointC, next.hysteresisC, controlModeToString(next.mode),
        static_cast<unsigned long>(next.minOnTimeMs),
        static_cast<unsigned long>(next.minOffTimeMs),
        next.pidGains.kp, next.pidGains.ki, next.pidGains.kd,
        static_cast<unsigned long>(next.pidWindowMs));
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

void publishTelemetry(float temperatureC) {
    JsonDocument doc;
    doc["deviceId"] = DEVICE_ID;
    doc["ts"] = static_cast<uint64_t>(millis());
    if (isnan(temperatureC)) {
        doc["temperatureC"] = nullptr;
    } else {
        doc["temperatureC"] = temperatureC;
    }

    char buf[192];
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

    esp_task_wdt_init(kWatchdogTimeoutS, true);
    esp_task_wdt_add(nullptr);

    configStore.begin();
    controlLoop.setConfig(configStore.load());

    sensorManager.begin(ONE_WIRE_PIN);

    connectWiFi();

    mqttClient.begin(MQTT_HOST, MQTT_PORT, MQTT_USERNAME, MQTT_PASSWORD, DEVICE_ID, FIRMWARE_VERSION);
    mqttClient.setConfigCallback(onConfigMessage);
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
        float temperatureC = sensorManager.readTemperatureC();
        controlLoop.update(temperatureC, now);
        publishTelemetry(temperatureC);
    }

    if (now - lastStatusMs >= kStatusIntervalMs) {
        lastStatusMs = now;
        publishStatus();
    }
}
