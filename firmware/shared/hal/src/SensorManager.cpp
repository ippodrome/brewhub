#include "SensorManager.h"
#include <cmath>

namespace unibrew {

void SensorManager::begin(uint8_t oneWirePin) {
    oneWire_.begin(oneWirePin);
    sensors_.begin();
    sensors_.setWaitForConversion(true);
    began_ = true;
}

float SensorManager::readTemperatureC() {
    if (!began_) {
        return NAN;
    }

    sensors_.requestTemperatures();
    float tempC = sensors_.getTempCByIndex(0);

    if (tempC == DEVICE_DISCONNECTED_C) {
        return NAN;
    }
    return tempC;
}

} // namespace unibrew
