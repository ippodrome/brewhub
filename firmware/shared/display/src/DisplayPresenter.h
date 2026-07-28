#pragma once
#include <cstddef>
#include <cstdint>

#include "DisplayModel.h"

namespace unibrew {

// Independently repaintable regions of the screen. OUTPUT_BAND covers both
// the output label and the mode label because they share one filled
// rectangle — repainting the band erases the mode text, so they must be
// redrawn together.
enum class DisplayField : uint8_t {
    DEVICE_ID,
    CONNECTION,
    CONTROL_TEMP,
    SETPOINT,
    OFFLINE_NOTICE,
    OUTPUT_BAND,
    SENSORS,
};

constexpr size_t kDisplayFieldCount = 7;

struct DisplayText {
    char deviceId[24];
    char controlTemp[8];   // "18.4" or "--.-"
    char setpoint[24];     // "setpoint 18.0"
    char output[12];       // "COOLING" / "HEATING" / "IDLE"
    char mode[20];         // "mode: thermostat"
    char sensors[64];      // "A1B2 19.1  C3D4 21.7"
    char offlineNotice[32]; // "offline - still controlling" or "" when connected

    bool wifiConnected;
    bool mqttConnected;

    // True when the control reading is unusable — no sensors discovered, or
    // a NaN reading. ControlLoop cannot regulate in this state, so the
    // renderer colours the temperature to make it obvious.
    bool controlTempFault;

    ControlOutput outputState; // drives the band colour
    DisplayScreen screen;
};

class DisplayPresenter {
public:
    // Recomputes every formatted string from the model and sets the dirty
    // flag on each field whose text (or, for CONNECTION and OUTPUT_BAND,
    // whose associated state) actually changed. The first call after
    // construction marks everything dirty.
    void update(const DisplayModel& model);

    const DisplayText& text() const;
    bool isDirty(DisplayField field) const;

    // Called by the renderer once it has drawn every dirty field.
    void clearDirty();

    // Forces a full repaint on the next render — used when the screen is
    // switched and the chrome has to be redrawn from scratch.
    void markAllDirty();

private:
    DisplayText text_{};
    bool dirty_[kDisplayFieldCount] = {};
    bool initialized_ = false;

    void setDirty(DisplayField field);
};

} // namespace unibrew
