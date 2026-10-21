#include "OtaUrlPolicy.h"

#include <cstring>

namespace unibrew {

bool isOtaUrlAllowed(const char* url, const char* allowedPrefix) {
    if (url == nullptr || allowedPrefix == nullptr) {
        return false;
    }
    const size_t prefixLen = std::strlen(allowedPrefix);
    if (prefixLen == 0 || std::strncmp(allowedPrefix, "https://", 8) != 0) {
        return false;
    }
    if (std::strncmp(url, allowedPrefix, prefixLen) != 0) {
        return false;
    }
    for (const char* p = url; *p != '\0'; ++p) {
        const unsigned char c = static_cast<unsigned char>(*p);
        if (c <= 0x20 || c == 0x7F || c == '@' || c == '\\') {
            return false;
        }
    }
    if (std::strstr(url, "..") != nullptr) {
        return false;
    }
    return std::strstr(url + 8, "/api/firmware/") != nullptr;
}

} // namespace unibrew
