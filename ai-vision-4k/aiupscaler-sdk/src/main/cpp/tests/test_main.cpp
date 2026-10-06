#include "v4k_test.h"

#include "../core/v4k_log.h"

namespace v4ktest {
void registerAllTests();  // tests register themselves through static objects
}

int main(int argc, char** argv) {
    const std::string filter = argc > 1 ? argv[1] : std::string();
    int ran = 0;
    for (const v4ktest::TestCase& test : v4ktest::registry()) {
        if (!filter.empty() && std::string(test.name).find(filter) == std::string::npos) continue;
        v4ktest::currentTest() = test.name;
        ++ran;
        std::cout << "[ RUN  ] " << test.name << std::endl;
        test.fn();
    }
    std::cout << "== " << v4ktest::checks() << " checks, " << v4ktest::failures() << " failures, "
              << ran << " cases ==" << std::endl;
    return v4ktest::failures() == 0 ? 0 : 1;
}
