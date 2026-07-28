#include "DisplayPresenter.h"

#include <cmath>
#include <cstdio>
#include <cstring>

namespace unibrew {
namespace {

// Copies src into a fixed buffer, always null-terminating and truncating
// rather than overflowing. Returns true if the contents changed.
bool assign(char* dst, size_t capacity, const char* src) {
    if (src == nullptr) {
        src = "";
    }
    // Compares only the characters that fit, so re-assigning a string that
    // was already truncated to the same prefix correctly reports no change.
    if (std::strncmp(dst, src, capacity - 1) == 0) {
        return false;
    }
    std::strncpy(dst, src, capacity - 1);
    dst[capacity - 1] = '\0';
    return true;
}

void formatTemperature(float valueC, char* out, size_t capacity) {
    if (std::isnan(valueC)) {
        std::snprintf(out, capacity, "--.-");
        return;
    }
    // std::round ties away from zero, unlike printf's "%.1f" which on this
    // (and most modern) libc correctly rounds the underlying double to
    // nearest-even: -1.25 would print as "-1.2" instead of the expected
    // "-1.3". Pre-rounding to the nearest tenth here sidesteps that platform
    // difference.
    double scaled = std::round(static_cast<double>(valueC) * 10.0) / 10.0;
    std::snprintf(out, capacity, "%.1f", scaled);
}

const char* modeLabel(ControlMode mode) {
    switch (mode) {
        case ControlMode::OFF: return "mode: off";
        case ControlMode::PID: return "mode: pid";
        default: return "mode: thermostat";
    }
}

const char* outputLabel(ControlOutput output) {
    switch (output) {
        case ControlOutput::HEATING: return "HEATING";
        case ControlOutput::COOLING: return "COOLING";
        default: return "IDLE";
    }
}

} // namespace

void DisplayPresenter::setDirty(DisplayField field) {
    dirty_[static_cast<size_t>(field)] = true;
}

void DisplayPresenter::update(const DisplayModel& model) {
    if (assign(text_.deviceId, sizeof(text_.deviceId), model.deviceId)) {
        setDirty(DisplayField::DEVICE_ID);
    }

    char buffer[64];

    formatTemperature(model.controlTemperatureC, buffer, sizeof(buffer));
    if (assign(text_.controlTemp, sizeof(text_.controlTemp), buffer)) {
        setDirty(DisplayField::CONTROL_TEMP);
    }

    // A number with no sensors behind it is stale, not current: the control
    // loop has nothing to regulate on, so it is flagged as a fault even
    // though it formats cleanly.
    bool fault = std::isnan(model.controlTemperatureC) || model.sensorCount == 0;
    if (fault != text_.controlTempFault) {
        text_.controlTempFault = fault;
        setDirty(DisplayField::CONTROL_TEMP);
    }

    char setpointValue[16];
    formatTemperature(model.setpointC, setpointValue, sizeof(setpointValue));
    std::snprintf(buffer, sizeof(buffer), "setpoint %s", setpointValue);
    if (assign(text_.setpoint, sizeof(text_.setpoint), buffer)) {
        setDirty(DisplayField::SETPOINT);
    }

    if (assign(text_.output, sizeof(text_.output), outputLabel(model.output))) {
        setDirty(DisplayField::OUTPUT_BAND);
    }
    if (assign(text_.mode, sizeof(text_.mode), modeLabel(model.mode))) {
        setDirty(DisplayField::OUTPUT_BAND);
    }
    if (model.output != text_.outputState) {
        text_.outputState = model.output;
        setDirty(DisplayField::OUTPUT_BAND);
    }

    if (model.wifiConnected != text_.wifiConnected ||
        model.mqttConnected != text_.mqttConnected) {
        bool mqttChanged = model.mqttConnected != text_.mqttConnected;
        text_.wifiConnected = model.wifiConnected;
        text_.mqttConnected = model.mqttConnected;
        setDirty(DisplayField::CONNECTION);
        // Losing the broker does not stop the control loop. The screen has
        // to say so outright, otherwise a red indicator reads as "the
        // fermenter is dead" when it is still regulating perfectly well.
        if (mqttChanged) {
            setDirty(DisplayField::OFFLINE_NOTICE);
        }
    }

    text_.screen = model.screen;

    if (!initialized_) {
        initialized_ = true;
        markAllDirty();
    }
}

const DisplayText& DisplayPresenter::text() const {
    return text_;
}

bool DisplayPresenter::isDirty(DisplayField field) const {
    return dirty_[static_cast<size_t>(field)];
}

void DisplayPresenter::clearDirty() {
    for (size_t i = 0; i < kDisplayFieldCount; i++) {
        dirty_[i] = false;
    }
}

void DisplayPresenter::markAllDirty() {
    for (size_t i = 0; i < kDisplayFieldCount; i++) {
        dirty_[i] = true;
    }
}

} // namespace unibrew
