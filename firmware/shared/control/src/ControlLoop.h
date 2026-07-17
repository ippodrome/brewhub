#pragma once
#include <cstdint>
#include "PidController.h"

namespace unibrew {

enum class ControlOutput : uint8_t { IDLE, HEATING, COOLING };
enum class ControlMode : uint8_t { OFF, THERMOSTAT, PID };

struct ControlConfig {
    float setpointC = 20.0f;
    float hysteresisC = 0.5f;       // deadband half-width around setpoint (THERMOSTAT mode)
    uint32_t minOnTimeMs = 60000;
    uint32_t minOffTimeMs = 60000;
    ControlMode mode = ControlMode::THERMOSTAT;
    bool coolingEnabled = true;
    bool heatingEnabled = false;

    // PID mode only. pidWindowMs is the time-proportioning window: PID
    // output is sampled once per window and converted into "on for this
    // fraction of the window" — compressors/heaters can't do 60% power, so
    // this is how a continuous control signal becomes relay on/off timing.
    PidGains pidGains;
    uint32_t pidWindowMs = 300000; // 5 minutes
};

class ControlLoop {
public:
    explicit ControlLoop(const ControlConfig& config = ControlConfig{});
    void setConfig(const ControlConfig& config);
    const ControlConfig& config() const;
    ControlOutput update(float temperatureC, uint32_t nowMs);
    ControlOutput currentOutput() const;

private:
    static constexpr float kMinValidTempC = -50.0f;
    static constexpr float kMaxValidTempC = 150.0f;
    static constexpr uint32_t kSensorFaultTimeoutMs = 300000; // 5 minutes

    ControlConfig config_;
    ControlOutput output_;
    uint32_t lastTransitionMs_;
    uint32_t heatingLastOffMs_;
    uint32_t coolingLastOffMs_;
    uint32_t invalidSinceMs_;
    bool hasEverValidReading_;

    PidController pid_;
    bool pidWindowInitialized_ = false;
    uint32_t pidWindowStartMs_ = 0;
    uint32_t pidWindowOnDurationMs_ = 0;
    ControlOutput pidWindowDirection_ = ControlOutput::IDLE;

    bool isValidReading(float temperatureC);
    bool canLeaveActive(uint32_t nowMs) const;
    bool canEnterHeating(uint32_t nowMs) const;
    bool canEnterCooling(uint32_t nowMs) const;
    void transitionTo(ControlOutput next, uint32_t nowMs);
    void applyDesired(ControlOutput desired, uint32_t nowMs);

    ControlOutput desiredThermostat(float temperatureC) const;
    ControlOutput desiredPid(float temperatureC, uint32_t nowMs);
};

} // namespace unibrew
