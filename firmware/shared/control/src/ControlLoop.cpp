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

void ControlLoop::forceIdleAndArmMinOff(uint32_t nowMs)
{
    if (output_ != ControlOutput::IDLE) {
        recordDecision(DecisionKind::TRANSITION, ControlOutput::IDLE,
                       DecisionReason::POLARITY_FORCED_IDLE, lastReadingC_, config_.setpointC,
                       nowMs, 0);
    }
    output_ = ControlOutput::IDLE;
    lastTransitionMs_ = nowMs;
    heatingLastOffMs_ = nowMs;
    coolingLastOffMs_ = nowMs;

    // A time-proportioning window computed under the old interpretation of
    // the outputs is meaningless now; start a fresh one from current
    // conditions rather than finishing the old duty cycle.
    pid_.reset();
    pidWindowInitialized_ = false;
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

uint32_t ControlLoop::lastTransitionMs() const
{
    return lastTransitionMs_;
}

bool ControlLoop::takeDecision(ControlDecision& out)
{
    if (pendingCount_ == 0) {
        return false;
    }
    out = pending_[pendingHead_];
    pendingHead_ = (pendingHead_ + 1) % kPendingCapacity;
    pendingCount_--;
    return true;
}

void ControlLoop::recordDecision(DecisionKind kind, ControlOutput to, DecisionReason reason,
                                 float temperatureC, float thresholdC, uint32_t nowMs,
                                 uint32_t remainingMs)
{
    // Reads output_ and lastTransitionMs_, so every caller must invoke this
    // BEFORE transitionTo updates them.
    if (pendingCount_ == kPendingCapacity) {
        pendingHead_ = (pendingHead_ + 1) % kPendingCapacity;
        pendingCount_--;
    }
    pending_[pendingTail_].kind = kind;
    pending_[pendingTail_].from = output_;
    pending_[pendingTail_].to = to;
    pending_[pendingTail_].reason = reason;
    pending_[pendingTail_].temperatureC = temperatureC;
    pending_[pendingTail_].thresholdC = thresholdC;
    pending_[pendingTail_].elapsedMs = nowMs - lastTransitionMs_;
    pending_[pendingTail_].remainingMs = remainingMs;
    pendingTail_ = (pendingTail_ + 1) % kPendingCapacity;
    pendingCount_++;
}

uint32_t ControlLoop::minOnRemainingMs(uint32_t nowMs) const
{
    const uint32_t held = nowMs - lastTransitionMs_;
    return held >= config_.minOnTimeMs ? 0u : config_.minOnTimeMs - held;
}

uint32_t ControlLoop::minOffRemainingMs(uint32_t nowMs, ControlOutput desired) const
{
    const uint32_t lastOff = (desired == ControlOutput::HEATING) ? heatingLastOffMs_ : coolingLastOffMs_;
    if (lastOff == std::numeric_limits<uint32_t>::max()) {
        return 0; // never run, so nothing to wait for
    }
    const uint32_t idle = nowMs - lastOff;
    return idle >= config_.minOffTimeMs ? 0u : config_.minOffTimeMs - idle;
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

ControlOutput ControlLoop::desiredThermostat(float temperatureC)
{
    const float low  = config_.setpointC - config_.hysteresisC;
    const float high = config_.setpointC + config_.hysteresisC;

    // Classic hysteresis: inside the deadband, hold whatever output_ already is.
    ControlOutput desired = output_;

    // Stash what drove this so applyDesired can record it without recomputing.
    lastReadingC_ = temperatureC;
    lastThresholdC_ = config_.setpointC;
    lastDesiredReason_ = DecisionReason::WITHIN_DEADBAND;

    if (temperatureC > high) {
        lastThresholdC_ = high;
        lastDesiredReason_ = DecisionReason::ABOVE_DEADBAND;
        if (config_.coolingEnabled) {
            desired = ControlOutput::COOLING;
        } else if (output_ == ControlOutput::HEATING) {
            desired = ControlOutput::IDLE;
        }
    } else if (temperatureC < low) {
        lastThresholdC_ = low;
        lastDesiredReason_ = DecisionReason::BELOW_DEADBAND;
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
    lastReadingC_ = temperatureC;
    lastThresholdC_ = config_.setpointC;
    lastDesiredReason_ = DecisionReason::PID_WINDOW;

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

void ControlLoop::recordTransition(ControlOutput to, uint32_t nowMs)
{
    if (to == output_) {
        return;
    }
    recordDecision(DecisionKind::TRANSITION, to, lastDesiredReason_, lastReadingC_,
                   lastThresholdC_, nowMs, 0);
}

void ControlLoop::reportBlocked(ControlOutput desired, DecisionReason reason, uint32_t nowMs,
                                uint32_t remainingMs)
{
    // Only on the edge. The condition stays true for as long as the timer
    // runs, and one decision per loop iteration would be hundreds of
    // identical messages saying the same thing.
    if (hasReportedBlock_ && blockedRequest_ == desired) {
        return;
    }
    recordDecision(DecisionKind::BLOCKED, desired, reason, lastReadingC_, lastThresholdC_, nowMs,
                   remainingMs);
    blockedRequest_ = desired;
    hasReportedBlock_ = true;
}

void ControlLoop::applyDesired(ControlOutput desired, uint32_t nowMs)
{
    // Leaving HEATING or COOLING → IDLE (or switching sides via IDLE conceptually):
    // must satisfy min-on before leaving active state.
    if (desired == output_) {
        hasReportedBlock_ = false;
        return;
    }

    if (output_ == ControlOutput::HEATING || output_ == ControlOutput::COOLING) {
        if (!canLeaveActive(nowMs)) {
            reportBlocked(desired, DecisionReason::MIN_ON_NOT_MET, nowMs, minOnRemainingMs(nowMs));
            return; // hold until min-on elapsed
        }
    }

    if (desired == ControlOutput::HEATING) {
        if (!canEnterHeating(nowMs)) {
            if (output_ != ControlOutput::IDLE) {
                recordDecision(DecisionKind::TRANSITION, ControlOutput::IDLE, lastDesiredReason_,
                               lastReadingC_, lastThresholdC_, nowMs, 0);
                transitionTo(ControlOutput::IDLE, nowMs);
            }
            reportBlocked(desired, DecisionReason::MIN_OFF_NOT_MET, nowMs,
                          minOffRemainingMs(nowMs, desired));
            return;
        }
        recordTransition(ControlOutput::HEATING, nowMs);
        transitionTo(ControlOutput::HEATING, nowMs);
        hasReportedBlock_ = false;
        return;
    }

    if (desired == ControlOutput::COOLING) {
        if (!canEnterCooling(nowMs)) {
            if (output_ != ControlOutput::IDLE) {
                recordDecision(DecisionKind::TRANSITION, ControlOutput::IDLE, lastDesiredReason_,
                               lastReadingC_, lastThresholdC_, nowMs, 0);
                transitionTo(ControlOutput::IDLE, nowMs);
            }
            reportBlocked(desired, DecisionReason::MIN_OFF_NOT_MET, nowMs,
                          minOffRemainingMs(nowMs, desired));
            return;
        }
        recordTransition(ControlOutput::COOLING, nowMs);
        transitionTo(ControlOutput::COOLING, nowMs);
        hasReportedBlock_ = false;
        return;
    }

    // desired == IDLE
    recordTransition(ControlOutput::IDLE, nowMs);
    transitionTo(ControlOutput::IDLE, nowMs);
    hasReportedBlock_ = false;
}

ControlOutput ControlLoop::update(float temperatureC, uint32_t nowMs)
{
    // Mode OFF: always idle, ignore temperature and timing.
    if (config_.mode == ControlMode::OFF) {
        if (output_ != ControlOutput::IDLE) {
            recordDecision(DecisionKind::TRANSITION, ControlOutput::IDLE, DecisionReason::MODE_OFF,
                           temperatureC, config_.setpointC, nowMs, 0);
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
                recordDecision(DecisionKind::TRANSITION, ControlOutput::IDLE, DecisionReason::SENSOR_FAULT,
                               temperatureC, config_.setpointC, nowMs, 0);
                transitionTo(ControlOutput::IDLE, nowMs);
            }
        }
        // Otherwise hold current output — do not react to bad data.
        return output_;
    }

    // Valid reading: clear fault streak and resume normal control.
    invalidSinceMs_ = std::numeric_limits<uint32_t>::max();
    hasEverValidReading_ = true;

    // Calibration is applied AFTER the validity check, deliberately: fault
    // detection belongs on what the sensor actually reported. A DS18B20
    // disconnect reads -127, and nudging that by an offset before range-
    // checking it would only ever move a fault value further from, never
    // into, the plausible band — but keeping the check on raw data means the
    // fault logic stays independent of whatever calibration happens to be set.
    const float calibratedC = temperatureC + config_.controlSensorOffsetC;

    ControlOutput desired = (config_.mode == ControlMode::PID)
        ? desiredPid(calibratedC, nowMs)
        : desiredThermostat(calibratedC);

    applyDesired(desired, nowMs);
    return output_;
}

} // namespace unibrew
