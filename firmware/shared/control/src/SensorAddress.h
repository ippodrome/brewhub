#pragma once
#include <cstddef>
#include <cstdint>

namespace unibrew {

constexpr size_t kSensorAddressBytes = 8;
constexpr size_t kSensorAddressHexLength = kSensorAddressBytes * 2; // 16 hex chars, excludes null terminator

// Formats 8 raw address bytes (e.g. a DS18B20 ROM address) as a 16-char
// uppercase hex string. out must have capacity for at least
// kSensorAddressHexLength + 1 bytes. Writes an empty string if outCapacity
// is too small, rather than overflowing.
void formatSensorAddress(const uint8_t address[kSensorAddressBytes], char* out, size_t outCapacity);

// Parses a 16-char hex string back into 8 raw bytes. Returns false (leaving
// out untouched) if hex is null, the wrong length, or contains non-hex
// characters.
bool parseSensorAddress(const char* hex, uint8_t out[kSensorAddressBytes]);

// True if the formatted form of address equals hex, case-insensitively.
bool sensorAddressMatches(const uint8_t address[kSensorAddressBytes], const char* hex);

} // namespace unibrew
