#pragma once
#include <cstdint>
#include <OneWire.h>
#include <DallasTemperature.h>

namespace unibrew {

// Thin wrapper around a single DS18B20 on a OneWire bus. Phase 1 scope is one
// sensor per device; multi-sensor support (kegerator: chamber/keg/tower/room)
// is a Phase 2 extension of this same class, not a new abstraction.
class SensorManager {
public:
    void begin(uint8_t oneWirePin);

    // Returns NaN if the sensor didn't respond, failed its CRC, or reported
    // the DallasTemperature "disconnected" sentinel — callers (ControlLoop)
    // already treat NaN as "no valid reading."
    float readTemperatureC();

private:
    OneWire oneWire_;
    DallasTemperature sensors_{&oneWire_};
    bool began_ = false;
};

} // namespace unibrew
