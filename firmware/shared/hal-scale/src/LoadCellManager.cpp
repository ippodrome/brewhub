#include "LoadCellManager.h"
#include <Arduino.h>

namespace unibrew {

void LoadCellManager::begin(uint8_t doutPin, uint8_t sckPin, float calibrationFactor) {
    scale_.begin(doutPin, sckPin);
    scale_.set_scale(calibrationFactor);

    prefs_.begin(kNamespace, false);
    if (prefs_.isKey(kOffsetKey)) {
        long offset = prefs_.getLong(kOffsetKey, 0);
        scale_.set_offset(offset);
        Serial.printf("[loadcell] restored offset %ld from NVS\n", offset);
    } else {
        Serial.println(
            "[loadcell] no persisted offset yet — scale has never been tared; "
            "readings will be relative to power-on state until a tare is requested");
    }

    begun_ = true;
}

void LoadCellManager::tare() {
    if (!begun_) return;

    if (!scale_.wait_ready_timeout(kTareTimeoutMs)) {
        Serial.println("[loadcell] tare failed: HX711 not ready");
        return;
    }

    scale_.tare();
    long offset = scale_.get_offset();
    prefs_.putLong(kOffsetKey, offset);
    Serial.printf("[loadcell] tared, new offset %ld persisted to NVS\n", offset);
}

float LoadCellManager::readGrams() {
    if (!begun_) return NAN;
    if (!scale_.wait_ready_timeout(kReadyTimeoutMs)) {
        return NAN;
    }
    return scale_.get_units(kSamplesPerReading);
}

} // namespace unibrew
