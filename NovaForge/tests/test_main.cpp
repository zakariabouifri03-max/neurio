#include "test_framework.h"

#include <cstring>

namespace nftest {

std::vector<TestCase>& registry() {
    static std::vector<TestCase> r;
    return r;
}

int g_checks = 0;
int g_failures = 0;
int g_currentTestFailures = 0;

void fail(const char* file, int line, const std::string& msg) {
    g_failures++;
    g_currentTestFailures++;
    std::printf("    FAIL %s:%d\n      %s\n", file, line, msg.c_str());
    std::fflush(stdout);
}

int runAll(const std::string& filter) {
    int passed = 0, failed = 0;
    std::printf("NovaForge test suite - %zu tests\n", registry().size());
    std::printf("================================================\n");
    for (auto& t : registry()) {
        if (!filter.empty() && t.name.find(filter) == std::string::npos) continue;
        g_currentTestFailures = 0;
        int checksBefore = g_checks;
        std::printf("[ RUN  ] %s\n", t.name.c_str());
        std::fflush(stdout);
        t.fn();
        if (g_currentTestFailures == 0) {
            std::printf("[  OK  ] %s (%d checks)\n", t.name.c_str(), g_checks - checksBefore);
            passed++;
        } else {
            std::printf("[ FAIL ] %s (%d failures)\n", t.name.c_str(), g_currentTestFailures);
            failed++;
        }
        std::fflush(stdout);
    }
    std::printf("================================================\n");
    std::printf("%d passed, %d failed, %d checks total\n", passed, failed, g_checks);
    return failed == 0 ? 0 : 1;
}

}  // namespace nftest

int main(int argc, char** argv) {
    std::string filter;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a.rfind("--filter=", 0) == 0) filter = a.substr(9);
        else if (a == "--list") {
            for (auto& t : nftest::registry()) std::printf("%s\n", t.name.c_str());
            return 0;
        }
    }
    return nftest::runAll(filter);
}
