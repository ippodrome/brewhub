#include "FlowMeterManager.h"
#include <Arduino.h>

namespace unibrew {

namespace {

volatile uint32_t pulseCounts[kMaxFlowMeters] = {0};
volatile uint32_t lastPulseMicros[kMaxFlowMeters] = {0};
constexpr uint32_t kDebounceMicros = 2000; // 2ms — well under any realistic flow meter's max pulse rate

template <size_t Index>
void IRAM_ATTR handlePulse() {
    uint32_t now = micros();
    if (now - lastPulseMicros[Index] >= kDebounceMicros) {
        pulseCounts[Index]++;
        lastPulseMicros[Index] = now;
    }
}

// One explicit instantiation per possible index — attachInterrupt needs a
// plain function pointer, and each template instantiation is a genuinely
// distinct function with its index baked in at compile time, so the ISR's
// hot path has no runtime indirection (no lookup, no captured state).
void (*const kIsrTable[kMaxFlowMeters])() = {
    handlePulse<0>, handlePulse<1>, handlePulse<2>,
    handlePulse<3>, handlePulse<4>, handlePulse<5>,
    handlePulse<6>, handlePulse<7>, handlePulse<8>,
};

} // namespace

void FlowMeterManager::begin(const uint8_t* pins, size_t count) {
    count_ = count < kMaxFlowMeters ? count : kMaxFlowMeters;
    for (size_t i = 0; i < count_; i++) {
        pinMode(pins[i], INPUT_PULLUP);
        attachInterrupt(digitalPinToInterrupt(pins[i]), kIsrTable[i], FALLING);
    }
}

size_t FlowMeterManager::count() const {
    return count_;
}

uint32_t FlowMeterManager::pulseCount(size_t index) const {
    if (index >= count_) {
        return 0;
    }
    // 32-bit aligned reads are atomic on ESP32 in practice, but guard
    // explicitly rather than rely on that — cheap, and correct by
    // construction against a torn read if that ever changes.
    noInterrupts();
    uint32_t value = pulseCounts[index];
    interrupts();
    return value;
}

} // namespace unibrew
