#pragma once
#include <cstdint>
#include <HX711.h>
#include <Preferences.h>

namespace unibrew {

// Wraps a single HX711 load-cell amplifier for a keg_scale device.
//
// calibrationFactor converts the HX711's raw ADC units into grams
// (scale.set_scale()) — determined once per physical load cell by
// comparing readings against a known reference weight (see keg-scale
// README). begin()'s parameter is only the first-ever-boot fallback: once
// setCalibrationFactor() has been called (from a backend-pushed config —
// see DeviceConfigSchema.loadCellCalibrationFactor and DECISIONS.md), the
// persisted value takes over and the begin() parameter is ignored on every
// subsequent boot, the same way pins.h's own comment already warns its
// compiled-in constant is "almost certainly wrong" for any given physical
// load cell without a real calibration.
//
// The HX711 library's zero-offset (set by tare()) only lives in RAM, so a
// naive implementation would forget it on every ESP32 reboot — silently
// breaking the absolute-weight assumption that tap-level tareWeightG/
// fullWeightG calibration (see compute-weight-volume.ts on the backend)
// depends on. This class persists that offset to NVS on every tare() and
// restores it in begin(), so the "grams" readGrams() reports stay
// consistent across power cycles without requiring the platform to be
// physically empty again after a reboot.
class LoadCellManager {
public:
    void begin(uint8_t doutPin, uint8_t sckPin, float defaultCalibrationFactor);

    // Physically zeroes the scale at its current load and persists the new
    // offset to NVS. Blocking (HX711 library requirement, bounded by an
    // internal timeout) — call only in response to an explicit tare
    // request, never from the hot loop, and only with the platform in its
    // true reference state (see keg-scale README) — taring with a keg
    // already on the platform would corrupt every weight-based tap reading
    // from that channel until re-tared correctly.
    void tare();

    // Applies a new raw-ADC-to-grams calibration factor and persists it to
    // NVS so it survives a reboot without needing a reflash. Cheap and
    // idempotent (unlike tare()) — safe to call every time a config message
    // carrying this field arrives, including MQTT redeliveries.
    void setCalibrationFactor(float calibrationFactor);

    // NAN if the HX711 doesn't report ready within a bounded timeout —
    // mirrors SensorManager's "null/NaN on fault" convention (see
    // SensorReadingSchema in shared-types) rather than blocking indefinitely.
    float readGrams();

private:
    HX711 scale_;
    Preferences prefs_;
    bool begun_ = false;

    static constexpr const char* kNamespace = "unibrew-scale";
    static constexpr const char* kOffsetKey = "offset";
    static constexpr const char* kCalibrationFactorKey = "calFactor";
    static constexpr uint32_t kReadyTimeoutMs = 500;
    static constexpr uint32_t kTareTimeoutMs = 5000;
    static constexpr uint8_t kSamplesPerReading = 5;
};

} // namespace unibrew
