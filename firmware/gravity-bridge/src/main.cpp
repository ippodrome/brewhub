#include <Arduino.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>
#include <NimBLEDevice.h>

#include "MqttClientWrapper.h"
#include "OtaUpdater.h"
#include "RaptParser.h"
#include "TiltParser.h"
#include "secrets.h"

using unibrew::GravityReading;
using unibrew::MqttClientWrapper;
using unibrew::OtaUpdater;
using unibrew::RaptParser;
using unibrew::TiltParser;

namespace {

constexpr uint32_t kScanIntervalMs = 30000;
constexpr uint32_t kScanDurationS = 5;
constexpr uint32_t kWatchdogTimeoutS = 30;
constexpr size_t kMaxReadingsPerScan = 8;
// Must match shared-types' FirmwareBoardSchema exactly — used only for the
// MQTT discovery announcement (see MqttClientWrapper::begin).
constexpr const char* BOARD_NAME = "gravity-bridge";

MqttClientWrapper mqttClient;
OtaUpdater otaUpdater;
NimBLEScan* bleScan = nullptr;

uint32_t lastScanMs = 0;

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

void publishGravityReadings(const GravityReading* readings, size_t count) {
    JsonDocument doc;
    doc["deviceId"] = DEVICE_ID;
    doc["ts"] = static_cast<uint64_t>(millis());

    JsonArray readingsArray = doc["readings"].to<JsonArray>();
    for (size_t i = 0; i < count; i++) {
        JsonObject r = readingsArray.add<JsonObject>();
        r["identifier"] = readings[i].identifier;
        r["gravitySg"] = readings[i].gravitySg;
        r["temperatureC"] = readings[i].temperatureC;
        if (readings[i].hasBattery) {
            r["batteryPercent"] = readings[i].batteryPercent;
        }
    }

    char buf[512];
    size_t len = serializeJson(doc, buf, sizeof(buf));
    (void)len;
    mqttClient.publishGravity(buf);
}

void scanForHydrometers() {
    NimBLEScanResults results = bleScan->start(kScanDurationS, false);

    GravityReading readings[kMaxReadingsPerScan];
    size_t readingCount = 0;

    for (int i = 0; i < results.getCount() && readingCount < kMaxReadingsPerScan; i++) {
        NimBLEAdvertisedDevice device = results.getDevice(i);
        if (!device.haveManufacturerData()) continue;

        std::string manufacturerData = device.getManufacturerData(0);
        GravityReading reading;
        if (TiltParser::tryParse(manufacturerData, reading) || RaptParser::tryParse(manufacturerData, reading)) {
            readings[readingCount++] = reading;
        }
    }

    bleScan->clearResults();

    if (readingCount > 0) {
        Serial.printf("[ble] found %u hydrometer reading(s)\n", static_cast<unsigned>(readingCount));
        publishGravityReadings(readings, readingCount);
    }
}

} // namespace

void setup() {
    Serial.begin(115200);
    delay(200);
    Serial.println("\n[boot] UniBrew gravity-bridge firmware starting");

    esp_task_wdt_init(kWatchdogTimeoutS, true);
    esp_task_wdt_add(nullptr);

    connectWiFi();

    mqttClient.begin(MQTT_HOST, MQTT_PORT, MQTT_USERNAME, MQTT_PASSWORD, DEVICE_ID, FIRMWARE_VERSION, BOARD_NAME);
    mqttClient.setOtaCallback(onOtaMessage);

    NimBLEDevice::init("");
    bleScan = NimBLEDevice::getScan();
    // Passive scan: BLE hydrometers broadcast everything needed in the
    // advertisement itself, no scan-response round trip required — lower
    // power on both sides.
    bleScan->setActiveScan(false);
}

void loop() {
    esp_task_wdt_reset();

    if (WiFi.status() != WL_CONNECTED) {
        connectWiFi();
    }
    mqttClient.loop();

    uint32_t now = millis();
    if (now - lastScanMs >= kScanIntervalMs) {
        lastScanMs = now;
        scanForHydrometers();
    }
}
