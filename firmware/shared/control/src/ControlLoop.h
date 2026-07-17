#pragma once
#include <cstdint>

namespace unibrew {

enum class ControlOutput : uint8_t { IDLE, HEATING, COOLING };
enum class ControlMode : uint8_t { OFF, THERMOSTAT };

struct ControlConfig {
    float setpointC = 20.0f;
    float hysteresisC = 0.5f;       // deadband half-width around setpoint
    uint32_t minOnTimeMs = 60000;
    uint32_t minOffTimeMs = 60000;
    ControlMode mode = ControlMode::THERMOSTAT;
    bool coolingEnabled = true;
    bool heatingEnabled = false;
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

    bool isValidReading(float temperatureC);
    bool canLeaveActive(uint32_t nowMs) const;
    bool canEnterHeating(uint32_t nowMs) const;
    bool canEnterCooling(uint32_t nowMs) const;
    void transitionTo(ControlOutput next, uint32_t nowMs);
};

} // namespace unibrew
