#include "SensorManager.h"
#include <cmath>
#include <cstring>

namespace unibrew {

void SensorManager::begin(uint8_t oneWirePin) {
    oneWire_.begin(oneWirePin);
    sensors_.begin();
    sensors_.setWaitForConversion(true);
}

size_t SensorManager::discover() {
    discoveredCount_ = 0;
    uint8_t count = sensors_.getDeviceCount();
    for (uint8_t i = 0; i < count && discoveredCount_ < kMaxSensors; i++) {
        DeviceAddress addr;
        if (sensors_.getAddress(addr, i)) {
            memcpy(addresses_[discoveredCount_], addr, kSensorAddressBytes);
            discoveredCount_++;
        }
    }
    return discoveredCount_;
}

size_t SensorManager::sensorCount() const {
    return discoveredCount_;
}

const uint8_t* SensorManager::addressAt(size_t index) const {
    if (index >= discoveredCount_) {
        return nullptr;
    }
    return addresses_[index];
}

size_t SensorManager::readAll(SensorSample* out, size_t capacity) {
    sensors_.requestTemperatures();

    size_t written = 0;
    for (size_t i = 0; i < discoveredCount_ && written < capacity; i++) {
        memcpy(out[written].address, addresses_[i], kSensorAddressBytes);
        float tempC = sensors_.getTempC(addresses_[i]);
        out[written].temperatureC = (tempC == DEVICE_DISCONNECTED_C) ? NAN : tempC;
        written++;
    }
    return written;
}

} // namespace unibrew
