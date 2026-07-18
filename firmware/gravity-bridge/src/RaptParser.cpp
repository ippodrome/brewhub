#include "RaptParser.h"
#include <cstdio>
#include <cstring>

namespace unibrew {
namespace {

// V1 payload (see RaptParser.h for the source): 4-byte "RAPT" ASCII prefix,
// 1-byte version (== 1), 6-byte MAC, then temperature/gravity/x/y/z/battery,
// all big-endian. 25 bytes total.
constexpr uint8_t kRaptPrefix[4] = {'R', 'A', 'P', 'T'};
constexpr size_t kV1PayloadLen = 25;
constexpr uint8_t kVersion1 = 1;

uint16_t readU16BE(const uint8_t* p) {
    return (static_cast<uint16_t>(p[0]) << 8) | p[1];
}

int16_t readI16BE(const uint8_t* p) {
    return static_cast<int16_t>(readU16BE(p));
}

float readF32BE(const uint8_t* p) {
    uint8_t le[4] = {p[3], p[2], p[1], p[0]}; // ESP32 (Xtensa) is little-endian
    float value;
    std::memcpy(&value, le, sizeof(value));
    return value;
}

} // namespace

bool RaptParser::tryParse(const std::string& manufacturerData, GravityReading& out) {
    if (manufacturerData.size() != kV1PayloadLen) return false;

    const auto* bytes = reinterpret_cast<const uint8_t*>(manufacturerData.data());
    for (int i = 0; i < 4; i++) {
        if (bytes[i] != kRaptPrefix[i]) return false;
    }

    const uint8_t version = bytes[4];
    if (version != kVersion1) return false; // V2 deliberately unsupported, see RaptParser.h

    // bytes[5..11) = 6-byte MAC — used as this hydrometer's identifier
    // rather than relying on the NimBLE-reported advertiser address, since
    // it's already right here in the payload and doesn't require changing
    // this function's signature. Written directly into `out`'s own fixed
    // buffer (see GravityReading's doc comment) — not a shared static one.
    char identifierBuf[24];
    std::snprintf(identifierBuf, sizeof(identifierBuf), "rapt-%02x%02x%02x%02x%02x%02x", bytes[5], bytes[6],
                  bytes[7], bytes[8], bytes[9], bytes[10]);

    const uint16_t rawTemp = readU16BE(bytes + 11);
    const float rawGravity = readF32BE(bytes + 13);
    const int16_t rawBattery = readI16BE(bytes + 23);
    // bytes[17..23) are x/y/z accelerometer/tilt-angle readings — not
    // surfaced in GravityReading, no use for them here.

    setIdentifier(out, identifierBuf);
    out.temperatureC = static_cast<float>(rawTemp) / 128.0f - 273.15f;
    out.gravitySg = rawGravity / 1000.0f;
    out.hasBattery = true;
    out.batteryPercent = static_cast<float>(rawBattery) / 256.0f;
    return true;
}

} // namespace unibrew
