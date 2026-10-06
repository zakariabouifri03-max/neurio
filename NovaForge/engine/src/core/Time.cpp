// NovaForge Engine - core/Time.cpp
#include "core/Time.h"

#include <chrono>
#include <ctime>
#include <cstdio>

namespace nf {

f64 NowSeconds() {
  using clock = std::chrono::steady_clock;
  static const auto start = clock::now();
  return std::chrono::duration<f64>(clock::now() - start).count();
}

std::string TimestampString(bool dateAndTime) {
  std::time_t now = std::time(nullptr);
  std::tm local{};
#if NF_PLATFORM_WINDOWS
  localtime_s(&local, &now);
#else
  localtime_r(&now, &local);
#endif
  char buffer[64];
  if (dateAndTime) {
    snprintf(buffer, sizeof(buffer), "%04d-%02d-%02d %02d:%02d:%02d", local.tm_year + 1900,
             local.tm_mon + 1, local.tm_mday, local.tm_hour, local.tm_min, local.tm_sec);
  } else {
    snprintf(buffer, sizeof(buffer), "%04d-%02d-%02d", local.tm_year + 1900, local.tm_mon + 1,
             local.tm_mday);
  }
  return buffer;
}

} // namespace nf
