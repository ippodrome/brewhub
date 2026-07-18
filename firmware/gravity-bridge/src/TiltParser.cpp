#include "TiltParser.h"

namespace unibrew {
namespace {

// All 8 Tilt colours share every UUID byte except index 3 (0x10 red, 0x20
// green, ... 0x80 pink) — see TiltParser.h doc comment on provenance.
constexpr uint8_t kTiltUuidPrefix[3] = {0xA4, 0x95, 0xBB};
constexpr uint8_t kTiltUuidSuffix[12] = {0xC5, 0xB1, 0x4B, 0x44, 0xB5, 0x12, 0x13, 0x70, 0xF0, 0x2D, 0x74, 0xDE};

struct TiltColour {
    uint8_t marker;
    const char* identifier;
};

constexpr TiltColour kTiltColours[8] = {
    {0x10, "tilt-red"},    {0x20, "tilt-green"}, {0x30, "tilt-black"}, {0x40, "tilt-purple"},
    {0x50, "tilt-orange"}, {0x60, "tilt-blue"},   {0x70, "tilt-yellow"}, {0x80, "tilt-pink"},
};

} // namespace

bool TiltParser::tryParse(const std::string& manufacturerData, GravityReading& out) {
    // Apple company ID (0x004C, little-endian) + iBeacon type 0x02 + length
    // 0x15 (21 bytes: 16 UUID + 2 major + 2 minor + 1 tx power) = 25 bytes total.
    if (manufacturerData.size() < 25) return false;

    const auto* bytes = reinterpret_cast<const uint8_t*>(manufacturerData.data());
    if (bytes[0] != 0x4C || bytes[1] != 0x00 || bytes[2] != 0x02 || bytes[3] != 0x15) return false;

    if (bytes[4] != kTiltUuidPrefix[0] || bytes[5] != kTiltUuidPrefix[1] || bytes[6] != kTiltUuidPrefix[2]) {
        return false;
    }
    for (int i = 0; i < 12; i++) {
        if (bytes[8 + i] != kTiltUuidSuffix[i]) return false;
    }

    const uint8_t colourMarker = bytes[7];
    const char* identifier = nullptr;
    for (const auto& colour : kTiltColours) {
        if (colour.marker == colourMarker) {
            identifier = colour.identifier;
            break;
        }
    }
    if (identifier == nullptr) return false;

    const uint16_t major = (static_cast<uint16_t>(bytes[20]) << 8) | bytes[21]; // degrees Fahrenheit
    const uint16_t minor = (static_cast<uint16_t>(bytes[22]) << 8) | bytes[23]; // SG * 1000

    setIdentifier(out, identifier);
    out.temperatureC = (static_cast<float>(major) - 32.0f) * 5.0f / 9.0f;
    out.gravitySg = static_cast<float>(minor) / 1000.0f;
    out.hasBattery = false;
    out.batteryPercent = 0.0f;
    return true;
}

} // namespace unibrew
