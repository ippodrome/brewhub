#include "ControlLoop.h"

#include <cmath>
#include <limits>

namespace unibrew {

ControlLoop::ControlLoop(const ControlConfig& config)
    : config_(config)
    , output_(ControlOutput::IDLE)
    , lastTransitionMs_(0)
    , heatingLastOffMs_(std::numeric_limits<uint32_t>::max())
    , coolingLastOffMs_(std::numeric_limits<uint32_t>::max())
    , invalidSinceMs_(std::numeric_limits<uint32_t>::max())
    , hasEverValidReading_(false)
{
}

void ControlLoop::setConfig(const ControlConfig& config)
{
    config_ = config;
}

const ControlConfig& ControlLoop::config() const
{
    return config_;
}

ControlOutput ControlLoop::currentOutput() const
{
    return output_;
}

bool ControlLoop::isValidReading(float temperatureC)
{
    if (std::isnan(temperatureC)) {
        return false;
    }
    if (temperatureC < kMinValidTempC || temperatureC > kMaxValidTempC) {
        return false;
    }
    return true;
}

bool ControlLoop::canLeaveActive(uint32_t nowMs) const
{
    // Only applies when currently HEATING or COOLING.
    const uint32_t elapsed = nowMs - lastTransitionMs_;
    return elapsed >= config_.minOnTimeMs;
}

bool ControlLoop::canEnterHeating(uint32_t nowMs) const
{
    if (heatingLastOffMs_ == std::numeric_limits<uint32_t>::max()) {
        return true; // never been heating before
    }
    const uint32_t elapsed = nowMs - heatingLastOffMs_;
    return elapsed >= config_.minOffTimeMs;
}

bool ControlLoop::canEnterCooling(uint32_t nowMs) const
{
    if (coolingLastOffMs_ == std::numeric_limits<uint32_t>::max()) {
        return true; // never been cooling before
    }
    const uint32_t elapsed = nowMs - coolingLastOffMs_;
    return elapsed >= config_.minOffTimeMs;
}

void ControlLoop::transitionTo(ControlOutput next, uint32_t nowMs)
{
    if (next == output_) {
        return;
    }

    // Record when we leave HEATING / COOLING for independent min-off tracking.
    if (output_ == ControlOutput::HEATING && next != ControlOutput::HEATING) {
        heatingLastOffMs_ = nowMs;
    }
    if (output_ == ControlOutput::COOLING && next != ControlOutput::COOLING) {
        coolingLastOffMs_ = nowMs;
    }

    output_ = next;
    lastTransitionMs_ = nowMs;
}

ControlOutput ControlLoop::update(float temperatureC, uint32_t nowMs)
{
    // Mode OFF: always idle, ignore temperature and timing.
    if (config_.mode == ControlMode::OFF) {
        if (output_ != ControlOutput::IDLE) {
            transitionTo(ControlOutput::IDLE, nowMs);
        }
        // Clear invalid streak tracking while off — not running actuators blind.
        invalidSinceMs_ = std::numeric_limits<uint32_t>::max();
        return output_;
    }

    // Invalid reading handling (NaN or out of plausible range).
    if (!isValidReading(temperatureC)) {
        if (invalidSinceMs_ == std::numeric_limits<uint32_t>::max()) {
            invalidSinceMs_ = nowMs;
        }
        const uint32_t invalidDuration = nowMs - invalidSinceMs_;
        if (invalidDuration > kSensorFaultTimeoutMs) {
            // Fail-safe: force IDLE after prolonged sensor fault.
            if (output_ != ControlOutput::IDLE) {
                transitionTo(ControlOutput::IDLE, nowMs);
            }
        }
        // Otherwise hold current output — do not react to bad data.
        return output_;
    }

    // Valid reading: clear fault streak and resume normal control.
    invalidSinceMs_ = std::numeric_limits<uint32_t>::max();
    hasEverValidReading_ = true;

    const float low  = config_.setpointC - config_.hysteresisC;
    const float high = config_.setpointC + config_.hysteresisC;

    // Desired action from temperature vs deadband (classic hysteresis).
    // Inside deadband: hold current output (no chattering).
    ControlOutput desired = output_;

    if (temperatureC > high) {
        // Above band: want cooling if enabled, otherwise idle (stop heating if on).
        if (config_.coolingEnabled) {
            desired = ControlOutput::COOLING;
        } else if (output_ == ControlOutput::HEATING) {
            desired = ControlOutput::IDLE;
        }
        // else: stay as-is (IDLE or already COOLING) when cooling disabled
    } else if (temperatureC < low) {
        // Below band: want heating if enabled, otherwise idle (stop cooling if on).
        if (config_.heatingEnabled) {
            desired = ControlOutput::HEATING;
        } else if (output_ == ControlOutput::COOLING) {
            desired = ControlOutput::IDLE;
        }
    }
    // else: within deadband — desired remains current output_

    // Apply min-on / min-off gates. Hold current output until gates allow transition.
    if (desired == output_) {
        return output_;
    }

    // Leaving HEATING or COOLING → IDLE (or switching sides via IDLE conceptually):
    // must satisfy min-on before leaving active state.
    if (output_ == ControlOutput::HEATING || output_ == ControlOutput::COOLING) {
        if (!canLeaveActive(nowMs)) {
            return output_; // hold until min-on elapsed
        }
    }

    // Direct heat↔cool switch is not representable as simultaneous; we go via the
    // desired state. If switching from one active mode to the other, treat as:
    // leave active (min-on already checked) then enter the other (min-off of that side).
    if (desired == ControlOutput::HEATING) {
        if (!canEnterHeating(nowMs)) {
            // Cannot enter heating yet — if we were active, we may still go IDLE;
            // if already IDLE, hold IDLE.
            if (output_ != ControlOutput::IDLE) {
                transitionTo(ControlOutput::IDLE, nowMs);
            }
            return output_;
        }
        transitionTo(ControlOutput::HEATING, nowMs);
        return output_;
    }

    if (desired == ControlOutput::COOLING) {
        if (!canEnterCooling(nowMs)) {
            if (output_ != ControlOutput::IDLE) {
                transitionTo(ControlOutput::IDLE, nowMs);
            }
            return output_;
        }
        transitionTo(ControlOutput::COOLING, nowMs);
        return output_;
    }

    // desired == IDLE
    transitionTo(ControlOutput::IDLE, nowMs);
    return output_;
}

} // namespace unibrew
