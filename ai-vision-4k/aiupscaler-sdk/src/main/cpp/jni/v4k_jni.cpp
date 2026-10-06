// JNI bridge: com.aivision4k.sdk.NativeBridge <-> v4k::Engine.
//
// Design rules for this layer:
//
//   * It owns exactly one v4k::Engine. The engine is not thread safe, so every
//     entry point takes the same mutex; the Kotlin SDK additionally funnels its
//     calls through one dispatcher, which is what a game wants anyway (a single
//     thread that owns the render loop).
//   * Structured data crosses as JSON strings (see core/v4k_json.h): device
//     capabilities in, status/metrics/session state out. Kotlin parses with
//     org.json, so neither side needs marshalling structs and the protocol is
//     easy to log.
//   * Errors are returned as a string, success as null. That keeps the Kotlin
//     side to one idiom: `val error = NativeBridge.initialise(json)` and it can
//     always show the native message verbatim in the UI.
//   * Frames cross as raw 64-bit handles (VkImage/VkImageView/VkDevice...), so
//     the per-frame path performs no allocation, no string conversion and no
//     Java callbacks.
//
// The class and method table below is registered in JNI_OnLoad, which makes a
// rename in Kotlin a load-time failure instead of a mysterious
// UnsatisfiedLinkError on first use.
#include <jni.h>

#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

#include "../core/v4k_common.h"
#include "../core/v4k_json.h"
#include "../core/v4k_log.h"
#include "../core/v4k_thermal.h"
#include "../sdk/v4k_engine.h"

