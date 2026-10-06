// Logging shim. Uses logcat on Android, stderr on the host so the exact same
// core sources can run in the unit test binary.
#pragma once

// V4K_DEBUG_CHECKS is a build option (see CMakeLists.txt and
// aiupscaler-sdk/build.gradle.kts). It must actually do something, so it gates
// the verbose channel: V4K_LOGV is a real log line in a debug build and a no-op
// in a release build, and kDebugChecks is reported by Engine::statusJson() so a
// device can tell you which kind of build it is running.
//
// The CMake side always defines it as 0 or 1 (that is the convention this file
// documents), so the test is on the value, not on defined(). A translation unit
// compiled outside CMake without the definition gets the release behaviour.
#if V4K_DEBUG_CHECKS
constexpr bool kDebugChecks = true;
#else
constexpr bool kDebugChecks = false;
#endif

#if defined(__ANDROID__)
#include <android/log.h>
#define V4K_LOG_TAG "AiVision4K"
#define V4K_LOGI(...) __android_log_print(ANDROID_LOG_INFO, V4K_LOG_TAG, __VA_ARGS__)
#define V4K_LOGW(...) __android_log_print(ANDROID_LOG_WARN, V4K_LOG_TAG, __VA_ARGS__)
#define V4K_LOGE(...) __android_log_print(ANDROID_LOG_ERROR, V4K_LOG_TAG, __VA_ARGS__)
#else
#include <cstdio>
#define V4K_LOGI(...)                       \
    do {                                    \
        std::fprintf(stderr, "[I] ");       \
        std::fprintf(stderr, __VA_ARGS__);  \
        std::fprintf(stderr, "\n");         \
    } while (0)
#define V4K_LOGW(...)                       \
    do {                                    \
        std::fprintf(stderr, "[W] ");       \
        std::fprintf(stderr, __VA_ARGS__);  \
        std::fprintf(stderr, "\n");         \
    } while (0)
#define V4K_LOGE(...)                       \
    do {                                    \
        std::fprintf(stderr, "[E] ");       \
        std::fprintf(stderr, __VA_ARGS__);  \
        std::fprintf(stderr, "\n");         \
    } while (0)
#endif

#if V4K_DEBUG_CHECKS
#define V4K_LOGV(...) V4K_LOGI(__VA_ARGS__)
#else
#define V4K_LOGV(...) \
    do {              \
    } while (0)
#endif
