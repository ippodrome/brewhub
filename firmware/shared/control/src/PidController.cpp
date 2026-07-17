#include "PidController.h"
#include <algorithm>

namespace unibrew {

namespace {
float clampf(float value, float lo, float hi) {
    return std::max(lo, std::min(hi, value));
}
} // namespace

PidController::PidController(const PidGains& gains) : gains_(gains) {}

void PidController::setGains(const PidGains& gains) {
    gains_ = gains;
}

const PidGains& PidController::gains() const {
    return gains_;
}

void PidController::reset() {
    integral_ = 0.0f;
    previousError_ = 0.0f;
    hasPrevious_ = false;
}

float PidController::update(float setpointC, float measuredC, uint32_t nowMs) {
    float error = setpointC - measuredC;

    if (!hasPrevious_) {
        // No time delta available yet — proportional term only, and seed
        // history so the next call can compute integral/derivative.
        previousError_ = error;
        previousMs_ = nowMs;
        hasPrevious_ = true;
        return clampf(gains_.kp * error, kOutputMin, kOutputMax);
    }

    float dtS = static_cast<float>(nowMs - previousMs_) / 1000.0f;
    if (dtS <= 0.0f) {
        dtS = 0.001f; // guard against a zero/negative delta (same-ms call, clock wrap)
    }

    float p = gains_.kp * error;

    integral_ += error * dtS;
    integral_ = clampf(integral_, kIntegralMin, kIntegralMax); // anti-windup
    float i = gains_.ki * integral_;

    float derivative = (error - previousError_) / dtS;
    float d = gains_.kd * derivative;

    previousError_ = error;
    previousMs_ = nowMs;

    return clampf(p + i + d, kOutputMin, kOutputMax);
}

} // namespace unibrew