namespace {

constexpr const char* kBridgeClass = "com/aivision4k/sdk/NativeBridge";

v4k::Engine& engine() {
    static v4k::Engine instance;
    return instance;
}

std::mutex& engineMutex() {
    static std::mutex mutex;
    return mutex;
}

std::string toStdString(JNIEnv* env, jstring value) {
    if (value == nullptr) return std::string();
    const char* chars = env->GetStringUTFChars(value, nullptr);
    if (chars == nullptr) return std::string();
    std::string result(chars);
    env->ReleaseStringUTFChars(value, chars);
    return result;
}

// Returns a Java string, or nullptr when `message` is empty (success).
jstring errorOrNull(JNIEnv* env, const std::string& message) {
    if (message.empty()) return nullptr;
    return env->NewStringUTF(message.c_str());
}

jstring toJavaString(JNIEnv* env, const std::string& value) {
    return env->NewStringUTF(value.c_str());
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
jstring nativeInitialise(JNIEnv* env, jclass, jstring androidCapsJson) {
    std::lock_guard<std::mutex> lock(engineMutex());
    std::string error;
    if (!engine().initialise(toStdString(env, androidCapsJson), &error)) {
        return errorOrNull(env, error);
    }
    return nullptr;
}

void nativeShutdown(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(engineMutex());
    engine().shutdown();
}

jboolean nativeIsInitialised(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(engineMutex());
    return engine().initialised() ? JNI_TRUE : JNI_FALSE;
}

// ---------------------------------------------------------------------------
// Device + compatibility
// ---------------------------------------------------------------------------
jstring nativeUpdateAndroidCaps(JNIEnv* env, jclass, jstring androidCapsJson) {
    std::lock_guard<std::mutex> lock(engineMutex());
    std::string error;
    if (!engine().updateAndroidCaps(toStdString(env, androidCapsJson), &error)) {
        return errorOrNull(env, error);
    }
    return nullptr;
}

jstring nativeReprobeDevice(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> lock(engineMutex());
    std::string error;
    if (!engine().reprobeDevice(&error)) return errorOrNull(env, error);
    return nullptr;
}

jstring nativeDeviceJson(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> lock(engineMutex());
    return toJavaString(env, engine().deviceJson());
}

jstring nativeCompatibilityJson(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> lock(engineMutex());
    return toJavaString(env, engine().compatibilityJson());
}

void nativeSetIntegration(JNIEnv*, jclass, jint kind) {
    std::lock_guard<std::mutex> lock(engineMutex());
    engine().setIntegration(static_cast<v4k::IntegrationKind>(kind));
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
jstring nativeSetProfileJson(JNIEnv* env, jclass, jstring profileJson) {
    std::lock_guard<std::mutex> lock(engineMutex());
    std::string error;
    if (!engine().setProfileJson(toStdString(env, profileJson), &error)) {
        return errorOrNull(env, error);
    }
    return nullptr;
}

jstring nativeProfileJson(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> lock(engineMutex());
    return toJavaString(env, engine().profileJson());
}

jstring nativePresetsJson(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> lock(engineMutex());
    return toJavaString(env, engine().presetsJson());
}

// ---------------------------------------------------------------------------
// Thermal + monitoring
// ---------------------------------------------------------------------------
void nativeUpdateThermal(JNIEnv*, jclass, jint platformStatus, jfloat batteryTempC,
                         jfloat averageFrameTimeMs, jfloat targetFrameTimeMs,
                         jboolean thermalGuardEnabled, jlong nowMs) {
    v4k::ThermalInput input;
    input.platformStatus = platformStatus;
    input.batteryTempC = batteryTempC;
    // Android exposes no SoC temperature to normal apps; leaving it at 0 keeps
    // the governor on the numbers that really exist.
    input.socTempC = 0.0f;
    input.averageFrameTimeMs = averageFrameTimeMs;
    input.targetFrameTimeMs = targetFrameTimeMs;
    input.thermalGuardEnabled = thermalGuardEnabled == JNI_TRUE;
    input.nowMs = static_cast<int64_t>(nowMs);

    std::lock_guard<std::mutex> lock(engineMutex());
    engine().updateThermal(input);
}

void nativeAddFrameSample(JNIEnv*, jclass, jdouble frameTimeMs, jlong nowMs, jdouble upscalerMs) {
    std::lock_guard<std::mutex> lock(engineMutex());
    engine().addFrameSample(frameTimeMs, static_cast<int64_t>(nowMs), upscalerMs);
}

jstring nativeStatusJson(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> lock(engineMutex());
    return toJavaString(env, engine().statusJson());
}

jstring nativeMetricsJson(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> lock(engineMutex());
    return toJavaString(env, engine().metricsJson());
}

// ---------------------------------------------------------------------------
// Model manager
// ---------------------------------------------------------------------------
jstring nativeInstallModelBytes(JNIEnv* env, jclass, jbyteArray bytes) {
    if (bytes == nullptr) return errorOrNull(env, "no model bytes");
    const jsize length = env->GetArrayLength(bytes);
    std::vector<uint8_t> data(static_cast<size_t>(length));
    if (length > 0) {
        env->GetByteArrayRegion(bytes, 0, length, reinterpret_cast<jbyte*>(data.data()));
    }
    std::lock_guard<std::mutex> lock(engineMutex());
    std::string error;
    if (!engine().installModelBytes(data, &error)) return errorOrNull(env, error);
    return nullptr;
}

jstring nativeInstallModelFile(JNIEnv* env, jclass, jstring path) {
    std::lock_guard<std::mutex> lock(engineMutex());
    std::string error;
    if (!engine().installModelFile(toStdString(env, path), &error)) {
        return errorOrNull(env, error);
    }
    return nullptr;
}

void nativeRemoveModel(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(engineMutex());
    engine().removeModel();
}

jstring nativeModelJson(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> lock(engineMutex());
    return toJavaString(env, engine().modelJson());
}

// ---------------------------------------------------------------------------
// Sessions (all handles are raw Vulkan objects owned by the caller)
// ---------------------------------------------------------------------------
jstring nativeStartSession(JNIEnv* env, jclass, jlong instance, jlong physicalDevice,
                           jlong device, jint computeQueueFamily, jint graphicsQueueFamily,
                           jlong computeQueue, jlong graphicsQueue, jint inputWidth,
                           jint inputHeight, jint outputWidth, jint outputHeight,
                           jboolean temporal, jboolean denoise, jboolean antiAliasing,
                           jfloat sharpening, jfloat noiseReduction, jboolean neural,
                           jlong maxWorkingBytes) {
    v4k::DeviceHandles handles;
    handles.instance = static_cast<uint64_t>(instance);
    handles.physicalDevice = static_cast<uint64_t>(physicalDevice);
    handles.device = static_cast<uint64_t>(device);
    handles.computeQueueFamily = static_cast<uint32_t>(computeQueueFamily);
    handles.graphicsQueueFamily = static_cast<uint32_t>(graphicsQueueFamily);
    handles.computeQueue = static_cast<uint64_t>(computeQueue);
    handles.graphicsQueue = static_cast<uint64_t>(graphicsQueue);

    v4k::SessionDesc desc;
    desc.inputWidth = static_cast<uint32_t>(inputWidth);
    desc.inputHeight = static_cast<uint32_t>(inputHeight);
    desc.outputWidth = static_cast<uint32_t>(outputWidth);
    desc.outputHeight = static_cast<uint32_t>(outputHeight);
    desc.temporal = temporal == JNI_TRUE;
    desc.denoise = denoise == JNI_TRUE;
    desc.antiAliasing = antiAliasing == JNI_TRUE;
    desc.sharpening = sharpening;
    desc.noiseReduction = noiseReduction;
    desc.neural = neural == JNI_TRUE;
    desc.maxWorkingBytes = static_cast<uint64_t>(maxWorkingBytes);

    std::lock_guard<std::mutex> lock(engineMutex());
    std::string error;
    if (!engine().startSessionOnDevice(handles, desc, &error)) return errorOrNull(env, error);
    return nullptr;
}

void nativeStopSession(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> lock(engineMutex());
    engine().stopSession();
}

jstring nativeSessionJson(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> lock(engineMutex());
    return toJavaString(env, engine().sessionJson());
}

jstring nativeProcessFrame(JNIEnv* env, jclass, jlong lowResImage, jlong lowResView,
                           jlong outputImage, jlong outputView, jlong motionImage,
                           jlong motionView, jdouble deltaSeconds, jboolean resetHistory,
                           jboolean historyValid) {
    v4k::FrameHandles frame;
    frame.lowResImage = static_cast<uint64_t>(lowResImage);
    frame.lowResView = static_cast<uint64_t>(lowResView);
    frame.outputImage = static_cast<uint64_t>(outputImage);
    frame.outputView = static_cast<uint64_t>(outputView);
    frame.motionImage = static_cast<uint64_t>(motionImage);
    frame.motionView = static_cast<uint64_t>(motionView);
    frame.deltaSeconds = deltaSeconds;
    frame.resetHistory = resetHistory == JNI_TRUE;
    frame.historyValid = historyValid == JNI_TRUE;

    std::lock_guard<std::mutex> lock(engineMutex());
    const v4k::FrameResult result = engine().processFrame(frame);

    v4k::JsonWriter w(0);
    w.beginObject();
    w.field("submitted", result.submitted);
    w.field("mode", v4k::toString(result.mode));
    if (result.upscalerMs == v4k::kUnavailable) w.fieldNull("upscalerMs");
    else w.field("upscalerMs", result.upscalerMs);
    w.field("error", result.error);
    w.endObject();
    return toJavaString(env, w.str());
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
// JNINativeMethod takes `char*` in the JDK's jni.h and `const char*` in the
// NDK's; the explicit cast keeps this table warning-free on both.
#define V4K_JNI_METHOD(name, signature, fn) \
    {const_cast<char*>(name), const_cast<char*>(signature), reinterpret_cast<void*>(fn)}

const JNINativeMethod kMethods[] = {
    V4K_JNI_METHOD("nativeInitialise", "(Ljava/lang/String;)Ljava/lang/String;", nativeInitialise),
    V4K_JNI_METHOD("nativeShutdown", "()V", nativeShutdown),
    V4K_JNI_METHOD("nativeIsInitialised", "()Z", nativeIsInitialised),
    V4K_JNI_METHOD("nativeUpdateAndroidCaps", "(Ljava/lang/String;)Ljava/lang/String;",
                   nativeUpdateAndroidCaps),
    V4K_JNI_METHOD("nativeReprobeDevice", "()Ljava/lang/String;", nativeReprobeDevice),
    V4K_JNI_METHOD("nativeDeviceJson", "()Ljava/lang/String;", nativeDeviceJson),
    V4K_JNI_METHOD("nativeCompatibilityJson", "()Ljava/lang/String;", nativeCompatibilityJson),
    V4K_JNI_METHOD("nativeSetIntegration", "(I)V", nativeSetIntegration),
    V4K_JNI_METHOD("nativeSetProfileJson", "(Ljava/lang/String;)Ljava/lang/String;",
                   nativeSetProfileJson),
    V4K_JNI_METHOD("nativeProfileJson", "()Ljava/lang/String;", nativeProfileJson),
    V4K_JNI_METHOD("nativePresetsJson", "()Ljava/lang/String;", nativePresetsJson),
    // (int platformStatus, float batteryTempC, float avgFrameMs, float targetFrameMs,
    //  boolean thermalGuardEnabled, long nowMs)
    V4K_JNI_METHOD("nativeUpdateThermal", "(IFFFZJ)V", nativeUpdateThermal),
    V4K_JNI_METHOD("nativeAddFrameSample", "(DJD)V", nativeAddFrameSample),
    V4K_JNI_METHOD("nativeStatusJson", "()Ljava/lang/String;", nativeStatusJson),
    V4K_JNI_METHOD("nativeMetricsJson", "()Ljava/lang/String;", nativeMetricsJson),
    V4K_JNI_METHOD("nativeInstallModelBytes", "([B)Ljava/lang/String;", nativeInstallModelBytes),
    V4K_JNI_METHOD("nativeInstallModelFile", "(Ljava/lang/String;)Ljava/lang/String;",
                   nativeInstallModelFile),
    V4K_JNI_METHOD("nativeRemoveModel", "()V", nativeRemoveModel),
    V4K_JNI_METHOD("nativeModelJson", "()Ljava/lang/String;", nativeModelJson),
    V4K_JNI_METHOD("nativeStartSession", "(JJJIIJJIIIIZZZFFZJ)Ljava/lang/String;",
                   nativeStartSession),
    V4K_JNI_METHOD("nativeStopSession", "()V", nativeStopSession),
    V4K_JNI_METHOD("nativeSessionJson", "()Ljava/lang/String;", nativeSessionJson),
    V4K_JNI_METHOD("nativeProcessFrame", "(JJJJJJDZZ)Ljava/lang/String;", nativeProcessFrame),
};

}  // namespace

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
    JNIEnv* env = nullptr;
    if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
        return JNI_ERR;
    }
    jclass bridge = env->FindClass(kBridgeClass);
    if (bridge == nullptr) {
        V4K_LOGE("jni: %s not found — the Kotlin SDK class was renamed or removed", kBridgeClass);
        return JNI_ERR;
    }
    if (env->RegisterNatives(bridge, kMethods,
                             static_cast<jint>(sizeof(kMethods) / sizeof(kMethods[0]))) != JNI_OK) {
        V4K_LOGE("jni: RegisterNatives failed");
        return JNI_ERR;
    }
    V4K_LOGI("jni: engine bridge registered (version %d.%d.%d)", v4k::kEngineVersionMajor,
             v4k::kEngineVersionMinor, v4k::kEngineVersionPatch);
    return JNI_VERSION_1_6;
}
