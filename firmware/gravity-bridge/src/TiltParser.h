#pragma once
#include <cstdint>
#include <cstring>
#include <string>

namespace unibrew {

// identifier is fixed-size, owned storage (not a const char* into shared/
// static state) deliberately — RaptParser's identifier is built per-device
// from that device's MAC, so a shared static buffer would get overwritten
// by the next parsed reading in the same scan pass, silently corrupting
// every earlier GravityReading's identifier still sitting in the scan's
// results array. TiltParser's identifiers happen to be fixed string
// literals (one per colour) so this wasn't reachable there, but the same
// struct is shared by both parsers — safe-by-construction beats
// safe-only-because-the-other-caller-happens-not-to-trigger-it.
struct GravityReading {
    char identifier[24];
    float gravitySg;
    float temperatureC;
    bool hasBattery;
    float batteryPercent;
};

inline void setIdentifier(GravityReading& reading, const char* value) {
    std::strncpy(reading.identifier, value, sizeof(reading.identifier) - 1);
    reading.identifier[sizeof(reading.identifier) - 1] = '\0';
}

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
