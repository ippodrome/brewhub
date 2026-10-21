#pragma once

// Include AFTER the board's secrets.h. Reads the optional OTA hardening
// macros from secrets.h, with backwards-compatible defaults:
//
//   #define OTA_URL_PREFIX "https://192.168.1.50:8443"  // = backend PUBLIC_URL
//   #define OTA_CA_CERT R"PEM(-----BEGIN CERTIFICATE-----
//   ...
//   -----END CERTIFICATE-----)PEM"
//
// Without OTA_URL_PREFIX, only https://<MQTT_HOST>:<any port>/api/firmware/...
// is accepted (Caddy and the broker normally share a host). Without
// OTA_CA_CERT, TLS is not verified (old behaviour, logged as a warning).

#include <Arduino.h>
#include "OtaUpdater.h"

namespace unibrew {

inline OtaOptions otaOptionsFromSecrets(uint32_t normalWatchdogTimeoutS) {
    OtaOptions options;
#ifdef OTA_URL_PREFIX
    options.allowedUrlPrefix = OTA_URL_PREFIX;
#else
    static char defaultPrefix[96] = {0};
    if (defaultPrefix[0] == '\0') {
        snprintf(defaultPrefix, sizeof(defaultPrefix), "https://%s:", MQTT_HOST);
    }
    options.allowedUrlPrefix = defaultPrefix;
#endif
#ifdef OTA_CA_CERT
    options.caCertPem = OTA_CA_CERT;
#endif
    options.normalWatchdogTimeoutS = normalWatchdogTimeoutS;
    return options;
}

} // namespace unibrew
