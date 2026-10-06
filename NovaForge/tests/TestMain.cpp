// NovaForge Engine - tests/TestMain.cpp
#include "TestFramework.h"
#include "core/Log.h"

namespace nftest {

std::vector<TestCase>& Registry() { static std::vector<TestCase> r; return r; }
int& FailureCount() { static int f = 0; return f; }
int& CheckCount() { static int c = 0; return c; }
bool& Inverted() { static bool b = false; return b; }

int RunAll(const char* filter) {
  int failedSuites = 0;
  std::string current;
  printf("NovaForge Engine test suite\n===========================\n");
  for (auto& tc : Registry()) {
    if (filter && tc.suite.find(filter) == std::string::npos && tc.name.find(filter) == std::string::npos)
      continue;
    if (tc.suite != current) {
      current = tc.suite;
      printf("\n[%s]\n", current.c_str());
    }
    int before = FailureCount();
    printf("  %-46s", tc.name.c_str());
    fflush(stdout);
    tc.fn();
    if (FailureCount() == before) printf("ok\n");
    else { printf("FAILED\n"); failedSuites++; }
  }
  printf("\n===========================\n%d checks, %d failures\n", CheckCount(), FailureCount());
  if (FailureCount() == 0) printf("ALL TESTS PASSED\n");
  return FailureCount() == 0 ? 0 : 1;
}

} // namespace nftest

int main(int argc, char** argv) {
#if NF_PLATFORM_LINUX
  nf::Log::Get().SetMinLevel(nf::LogLevel::Error);   // keep test output readable
#else
  nf::Log::Get().SetMinLevel(nf::LogLevel::Warning);
#endif
  const char* filter = argc > 1 ? argv[1] : nullptr;
  return nftest::RunAll(filter);
}
