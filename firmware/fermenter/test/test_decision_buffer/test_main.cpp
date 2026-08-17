#include <unity.h>

#include "DecisionBuffer.h"

using unibrew::ControlDecision;
using unibrew::ControlOutput;
using unibrew::DecisionBuffer;
using unibrew::DecisionReason;

namespace {
ControlDecision make(uint32_t elapsedMs) {
    ControlDecision d;
    d.to = ControlOutput::COOLING;
    d.reason = DecisionReason::ABOVE_DEADBAND;
    d.elapsedMs = elapsedMs;
    return d;
}
}

void setUp(void) {}
void tearDown(void) {}

void test_a_new_buffer_is_empty(void) {
    DecisionBuffer buf;
    ControlDecision out;
    TEST_ASSERT_EQUAL_UINT32(0, buf.size());
    TEST_ASSERT_FALSE(buf.pop(out));
    TEST_ASSERT_FALSE(buf.overflowed());
}

void test_pops_in_the_order_pushed(void) {
    DecisionBuffer buf;
    buf.push(make(1));
    buf.push(make(2));
    buf.push(make(3));

    ControlDecision out;
    TEST_ASSERT_TRUE(buf.pop(out));
    TEST_ASSERT_EQUAL_UINT32(1, out.elapsedMs);
    TEST_ASSERT_TRUE(buf.pop(out));
    TEST_ASSERT_EQUAL_UINT32(2, out.elapsedMs);
    TEST_ASSERT_TRUE(buf.pop(out));
    TEST_ASSERT_EQUAL_UINT32(3, out.elapsedMs);
    TEST_ASSERT_FALSE(buf.pop(out));
}

void test_holds_capacity_entries(void) {
    DecisionBuffer buf;
    for (uint32_t i = 0; i < DecisionBuffer::kCapacity; i++) {
        buf.push(make(i));
    }
    TEST_ASSERT_EQUAL_UINT32(DecisionBuffer::kCapacity, buf.size());
    TEST_ASSERT_FALSE(buf.overflowed());
}

// A long outage must not cost the newest decisions - those are the ones
// closest to whatever the brewer is looking at when the link comes back.
void test_overflow_drops_the_oldest(void) {
    DecisionBuffer buf;
    for (uint32_t i = 0; i < DecisionBuffer::kCapacity + 3; i++) {
        buf.push(make(i));
    }
    TEST_ASSERT_EQUAL_UINT32(DecisionBuffer::kCapacity, buf.size());
    TEST_ASSERT_TRUE(buf.overflowed());

    ControlDecision out;
    TEST_ASSERT_TRUE(buf.pop(out));
    TEST_ASSERT_EQUAL_UINT32(3, out.elapsedMs);   // 0, 1 and 2 were dropped
}

void test_clear_overflow_resets_the_flag(void) {
    DecisionBuffer buf;
    for (uint32_t i = 0; i < DecisionBuffer::kCapacity + 1; i++) {
        buf.push(make(i));
    }
    TEST_ASSERT_TRUE(buf.overflowed());
    buf.clearOverflow();
    TEST_ASSERT_FALSE(buf.overflowed());
}

void test_can_be_refilled_after_draining(void) {
    DecisionBuffer buf;
    buf.push(make(1));
    ControlDecision out;
    buf.pop(out);
    buf.push(make(2));

    TEST_ASSERT_EQUAL_UINT32(1, buf.size());
    TEST_ASSERT_TRUE(buf.pop(out));
    TEST_ASSERT_EQUAL_UINT32(2, out.elapsedMs);
}

// Draining is not all-or-nothing: a publish can fail partway through, and the
// entries that did not go out have to stay queued in order.
void test_a_partial_drain_leaves_the_rest_in_order(void) {
    DecisionBuffer buf;
    buf.push(make(1));
    buf.push(make(2));
    buf.push(make(3));

    ControlDecision out;
    buf.pop(out);
    TEST_ASSERT_EQUAL_UINT32(2, buf.size());
    TEST_ASSERT_TRUE(buf.pop(out));
    TEST_ASSERT_EQUAL_UINT32(2, out.elapsedMs);
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_a_new_buffer_is_empty);
    RUN_TEST(test_pops_in_the_order_pushed);
    RUN_TEST(test_holds_capacity_entries);
    RUN_TEST(test_overflow_drops_the_oldest);
    RUN_TEST(test_clear_overflow_resets_the_flag);
    RUN_TEST(test_can_be_refilled_after_draining);
    RUN_TEST(test_a_partial_drain_leaves_the_rest_in_order);
    return UNITY_END();
}
