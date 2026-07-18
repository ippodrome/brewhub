#pragma once

namespace unibrew {

// Downloads a firmware binary over HTTPS and flashes it via the ESP32's
// OTA partition mechanism (Update.h) — the browser/backend-facing half of
// this lives in DECISIONS.md and apps/backend/src/mqtt/publish-ota.ts.
class OtaUpdater {
public:
    // Blocking. On success, verifies the write against expectedMd5, finalizes
    // the OTA partition switch, and reboots — this call never returns in
    // that case. On any failure (HTTP error, size mismatch, MD5 mismatch,
    // flash write error), logs why and returns instead: the currently
    // running app partition is untouched by a failed/partial write, so this
    // fails safe, not into a bricked device.
    //
    // url must be HTTPS — Caddy (the only thing devices can reach on the
    // LAN, see docker-compose.yml) terminates TLS with a self-signed cert,
    // so this uses WiFiClientSecure::setInsecure() rather than validating a
    // CA chain, matching the LAN-trust model already accepted for MQTT
    // (DECISIONS.md ADR-008) — not meaningfully different from that
    // decision, just a different transport.
    void begin(const char* url, const char* expectedMd5);
};

} // namespace unibrew
