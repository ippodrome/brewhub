#include "SensorAddress.h"

namespace unibrew {

namespace {

const char kHexDigits[] = "0123456789ABCDEF";

bool hexNibble(char c, uint8_t& out) {
    if (c >= '0' && c <= '9') { out = static_cast<uint8_t>(c - '0'); return true; }
    if (c >= 'A' && c <= 'F') { out = static_cast<uint8_t>(c - 'A' + 10); return true; }
    if (c >= 'a' && c <= 'f') { out = static_cast<uint8_t>(c - 'a' + 10); return true; }
    return false;
}

} // namespace

void formatSensorAddress(const uint8_t address[kSensorAddressBytes], char* out, size_t outCapacity) {
    if (outCapacity < kSensorAddressHexLength + 1) {
        if (outCapacity > 0) out[0] = '\0';
        return;
    }
    for (size_t i = 0; i < kSensorAddressBytes; i++) {
        out[i * 2] = kHexDigits[(address[i] >> 4) & 0x0F];
        out[i * 2 + 1] = kHexDigits[address[i] & 0x0F];
    }
    out[kSensorAddressHexLength] = '\0';
}

bool parseSensorAddress(const char* hex, uint8_t out[kSensorAddressBytes]) {
    if (hex == nullptr) {
        return false;
    }
    size_t len = 0;
    while (hex[len] != '\0' && len <= kSensorAddressHexLength) {
        len++;
    }
    if (len != kSensorAddressHexLength) {
        return false;
    }

    for (size_t i = 0; i < kSensorAddressBytes; i++) {
        uint8_t hi = 0;
        uint8_t lo = 0;
        if (!hexNibble(hex[i * 2], hi) || !hexNibble(hex[i * 2 + 1], lo)) {
            return false;
        }
        out[i] = static_cast<uint8_t>((hi << 4) | lo);
    }
    return true;
}

bool sensorAddressMatches(const uint8_t address[kSensorAddressBytes], const char* hex) {
    uint8_t parsed[kSensorAddressBytes];
    if (!parseSensorAddress(hex, parsed)) {
        return false;
    }
    for (size_t i = 0; i < kSensorAddressBytes; i++) {
        if (address[i] != parsed[i]) {
            return false;
        }
    }
    return true;
}

} // namespace unibrew
