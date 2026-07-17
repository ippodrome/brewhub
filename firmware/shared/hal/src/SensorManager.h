#pragma once
#include <cstdint>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "SensorAddress.h"

namespace unibrew {

// Reasonable bound for sensors on a single OneWire bus for this project
// (kegerator: chamber/keg/tower/room; fermenter: beer/fridge, plus room for
// growth) — not a DS18B20/OneWire protocol limit.
constexpr size_t kMaxSensors = 8;

struct SensorSample {
    uint8_t address[kSensorAddressBytes];
    float temperatureC; // NaN if this specific sensor faulted on this read
};

// Discovers and reads however many DS18B20s are wired to a single OneWire
// bus, identified by their stable ROM address rather than bus-scan index —
// index order isn't guaranteed stable across reboots or when sensors are
// added/removed, address identity is.
class SensorManager {
public:
    void begin(uint8_t oneWirePin);

    // Scans the bus for connected devices. Call once at boot; DS18B20s
    // aren't hot-pluggable in practice, so this isn't repeated in loop().
    size_t discover();

    size_t sensorCount() const;
    const uint8_t* addressAt(size_t index) const; // raw 8 bytes, or nullptr if out of range

    // Reads all discovered sensors in one pass. Returns how many samples
    // were written into out (== sensorCount(), capped at capacity).
    size_t readAll(SensorSample* out, size_t capacity);

private:
    OneWire oneWire_;
    DallasTemperature sensors_{&oneWire_};
    uint8_t addresses_[kMaxSensors][kSensorAddressBytes];
    size_t discoveredCount_ = 0;
};

} // namespace unibrew
