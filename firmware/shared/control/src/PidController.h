#pragma once
#include <cstdint>

namespace unibrew {

struct PidGains {
    float kp = 0.0f;
    float ki = 0.0f;
    float kd = 0.0f;
};

// Textbook PID with clamped-integral anti-windup. Output is a unitless
// control signal in [-100, 100]: negative = cooling demand, positive =
// heating demand, magnitude = intensity. Deliberately has no notion of
// relays or timing — ControlLoop's PID mode converts this continuous signal
// into time-proportioned on/off decisions, keeping this class a pure
// function of (setpoint, measurement, time).
class PidController {
public:
    explicit PidController(const PidGains& gains = PidGains{});

    void setGains(const PidGains& gains);
    const PidGains& gains() const;

    // Clears integral and derivative history. Call on mode changes or after
    // a long control gap, so stale accumulated error doesn't cause a jolt.
    void reset();

    float update(float setpointC, float measuredC, uint32_t nowMs);

private:
    static constexpr float kOutputMin = -100.0f;
    static constexpr float kOutputMax = 100.0f;
    static constexpr float kIntegralMin = -100.0f;
    static constexpr float kIntegralMax = 100.0f;

    PidGains gains_;
    float integral_ = 0.0f;
    float previousError_ = 0.0f;
    uint32_t previousMs_ = 0;
    bool hasPrevious_ = false;
};

} // namespace unibrew
