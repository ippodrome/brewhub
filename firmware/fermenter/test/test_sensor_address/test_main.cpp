#include <unity.h>
#include <cstring>

#include "SensorAddress.h"

using namespace unibrew;

void setUp(void) {}
void tearDown(void) {}

void test_formats_address_as_uppercase_hex(void) {
    uint8_t address[8] = {0x28, 0xFF, 0x64, 0x1F, 0x04, 0x17, 0x03, 0x3A};
    char out[kSensorAddressHexLength + 1];
    formatSensorAddress(address, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("28FF641F0417033A", out);
}

void test_format_writes_empty_string_on_undersized_buffer(void) {
    uint8_t address[8] = {0x28, 0xFF, 0x64, 0x1F, 0x04, 0x17, 0x03, 0x3A};
    char out[4] = {'X', 'X', 'X', 'X'};
    formatSensorAddress(address, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("", out);
}

void test_parses_valid_hex_back_to_bytes(void) {
    uint8_t out[8];
    bool ok = parseSensorAddress("28FF641F0417033A", out);
    TEST_ASSERT_TRUE(ok);
    uint8_t expected[8] = {0x28, 0xFF, 0x64, 0x1F, 0x04, 0x17, 0x03, 0x3A};
    TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, out, 8);
}

void test_parse_accepts_lowercase_hex(void) {
    uint8_t out[8];
    bool ok = parseSensorAddress("28ff641f0417033a", out);
    TEST_ASSERT_TRUE(ok);
    uint8_t expected[8] = {0x28, 0xFF, 0x64, 0x1F, 0x04, 0x17, 0x03, 0x3A};
    TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, out, 8);
}

void test_parse_rejects_wrong_length(void) {
    uint8_t out[8];
    TEST_ASSERT_FALSE(parseSensorAddress("28FF", out));
    TEST_ASSERT_FALSE(parseSensorAddress("28FF641F0417033A00", out));
}

void test_parse_rejects_non_hex_characters(void) {
    uint8_t out[8];
    TEST_ASSERT_FALSE(parseSensorAddress("28FF641F0417033G", out));
}

void test_parse_rejects_null(void) {
    uint8_t out[8];
    TEST_ASSERT_FALSE(parseSensorAddress(nullptr, out));
}

void test_matches_true_for_same_address(void) {
    uint8_t address[8] = {0x28, 0xFF, 0x64, 0x1F, 0x04, 0x17, 0x03, 0x3A};
    TEST_ASSERT_TRUE(sensorAddressMatches(address, "28FF641F0417033A"));
}

void test_matches_is_case_insensitive(void) {
    uint8_t address[8] = {0x28, 0xFF, 0x64, 0x1F, 0x04, 0x17, 0x03, 0x3A};
    TEST_ASSERT_TRUE(sensorAddressMatches(address, "28ff641f0417033a"));
}

void test_matches_false_for_different_address(void) {
    uint8_t address[8] = {0x28, 0xFF, 0x64, 0x1F, 0x04, 0x17, 0x03, 0x3A};
    TEST_ASSERT_FALSE(sensorAddressMatches(address, "28FF641F0417033B"));
}

void test_matches_false_for_malformed_hex(void) {
    uint8_t address[8] = {0x28, 0xFF, 0x64, 0x1F, 0x04, 0x17, 0x03, 0x3A};
    TEST_ASSERT_FALSE(sensorAddressMatches(address, "not-hex"));
}

void test_format_then_parse_roundtrips(void) {
    uint8_t original[8] = {0x10, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88};
    char hex[kSensorAddressHexLength + 1];
    formatSensorAddress(original, hex, sizeof(hex));

    uint8_t parsed[8];
    TEST_ASSERT_TRUE(parseSensorAddress(hex, parsed));
    TEST_ASSERT_EQUAL_UINT8_ARRAY(original, parsed, 8);
}

int main(int argc, char** argv) {
    UNITY_BEGIN();
    RUN_TEST(test_formats_address_as_uppercase_hex);
    RUN_TEST(test_format_writes_empty_string_on_undersized_buffer);
    RUN_TEST(test_parses_valid_hex_back_to_bytes);
    RUN_TEST(test_parse_accepts_lowercase_hex);
    RUN_TEST(test_parse_rejects_wrong_length);
    RUN_TEST(test_parse_rejects_non_hex_characters);
    RUN_TEST(test_parse_rejects_null);
    RUN_TEST(test_matches_true_for_same_address);
    RUN_TEST(test_matches_is_case_insensitive);
    RUN_TEST(test_matches_false_for_different_address);
    RUN_TEST(test_matches_false_for_malformed_hex);
    RUN_TEST(test_format_then_parse_roundtrips);
    return UNITY_END();
}
