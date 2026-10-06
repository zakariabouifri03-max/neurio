// NovaForge Engine - core/Base.h
// Fundamental types, platform detection and asserts.
#pragma once

#include <cstdint>
#include <cstddef>
#include <cstdio>
#include <cstring>
#include <cmath>
#include <cassert>
#include <string>
#include <string_view>
#include <vector>
#include <memory>
#include <functional>
#include <algorithm>

// ----------------------------------------------------------------------------- platform
#if defined(_WIN32) || defined(_WIN64) || defined(__MINGW32__)
#  ifndef NF_PLATFORM_WINDOWS
#    define NF_PLATFORM_WINDOWS 1
#  endif
#elif defined(__linux__)
#  ifndef NF_PLATFORM_LINUX
#    define NF_PLATFORM_LINUX 1
#  endif
#elif defined(__APPLE__)
#  ifndef NF_PLATFORM_MACOS
#    define NF_PLATFORM_MACOS 1
#  endif
#endif

#ifndef NF_PLATFORM_WINDOWS
#  define NF_PLATFORM_WINDOWS 0
#endif
#ifndef NF_PLATFORM_LINUX
#  define NF_PLATFORM_LINUX 0
#endif

#if NF_PLATFORM_WINDOWS
#  define NF_EXPORT __declspec(dllexport)
#  define NF_IMPORT __declspec(dllimport)
#else
#  define NF_EXPORT __attribute__((visibility("default")))
#endif

#ifndef NF_DEBUG
#  ifdef NDEBUG
#    define NF_DEBUG 0
#  else
#    define NF_DEBUG 1
#  endif
#endif

namespace nf {

using u8 = uint8_t;
using u16 = uint16_t;
using u32 = uint32_t;
using u64 = uint64_t;
using i8 = int8_t;
using i16 = int16_t;
using i32 = int32_t;
using i64 = int64_t;
using f32 = float;
using f64 = double;
using usize = size_t;

using EntityId = u64;
using AssetId = u32;
using ComponentId = u32;

constexpr EntityId kInvalidEntity = 0;

// ----------------------------------------------------------------------------- macros
#define NF_UNUSED(x) (void)(x)
#define NF_STRINGIFY_IMPL(x) #x
#define NF_STRINGIFY(x) NF_STRINGIFY_IMPL(x)
#define NF_CONCAT_IMPL(a, b) a##b
#define NF_CONCAT(a, b) NF_CONCAT_IMPL(a, b)

// Assertions are friendlier in the editor: they log through the engine logger.
namespace detail { void assertFailed(const char* expr, const char* file, int line); }
#define NF_ASSERT(expr)                                                        \
  do {                                                                         \
    if (!(expr)) {                                                             \
      ::nf::detail::assertFailed(#expr, __FILE__, __LINE__);                    \
      assert(expr);                                                            \
    }                                                                          \
  } while (0)

#define NF_VERIFY(expr) NF_ASSERT(expr)
#define NF_TODO(msg) ::nf::detail::todoStub(msg, __FILE__, __LINE__)
#define NF_NONCOPYABLE(klass)                                                  \
  klass(const klass&) = delete;                                                \
  klass& operator=(const klass&) = delete;

} // namespace nf
