#pragma once
#include <cstdint>
#include <string>

namespace unibrew {

struct GravityReading {
    const char* identifier;
    float gravitySg;
    float temperatureC;
    bool hasBattery;
    float batteryPercent;
};

// Tilt Hydrometer: a standard iBeacon advertisement (Apple manufacturer ID
// 0x004C) whose fixed proximity UUID identifies the colour, with major=degF
// and minor=SG*1000 encoded in the usual iBeacon layout. The 8 UUIDs below
// are Tilt's own fixed, publicly documented per-colour identifiers (not
// derived from a real device — no Tilt hardware was available to verify
// this against during implementation, see DECISIONS.md).
class TiltParser {
public:
    // manufacturerData is the raw bytes as reported by the BLE stack
    // (company-id-prefixed). Returns true and fills `out` if this
    // advertisement matches a known Tilt colour's iBeacon UUID.
    static bool tryParse(const std::string& manufacturerData, GravityReading& out);
};

} // namespace unibrew
