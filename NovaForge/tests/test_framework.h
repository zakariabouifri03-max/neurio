// NovaForge Engine - tiny test framework (no external dependencies,
// so tests run on a clean machine with nothing installed).
#pragma once
#include <cmath>
#include <cstdio>
#include <functional>
#include <string>
#include <vector>

namespace nftest {

struct TestCase {
    std::string name;
    std::string file;
    void (*fn)();
};

std::vector<TestCase>& registry();
struct Registrar {
    Registrar(const char* name, const char* file, void (*fn)()) {
        registry().push_back({name, file, fn});
    }
};

extern int g_checks;
extern int g_failures;
extern int g_currentTestFailures;

void fail(const char* file, int line, const std::string& msg);
int runAll(const std::string& filter);

}  // namespace nftest

#define NF_TEST(name)                                                        \
    static void name();                                                      \
    static ::nftest::Registrar nf_reg_##name(#name, __FILE__, name);         \
    static void name()

#define CHECK(cond)                                                          \
    do {                                                                     \
        ::nftest::g_checks++;                                                \
        if (!(cond)) ::nftest::fail(__FILE__, __LINE__, "CHECK failed: " #cond); \
    } while (0)

#define CHECK_MSG(cond, msg)                                                 \
    do {                                                                     \
        ::nftest::g_checks++;                                                \
        if (!(cond)) ::nftest::fail(__FILE__, __LINE__, std::string("CHECK failed: " #cond " | ") + (msg)); \
    } while (0)

#define CHECK_EQ(a, b)                                                       \
    do {                                                                     \
        ::nftest::g_checks++;                                                \
        auto va = (a);                                                       \
        auto vb = (b);                                                       \
        if (!(va == vb)) ::nftest::fail(__FILE__, __LINE__, "CHECK_EQ failed: " #a " == " #b); \
    } while (0)

#define CHECK_NEAR(a, b, eps)                                                \
    do {                                                                     \
        ::nftest::g_checks++;                                                \
        double va = (double)(a), vb = (double)(b);                           \
        if (std::fabs(va - vb) > (eps))                                      \
            ::nftest::fail(__FILE__, __LINE__,                               \
                           "CHECK_NEAR failed: " #a " (" + std::to_string(va) + \
                               ") != " #b " (" + std::to_string(vb) + ")");  \
    } while (0)
