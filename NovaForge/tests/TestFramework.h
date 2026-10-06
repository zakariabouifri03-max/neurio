// NovaForge Engine - tests/TestFramework.h
// Tiny zero-dependency test framework (works on Linux + Windows).
#pragma once

#include <cstdio>
#include <string>
#include <vector>
#include <functional>
#include <cmath>

namespace nftest {

struct TestCase {
  std::string suite;
  std::string name;
  std::function<void()> fn;
};

std::vector<TestCase>& Registry();
int& FailureCount();
int& CheckCount();
bool& Inverted();     // when true, NF_CHECK failures are expected

#define NF_TEST(suite_, name_)                                                       \
  static void NF_TESTFN_##suite_##_##name_();                                        \
  namespace {                                                                        \
  struct NF_TESTREG_##suite_##_##name_ {                                             \
    NF_TESTREG_##suite_##_##name_() {                                                \
      ::nftest::Registry().push_back({#suite_, #name_, NF_TESTFN_##suite_##_##name_});\
    }                                                                                \
  } NF_TESTREGINST_##suite_##_##name_;                                               \
  }                                                                                  \
  static void NF_TESTFN_##suite_##_##name_()

#define NF_CHECK(cond)                                                               \
  do {                                                                               \
    ::nftest::CheckCount()++;                                                        \
    if (!(cond)) {                                                                   \
      ::nftest::FailureCount()++;                                                    \
      printf("  FAIL %s:%d  CHECK(%s)\n", __FILE__, __LINE__, #cond);                \
    }                                                                                \
  } while (0)

#define NF_CHECK_MSG(cond, msg)                                                      \
  do {                                                                               \
    ::nftest::CheckCount()++;                                                        \
    if (!(cond)) {                                                                   \
      ::nftest::FailureCount()++;                                                    \
      printf("  FAIL %s:%d  CHECK(%s)  %s\n", __FILE__, __LINE__, #cond, msg);       \
    }                                                                                \
  } while (0)

#define NF_CHECK_NEAR(a, b, tol)                                                     \
  do {                                                                               \
    ::nftest::CheckCount()++;                                                        \
    double _a = (double)(a), _b = (double)(b);                                       \
    if (!(std::fabs(_a - _b) <= (double)(tol))) {                                    \
      ::nftest::FailureCount()++;                                                    \
      printf("  FAIL %s:%d  CHECK_NEAR(%s, %s) got %g vs %g\n", __FILE__, __LINE__,  \
             #a, #b, _a, _b);                                                        \
    }                                                                                \
  } while (0)

int RunAll(const char* filter = nullptr);

} // namespace nftest
