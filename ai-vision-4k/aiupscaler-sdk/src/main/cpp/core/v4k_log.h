// Logging shim. Uses logcat on Android, stderr on the host so the exact same
// core sources can run in the unit test binary.
#pragma once

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
