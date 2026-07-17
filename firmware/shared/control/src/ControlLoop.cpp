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
    , pid_(config.pidGains)
{
}

void ControlLoop::setConfig(const ControlConfig& config)
{
    bool modeChanged = (config.mode != config_.mode);
    config_ = config;
    pid_.setGains(config_.pidGains);
    if (modeChanged) {
        // Stale accumulated integral/window state from a previous mode
        // must not leak into the newly selected one.
        pid_.reset();
        pidWindowInitialized_ = false;
    }
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

ControlOutput ControlLoop::desiredThermostat(float temperatureC) const
{
    const float low  = config_.setpointC - config_.hysteresisC;
    const float high = config_.setpointC + config_.hysteresisC;

    // Classic hysteresis: inside the deadband, hold whatever output_ already is.
    ControlOutput desired = output_;

    if (temperatureC > high) {
        if (config_.coolingEnabled) {
            desired = ControlOutput::COOLING;
        } else if (output_ == ControlOutput::HEATING) {
            desired = ControlOutput::IDLE;
        }
    } else if (temperatureC < low) {
        if (config_.heatingEnabled) {
            desired = ControlOutput::HEATING;
        } else if (output_ == ControlOutput::COOLING) {
            desired = ControlOutput::IDLE;
        }
    }

    return desired;
}

ControlOutput ControlLoop::desiredPid(float temperatureC, uint32_t nowMs)
{
    bool windowElapsed = pidWindowInitialized_ &&
        (nowMs - pidWindowStartMs_) >= config_.pidWindowMs;

    if (!pidWindowInitialized_ || windowElapsed) {
        float pidOutput = pid_.update(config_.setpointC, temperatureC, nowMs);

        if (pidOutput > 0.0f && config_.heatingEnabled) {
            pidWindowDirection_ = ControlOutput::HEATING;
        } else if (pidOutput < 0.0f && config_.coolingEnabled) {
            pidWindowDirection_ = ControlOutput::COOLING;
        } else {
            pidWindowDirection_ = ControlOutput::IDLE;
        }

        if (pidWindowDirection_ == ControlOutput::IDLE) {
            pidWindowOnDurationMs_ = 0;
        } else {
            float magnitude = pidOutput < 0.0f ? -pidOutput : pidOutput;
            pidWindowOnDurationMs_ = static_cast<uint32_t>(
                static_cast<float>(config_.pidWindowMs) * (magnitude / 100.0f));
        }

        pidWindowStartMs_ = nowMs;
        pidWindowInitialized_ = true;
    }

    uint32_t elapsedInWindow = nowMs - pidWindowStartMs_;
    return (elapsedInWindow < pidWindowOnDurationMs_) ? pidWindowDirection_ : ControlOutput::IDLE;
}

void ControlLoop::applyDesired(ControlOutput desired, uint32_t nowMs)
{
    // Leaving HEATING or COOLING → IDLE (or switching sides via IDLE conceptually):
    // must satisfy min-on before leaving active state.
    if (desired == output_) {
        return;
    }

    if (output_ == ControlOutput::HEATING || output_ == ControlOutput::COOLING) {
        if (!canLeaveActive(nowMs)) {
            return; // hold until min-on elapsed
        }
    }

    if (desired == ControlOutput::HEATING) {
        if (!canEnterHeating(nowMs)) {
            if (output_ != ControlOutput::IDLE) {
                transitionTo(ControlOutput::IDLE, nowMs);
            }
            return;
        }
        transitionTo(ControlOutput::HEATING, nowMs);
        return;
    }

    if (desired == ControlOutput::COOLING) {
        if (!canEnterCooling(nowMs)) {
            if (output_ != ControlOutput::IDLE) {
                transitionTo(ControlOutput::IDLE, nowMs);
            }
            return;
        }
        transitionTo(ControlOutput::COOLING, nowMs);
        return;
    }

    // desired == IDLE
    transitionTo(ControlOutput::IDLE, nowMs);
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

    // Invalid reading handling (NaN or out of plausible range) — mode-agnostic.
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

    ControlOutput desired = (config_.mode == ControlMode::PID)
        ? desiredPid(temperatureC, nowMs)
        : desiredThermostat(temperatureC);

    applyDesired(desired, nowMs);
    return output_;
}

} // namespace unibrew
