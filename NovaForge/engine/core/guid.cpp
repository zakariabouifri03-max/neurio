#include "core/guid.h"

#include <chrono>
#include <cstdio>
#include <random>
#include <thread>

namespace nf {

static std::mt19937_64& rng() {
    static thread_local std::mt19937_64 g([] {
        std::random_device rd;
        uint64_t seed = ((uint64_t)rd() << 32) ^ rd();
        seed ^= (uint64_t)std::chrono::steady_clock::now().time_since_epoch().count();
        seed ^= (uint64_t)std::hash<std::thread::id>{}(std::this_thread::get_id());
        return seed;
    }());
    return g;
}

std::string generateGuid() {
    uint64_t a = rng()();
    uint64_t b = rng()();
    char buf[33];
    snprintf(buf, sizeof(buf), "%016llx%016llx", (unsigned long long)a, (unsigned long long)b);
    return std::string(buf, 32);
}

uint64_t hashString(const char* s, size_t len) {
    // FNV-1a 64
    uint64_t h = 1469598103934665603ULL;
    for (size_t i = 0; i < len; ++i) {
        h ^= (unsigned char)s[i];
        h *= 1099511628211ULL;
    }
    return h;
}

}  // namespace nf
