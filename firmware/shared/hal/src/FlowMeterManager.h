#pragma once
#include <cstddef>
#include <cstdint>

namespace unibrew {

constexpr size_t kMaxFlowMeters = 9;

// Debounced, interrupt-driven pulse counting on up to 9 GPIO pins.
// Cumulative and monotonic for the lifetime of the process (resets to 0 on
// reboot) — the backend's pour-aggregation logic is explicitly designed to
// detect and resync on that reset, so this class doesn't need to persist
// anything.
class FlowMeterManager {
public:
    // pins: GPIO pin numbers, count: how many (capped at kMaxFlowMeters).
    // Safe to pass fewer than 9 if not all flow inputs are physically wired.
    void begin(const uint8_t* pins, size_t count);

    size_t count() const;
    uint32_t pulseCount(size_t index) const; // 0 if index >= count()

private:
    size_t count_ = 0;
};

} // namespace unibrew
