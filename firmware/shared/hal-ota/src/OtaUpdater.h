#pragma once

#include <stdint.h>

namespace unibrew {

struct OtaOptions {
    // Only URLs starting with this prefix are downloaded (see
    // OtaUrlPolicy.h). Required: a null/empty prefix rejects every OTA.
    const char* allowedUrlPrefix = nullptr;
    // PEM root CA used to verify the HTTPS server (Caddy's internal root,
    // see README "OTA hardening"). When null, the download falls back to
    // the old unverified TLS (setInsecure) and logs a loud warning, so
    // devices without OTA_CA_CERT in secrets.h keep updating.
    const char* caCertPem = nullptr;
    // The caller's normal task-watchdog timeout, restored after a failed
    // update. During the download the watchdog stays armed with the longer
    // kOtaWatchdogTimeoutS and is fed from Update's progress callback.
    uint32_t normalWatchdogTimeoutS = 30;
};

// Downloads a firmware binary over HTTPS and flashes it via the ESP32's
// OTA partition mechanism (Update.h) — the browser/backend-facing half of
// this lives in DECISIONS.md and apps/backend/src/mqtt/publish-ota.ts.
class OtaUpdater {
public:
    static constexpr uint32_t kOtaWatchdogTimeoutS = 120;
    static constexpr uint32_t kHttpConnectTimeoutMs = 10000;
    static constexpr uint16_t kHttpReadTimeoutMs = 15000;

    // Blocking. Callers MUST put every actuator into its safe state before
    // calling this. On success, verifies the write against expectedMd5,
    // finalizes the OTA partition switch, and reboots — this call never
    // returns in that case. On any failure (rejected URL, TLS/HTTP error,
    // timeout, size mismatch, MD5 mismatch, flash write error), logs why and
    // returns instead: the running app partition is untouched by a
    // failed/partial write, so this fails safe, not into a bricked device.
    //
    // The task watchdog is never disabled: it is re-armed with a longer
    // timeout for the download and fed on every written chunk, so a hung
    // server resets the device instead of blocking forever.
    void begin(const char* url, const char* expectedMd5, const OtaOptions& options);
};

} // namespace unibrew
