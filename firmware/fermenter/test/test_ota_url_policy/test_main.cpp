#include <unity.h>

#include "OtaUrlPolicy.h"

using namespace unibrew;

static const char* kPrefix = "https://192.168.1.10:8443";

void setUp(void) {}
void tearDown(void) {}

void test_accepts_backend_download_url(void) {
    TEST_ASSERT_TRUE(isOtaUrlAllowed("https://192.168.1.10:8443/api/firmware/12/download?token=abc", kPrefix));
}

void test_accepts_host_only_default_prefix(void) {
    TEST_ASSERT_TRUE(isOtaUrlAllowed("https://192.168.1.10:8443/api/firmware/1/download?token=x", "https://192.168.1.10:"));
}

void test_rejects_other_host(void) {
    TEST_ASSERT_FALSE(isOtaUrlAllowed("https://evil.example/api/firmware/1/download", kPrefix));
    TEST_ASSERT_FALSE(isOtaUrlAllowed("https://192.168.1.100:8443/api/firmware/1/download", "https://192.168.1.10:"));
}

void test_rejects_plain_http(void) {
    TEST_ASSERT_FALSE(isOtaUrlAllowed("http://192.168.1.10:8443/api/firmware/1/download", kPrefix));
    TEST_ASSERT_FALSE(isOtaUrlAllowed("http://192.168.1.10:8443/api/firmware/1/download", "http://192.168.1.10:8443"));
}

void test_rejects_userinfo_trick(void) {
    TEST_ASSERT_FALSE(isOtaUrlAllowed("https://192.168.1.10:8443@evil.example/api/firmware/1/download", "https://192.168.1.10:"));
}

void test_rejects_path_traversal_and_other_paths(void) {
    TEST_ASSERT_FALSE(isOtaUrlAllowed("https://192.168.1.10:8443/api/firmware/../other", kPrefix));
    TEST_ASSERT_FALSE(isOtaUrlAllowed("https://192.168.1.10:8443/static/evil.bin", kPrefix));
}

void test_rejects_whitespace_and_backslash(void) {
    TEST_ASSERT_FALSE(isOtaUrlAllowed("https://192.168.1.10:8443/api/firmware/1 x", kPrefix));
    TEST_ASSERT_FALSE(isOtaUrlAllowed("https://192.168.1.10:8443\\@evil/api/firmware/1", kPrefix));
}

void test_rejects_null_and_empty(void) {
    TEST_ASSERT_FALSE(isOtaUrlAllowed(nullptr, kPrefix));
    TEST_ASSERT_FALSE(isOtaUrlAllowed("https://192.168.1.10:8443/api/firmware/1", nullptr));
    TEST_ASSERT_FALSE(isOtaUrlAllowed("https://192.168.1.10:8443/api/firmware/1", ""));
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_accepts_backend_download_url);
    RUN_TEST(test_accepts_host_only_default_prefix);
    RUN_TEST(test_rejects_other_host);
    RUN_TEST(test_rejects_plain_http);
    RUN_TEST(test_rejects_userinfo_trick);
    RUN_TEST(test_rejects_path_traversal_and_other_paths);
    RUN_TEST(test_rejects_whitespace_and_backslash);
    RUN_TEST(test_rejects_null_and_empty);
    return UNITY_END();
}
