#include "OtaUpdater.h"
#include "OtaUrlPolicy.h"
#include <Arduino.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Update.h>
#include <esp_task_wdt.h>

namespace unibrew {

namespace {

void restoreWatchdog(uint32_t timeoutS) {
    esp_task_wdt_init(timeoutS, true);
    esp_task_wdt_reset();
}

} // namespace

void OtaUpdater::begin(const char* url, const char* expectedMd5, const OtaOptions& options) {
    if (!isOtaUrlAllowed(url, options.allowedUrlPrefix)) {
        Serial.printf("[ota] REJECTED url (allowed prefix: %s)\n",
                      options.allowedUrlPrefix != nullptr ? options.allowedUrlPrefix : "<none>");
        return;
    }

    // Longer watchdog for the download, fed per chunk below — never removed.
    esp_task_wdt_init(kOtaWatchdogTimeoutS, true);
    esp_task_wdt_reset();

    WiFiClientSecure client;
    if (options.caCertPem != nullptr && options.caCertPem[0] != '\0') {
        client.setCACert(options.caCertPem);
    } else {
        Serial.println("[ota] WARNING: no OTA_CA_CERT configured, server certificate NOT verified");
        client.setInsecure();
    }
    client.setHandshakeTimeout(kHttpConnectTimeoutMs / 1000);

    HTTPClient http;
    http.setConnectTimeout(kHttpConnectTimeoutMs);
    http.setTimeout(kHttpReadTimeoutMs);
    if (!http.begin(client, url)) {
        Serial.println("[ota] http.begin failed (bad URL?)");
        restoreWatchdog(options.normalWatchdogTimeoutS);
        return;
    }

    int httpCode = http.GET();
    esp_task_wdt_reset();
    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[ota] GET failed, HTTP code %d\n", httpCode);
        http.end();
        restoreWatchdog(options.normalWatchdogTimeoutS);
        return;
    }

    int contentLength = http.getSize();
    if (contentLength <= 0) {
        Serial.println("[ota] invalid/missing Content-Length");
        http.end();
        restoreWatchdog(options.normalWatchdogTimeoutS);
        return;
    }

    if (!Update.begin(contentLength)) {
        Serial.printf("[ota] Update.begin failed: %s\n", Update.errorString());
        http.end();
        restoreWatchdog(options.normalWatchdogTimeoutS);
        return;
    }

    if (expectedMd5 != nullptr && strlen(expectedMd5) > 0) {
        Update.setMD5(expectedMd5);
    }

    Update.onProgress([](size_t, size_t) { esp_task_wdt_reset(); });

    WiFiClient* stream = http.getStreamPtr();
    size_t written = Update.writeStream(*stream);
    if (written != static_cast<size_t>(contentLength)) {
        Serial.printf("[ota] wrote %u of %d bytes, aborting\n", static_cast<unsigned>(written), contentLength);
        Update.abort();
        http.end();
        restoreWatchdog(options.normalWatchdogTimeoutS);
        return;
    }

    if (!Update.end(true)) {
        Serial.printf("[ota] Update.end failed: %s\n", Update.errorString());
        http.end();
        restoreWatchdog(options.normalWatchdogTimeoutS);
        return;
    }

    http.end();
    Serial.println("[ota] update successful, rebooting");
    ESP.restart();
}

} // namespace unibrew
