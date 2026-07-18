#include "LoadCellManager.h"
#include <Arduino.h>

namespace unibrew {

void LoadCellManager::begin(uint8_t doutPin, uint8_t sckPin, float defaultCalibrationFactor) {
    scale_.begin(doutPin, sckPin);

    prefs_.begin(kNamespace, false);

    if (prefs_.isKey(kCalibrationFactorKey)) {
        float factor = prefs_.getFloat(kCalibrationFactorKey, defaultCalibrationFactor);
        scale_.set_scale(factor);
        Serial.printf("[loadcell] restored calibration factor %.3f from NVS\n", factor);
    } else {
        scale_.set_scale(defaultCalibrationFactor);
        Serial.printf(
            "[loadcell] no persisted calibration factor yet — using compiled-in default %.3f "
            "until one is pushed via device config\n",
            defaultCalibrationFactor);
    }

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

void LoadCellManager::setCalibrationFactor(float calibrationFactor) {
    scale_.set_scale(calibrationFactor);
    prefs_.putFloat(kCalibrationFactorKey, calibrationFactor);
    Serial.printf("[loadcell] calibration factor set to %.3f, persisted to NVS\n", calibrationFactor);
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
