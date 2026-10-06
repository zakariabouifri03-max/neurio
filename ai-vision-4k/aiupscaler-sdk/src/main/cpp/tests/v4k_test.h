// Tiny test harness.
//
// The engine's policy/format/image code has to be verifiable without a device:
// tools/run-native-tests.sh compiles cpp/core + cpp/ai + cpp/tests with the host
// compiler and runs the suite. This header deliberately has no dependency
// outside the standard library, so it also builds on the NDK toolchain when the
// tests are enabled there (V4K_BUILD_TESTS).
#pragma once

#include <cmath>
#include <cstdlib>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace v4ktest {

struct TestCase {
    const char* name;
    void (*fn)();
};

inline std::vector<TestCase>& registry() {
    static std::vector<TestCase> tests;
    return tests;
}

inline int& failures() {
    static int value = 0;
    return value;
}

inline int& checks() {
    static int value = 0;
    return value;
}

inline const char*& currentTest() {
    static const char* name = "";
    return name;
}

inline void reportFailure(const char* file, int line, const std::string& message) {
    ++failures();
    std::cerr << "  FAIL " << (currentTest() == nullptr ? "" : currentTest()) << " (" << file << ":"
              << line << ")\n        " << message << "\n";
}

template <typename T>
std::string describe(const T& value) {
    std::ostringstream stream;
    stream << value;
    return stream.str();
}

inline std::string describe(bool value) { return value ? "true" : "false"; }

struct Registrar {
    Registrar(const char* name, void (*fn)()) { registry().push_back(TestCase{name, fn}); }
};

}  // namespace v4ktest

#define V4K_TEST(name)                                                                  \
    static void name();                                                                 \
    static const v4ktest::Registrar v4k_registrar_##name(#name, &name);                 \
    static void name()

#define CHECK(condition)                                                                \
    do {                                                                                \
        ++v4ktest::checks();                                                            \
        if (!(condition)) {                                                             \
            v4ktest::reportFailure(__FILE__, __LINE__, "CHECK(" #condition ")");        \
        }                                                                               \
    } while (false)

#define CHECK_MSG(condition, message)                                                   \
    do {                                                                                \
        ++v4ktest::checks();                                                            \
        if (!(condition)) {                                                             \
            v4ktest::reportFailure(__FILE__, __LINE__,                                  \
                                   std::string("CHECK(" #condition ") - ") + (message)); \
        }                                                                               \
    } while (false)

#define CHECK_EQ(actual, expected)                                                      \
    do {                                                                                \
        ++v4ktest::checks();                                                            \
        const auto& v4k_a = (actual);                                                   \
        const auto& v4k_b = (expected);                                                 \
        if (!(v4k_a == v4k_b)) {                                                        \
            v4ktest::reportFailure(__FILE__, __LINE__,                                  \
                                   std::string(#actual " == " #expected "\n        got: ") + \
                                       v4ktest::describe(v4k_a) + "\n        expected: " + \
                                       v4ktest::describe(v4k_b));                      \
        }                                                                               \
    } while (false)

#define CHECK_NEAR(actual, expected, tolerance)                                         \
    do {                                                                                \
        ++v4ktest::checks();                                                            \
        const double v4k_a = static_cast<double>(actual);                               \
        const double v4k_b = static_cast<double>(expected);                             \
        if (!(std::fabs(v4k_a - v4k_b) <= (tolerance))) {                               \
            v4ktest::reportFailure(__FILE__, __LINE__,                                  \
                                   std::string(#actual " ~= " #expected "\n        got: ") + \
                                       v4ktest::describe(v4k_a) + "\n        expected: " + \
                                       v4ktest::describe(v4k_b) + " +/- " +             \
                                       v4ktest::describe(tolerance));                   \
        }                                                                               \
    } while (false)

// Integer/string forms: older tests use these names and they print better than
// the generic CHECK_EQ (no operator<< needed for enums).
#define CHECK_EQ_INT(actual, expected)                                                  \
    do {                                                                                \
        ++v4ktest::checks();                                                            \
        const long long v4k_a = static_cast<long long>(actual);                         \
        const long long v4k_b = static_cast<long long>(expected);                       \
        if (v4k_a != v4k_b) {                                                           \
            v4ktest::reportFailure(__FILE__, __LINE__,                                  \
                                   std::string(#actual " == " #expected "\n        got: ") + \
                                       std::to_string(v4k_a) + "\n        expected: " +   \
                                       std::to_string(v4k_b));                          \
        }                                                                               \
    } while (false)

#define CHECK_EQ_STR(actual, expected)                                                  \
    do {                                                                                \
        ++v4ktest::checks();                                                            \
        const std::string v4k_a = (actual);                                             \
        const std::string v4k_b = (expected);                                           \
        if (v4k_a != v4k_b) {                                                           \
            v4ktest::reportFailure(__FILE__, __LINE__,                                  \
                                   std::string(#actual " == " #expected "\n        got: ") + \
                                       v4k_a + "\n        expected: " + v4k_b);        \
        }                                                                               \
    } while (false)

#define CHECK_GT(a, b)                                                                  \
    do {                                                                                \
        ++v4ktest::checks();                                                            \
        if (!((a) > (b))) {                                                             \
            v4ktest::reportFailure(__FILE__, __LINE__, "CHECK_GT(" #a " > " #b ")");     \
        }                                                                               \
    } while (false)

#define CHECK_LT(a, b)                                                                  \
    do {                                                                                \
        ++v4ktest::checks();                                                            \
        if (!((a) < (b))) {                                                             \
            v4ktest::reportFailure(__FILE__, __LINE__, "CHECK_LT(" #a " < " #b ")");     \
        }                                                                               \
    } while (false)

// Records a failure with a free-form message (used when a helper returned false
// and the reason is in a std::string).
#define V4K_FAIL(message)                                                               \
    do {                                                                                \
        ++v4ktest::checks();                                                            \
        v4ktest::reportFailure(__FILE__, __LINE__, (message));                          \
    } while (false)

#define CHECK_STR_CONTAINS(haystack, needle)                                            \
    do {                                                                                \
        ++v4ktest::checks();                                                            \
        const std::string v4k_h = (haystack);                                           \
        if (v4k_h.find(needle) == std::string::npos) {                                  \
            v4ktest::reportFailure(__FILE__, __LINE__,                                  \
                                   std::string("expected \"") + v4k_h +                     \
                                       "\" to contain \"" + (needle) + "\"");           \
        }                                                                               \
    } while (false)
