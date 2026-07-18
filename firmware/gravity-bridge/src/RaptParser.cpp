#include "RaptParser.h"
#include <cstdio>

namespace unibrew {
namespace {

// PLACEHOLDER — see RaptParser.h. Community references (e.g. the
// python-rapt-ble / rapt_ble ESPHome projects) indicate Rapt Pill
// advertises manufacturer data starting with a "PT" (0x50, 0x54) signature
// after the company ID, followed by a format-version byte, gravity
// (float32 or scaled int16, unconfirmed), temperature, and battery percent.
// None of the exact offsets here have been confirmed against a real device.
constexpr uint8_t kRaptSignature[2] = {0x50, 0x54}; // 'P', 'T'
constexpr size_t kMinRaptPayloadLen = 8;

} // namespace

bool RaptParser::tryParse(const std::string& manufacturerData, GravityReading& out) {
    if (manufacturerData.size() < kMinRaptPayloadLen) return false;

    const auto* bytes = reinterpret_cast<const uint8_t*>(manufacturerData.data());
    // bytes[0..1] = company ID (unconfirmed which one), bytes[2..3] expected
    // to be the "PT" signature below — if this doesn't match on real
    // hardware, that's the first thing to fix here.
    if (bytes[2] != kRaptSignature[0] || bytes[3] != kRaptSignature[1]) return false;

    // UNVERIFIED offsets — placeholder only, see header doc comment.
    static char identifierBuf[16];
    std::snprintf(identifierBuf, sizeof(identifierBuf), "rapt-%02x%02x%02x", bytes[4], bytes[5], bytes[6]);

    out.identifier = identifierBuf;
    out.gravitySg = 1.000f;
    out.temperatureC = 20.0f;
    out.hasBattery = false;
    out.batteryPercent = 0.0f;

    // Deliberately returns false until the real byte layout is confirmed —
    // publishing fabricated readings would be worse than publishing none.
    // Flip this to `return true;` once the offsets above are verified
    // against a real Rapt Pill's actual advertisement bytes.
    return false;
}

} // namespace unibrew
