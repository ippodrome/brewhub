#pragma once

namespace unibrew {

// Pure (hardware-independent) check deciding whether a device may download
// firmware from `url`, given an allowed prefix compiled into the firmware.
//
// An OTA URL arrives over MQTT, so it must never be trusted on its own: a
// URL is only accepted when ALL of these hold:
//   - url and allowedPrefix are non-empty and allowedPrefix starts with
//     "https://"
//   - url starts with allowedPrefix
//   - url contains no '@' (blocks "https://host:8443@evil/..." userinfo
//     tricks against a host-only prefix), no "..", no backslash and no
//     whitespace/control characters
//   - the path contains "/api/firmware/" (the only place the backend serves
//     binaries from, see apps/backend/src/routes/firmware.routes.ts)
bool isOtaUrlAllowed(const char* url, const char* allowedPrefix);

} // namespace unibrew
