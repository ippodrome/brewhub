#include "OtaUpdater.h"
#include <Arduino.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Update.h>

namespace unibrew {

void OtaUpdater::begin(const char* url, const char* expectedMd5) {
    WiFiClientSecure client;
    client.setInsecure();

    HTTPClient http;
    if (!http.begin(client, url)) {
        Serial.println("[ota] http.begin failed (bad URL?)");
        return;
    }

    int httpCode = http.GET();
    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[ota] GET failed, HTTP code %d\n", httpCode);
        http.end();
        return;
    }

    int contentLength = http.getSize();
    if (contentLength <= 0) {
        Serial.println("[ota] invalid/missing Content-Length");
        http.end();
        return;
    }

    if (!Update.begin(contentLength)) {
        Serial.printf("[ota] Update.begin failed: %s\n", Update.errorString());
        http.end();
        return;
    }

    if (expectedMd5 != nullptr && strlen(expectedMd5) > 0) {
        Update.setMD5(expectedMd5);
    }

    WiFiClient* stream = http.getStreamPtr();
    size_t written = Update.writeStream(*stream);
    if (written != static_cast<size_t>(contentLength)) {
        Serial.printf("[ota] wrote %u of %d bytes, aborting\n", static_cast<unsigned>(written), contentLength);
        Update.abort();
        http.end();
        return;
    }

    if (!Update.end(true)) {
        Serial.printf("[ota] Update.end failed: %s\n", Update.errorString());
        http.end();
        return;
    }

    http.end();
    Serial.println("[ota] update successful, rebooting");
    ESP.restart();
}

} // namespace unibrew
