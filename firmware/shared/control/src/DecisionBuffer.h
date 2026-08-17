#pragma once
#include <cstddef>
#include <cstdint>

#include "ControlLoop.h"

namespace unibrew {

// Holds control decisions until MQTT can carry them.
//
// ADR-004 has the device keep controlling while disconnected, which means the
// decisions made during an outage are exactly the ones worth reading
// afterwards - "what was it doing while the network was down" is the question
// nobody can currently answer. Fixed storage and no allocation: this lives on
// a device with a few hundred kilobytes of RAM and a watchdog.
//
// When full it drops the oldest rather than refusing the newest. Someone
// reconnecting after an hour wants what just happened; the overflow flag is
// how the UI learns the history has a hole instead of quietly implying it is
// complete.
class DecisionBuffer {
public:
    static constexpr size_t kCapacity = 32;

    void push(const ControlDecision& decision)
    {
        if (count_ == kCapacity) {
            head_ = next(head_);
            count_--;
            overflowed_ = true;
        }
        entries_[tail_] = decision;
        tail_ = next(tail_);
        count_++;
    }

    bool pop(ControlDecision& out)
    {
        if (count_ == 0) {
            return false;
        }
        out = entries_[head_];
        head_ = next(head_);
        count_--;
        return true;
    }

    size_t size() const { return count_; }
    bool overflowed() const { return overflowed_; }
    void clearOverflow() { overflowed_ = false; }

private:
    static size_t next(size_t index) { return (index + 1) % kCapacity; }

    ControlDecision entries_[kCapacity];
    size_t head_ = 0;
    size_t tail_ = 0;
    size_t count_ = 0;
    bool overflowed_ = false;
};

} // namespace unibrew
