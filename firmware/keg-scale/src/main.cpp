#include <Arduino.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <esp_task_wdt.h>

#include "LoadCellManager.h"
#include "MqttClientWrapper.h"
#include "OtaUpdater.h"
#include "pins.h"
#include "secrets.h"

using unibrew::LoadCellManager;
using unibrew::MqttClientWrapper;
using unibrew::OtaUpdater;

namespace {

constexpr uint32_t kTelemetryIntervalMs = 5000;
constexpr uint32_t kStatusIntervalMs = 30000;
constexpr uint32_t kWatchdogTimeoutS = 30;
constexpr uint8_t kWeightChannelIndex = 0; // one HX711/load cell per device in v1.
// Must match shared-types' FirmwareBoardSchema exactly — used only for the
// MQTT discovery announcement (see MqttClientWrapper::begin).
constexpr const char* BOARD_NAME = "keg-scale";

LoadCellManager loadCell;
MqttClientWrapper mqttClient;
OtaUpdater otaUpdater;
Preferences scaleConfigPrefs;

uint32_t lastTelemetryMs = 0;
uint32_t lastStatusMs = 0;

// tareRequestId is a declarative config field (see DeviceConfigSchema in
// shared-types, ADR-004): the backend bumps it to a new value to request a
// physical tare, rather than sending a one-shot "tare now" command. That
// means the retained config message still carries the SAME id on every
// reconnect/redelivery after it's been applied once — without tracking
// "have I already applied this one", every reboot or MQTT reconnect would
// re-tare the scale, which is wrong (and actively harmful) if a keg is
// sitting on the platform at the time. Persisted so a reboot doesn't lose
// this and spuriously re-tare either.
constexpr const char* kScaleConfigNamespace = "unibrew-scalecfg";
constexpr const char* kLastTareIdKey = "lastTareId";
constexpr int64_t kNoTareApplied = INT64_MIN;

int64_t lastAppliedTareRequestId = kNoTareApplied;

// Unlike tareRequestId, applying the same calibration factor twice is
// harmless — set_scale() is a pure assignment, not a stateful action against
// whatever happens to be sitting on the platform right now. This is only
// tracked to skip redundant NVS writes on every MQTT redelivery/reconnect,
// not for correctness.
constexpr float kNoCalibrationApplied = NAN;
float lastAppliedCalibrationFactor = kNoCalibrationApplied;

void onConfigMessage(const uint8_t* payload, unsigned int length) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, payload, length);
    if (err) {
        Serial.printf("[config] invalid JSON: %s\n", err.c_str());
        return;
    }

    if (doc["loadCellCalibrationFactor"].is<float>()) {
        float factor = doc["loadCellCalibrationFactor"];
        if (isnan(lastAppliedCalibrationFactor) || factor != lastAppliedCalibrationFactor) {
            Serial.printf("[config] new loadCellCalibrationFactor %.3f\n", factor);
            loadCell.setCalibrationFactor(factor);
            lastAppliedCalibrationFactor = factor;
        }
    }

    if (!doc["tareRequestId"].is<int64_t>()) {
        return; // absent or null -> no tare requested.
    }

    int64_t tareRequestId = doc["tareRequestId"];
    if (tareRequestId == lastAppliedTareRequestId) {
        return; // already applied — this is a redelivery, not a new request.
    }

    Serial.printf("[config] new tareRequestId %lld, taring scale\n",
                  static_cast<long long>(tareRequestId));
    loadCell.tare();

    lastAppliedTareRequestId = tareRequestId;
    scaleConfigPrefs.putLong64(kLastTareIdKey, tareRequestId);
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

void publishTelemetry(float grams) {
    JsonDocument doc;
    doc["deviceId"] = DEVICE_ID;
    doc["ts"] = static_cast<uint64_t>(millis());

    // No temperature sensors on a keg_scale device.
    doc["sensors"].to<JsonArray>();

    JsonArray weightsArray = doc["weights"].to<JsonArray>();
    JsonObject w = weightsArray.add<JsonObject>();
    w["index"] = kWeightChannelIndex;
    if (isnan(grams)) {
        w["grams"] = nullptr;
    } else {
        w["grams"] = grams;
    }

    char buf[256];
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
    Serial.println("\n[boot] UniBrew keg-scale firmware starting");

    esp_task_wdt_init(kWatchdogTimeoutS, true);
    esp_task_wdt_add(nullptr);

    scaleConfigPrefs.begin(kScaleConfigNamespace, false);
    if (scaleConfigPrefs.isKey(kLastTareIdKey)) {
        lastAppliedTareRequestId = scaleConfigPrefs.getLong64(kLastTareIdKey, kNoTareApplied);
    }

    // Deliberately NOT tared here — see LoadCellManager doc comment. begin()
    // restores whatever offset was last persisted by an explicit tare, so
    // absolute weight tracking survives a reboot with a keg already on the
    // platform.
    loadCell.begin(LOADCELL_DOUT_PIN, LOADCELL_SCK_PIN, LOADCELL_CALIBRATION_FACTOR);

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
        float grams = loadCell.readGrams();
        publishTelemetry(grams);
    }

    if (now - lastStatusMs >= kStatusIntervalMs) {
        lastStatusMs = now;
        publishStatus();
    }
}
