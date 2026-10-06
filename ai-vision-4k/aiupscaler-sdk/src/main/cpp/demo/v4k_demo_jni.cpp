// JNI bridge: com.aivision4k.app.DemoNativeBridge <-> v4k::demo::DemoRenderer.
//
// This is the thin layer the demo activity talks to. It follows the same rules
// as the SDK bridge in jni/v4k_jni.cpp:
//
//   * one renderer per process, one mutex, because Vulkan objects and the
//     engine are not thread safe and the demo has a render thread plus the UI
//     thread calling in;
//   * structured data crosses as JSON (core/v4k_json.h): the configuration in,
//     the panel's status, the scene description and the benchmark report out;
//   * errors are a returned string, success is Java null, so Kotlin has one
//     idiom and shows the native message verbatim;
//   * the per-frame entry point returns null on success and does no allocation
//     on the happy path -- no string is built, no snapshot is taken, nothing is
//     read back from the GPU. `statusJson()` is for the panel, which polls it a
//     few times a second, not per frame.
//
// The ANativeWindow reference acquired from the Surface is held here and
// released after the renderer has been shut down: a VkSurfaceKHR is only valid
// while the window behind it exists, and the surface outlives single callbacks
// (the OS can recreate it when the activity is resumed).
#include <jni.h>

#include <cstdint>
#include <mutex>
#include <string>

#include "../core/v4k_json.h"
#include "../core/v4k_log.h"
#include "../demo/v4k_demo_renderer.h"
#include "../graphics/v4k_scene.h"
#include "../sdk/v4k_engine.h"

#include "../jni/v4k_jni_shared.h"

// Same guard as the renderer it drives: without the Vulkan backend there is no
// DemoRenderer to call, and the build decides whether these two files are in it
// at all (V4K_ENABLE_DEMO). Leaving this out would turn a host build with the
// Vulkan option on but no loader into an undefined symbol at link time.
#if defined(V4K_ENABLE_VULKAN)

#if defined(__ANDROID__)
#include <android/native_window_jni.h>
#else
// Host syntax-check fallback. On device these come from the NDK.
struct ANativeWindow;
extern "C" ANativeWindow* ANativeWindow_fromSurface(JNIEnv*, jobject);
extern "C" void ANativeWindow_release(ANativeWindow*);
#endif

namespace {

// Must match the Kotlin `package` and object name exactly. A typo here is not a
// subtle bug: FindClass fails, registration fails, and every demo method turns
// into an UnsatisfiedLinkError at the first click.
constexpr const char* kDemoBridgeClass = "com/aivision4k/app/demo/DemoNativeBridge";

// ---------------------------------------------------------------------------
// Renderer ownership
// ---------------------------------------------------------------------------

struct DemoBridge {
    v4k::demo::DemoRenderer renderer;
    ANativeWindow* window = nullptr;
    v4k::Engine* engine = nullptr;
    bool created = false;
};

DemoBridge& bridge() {
    static DemoBridge instance;
    return instance;
}

std::mutex& bridgeMutex() {
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

jstring toJavaString(JNIEnv* env, const std::string& value) {
    return env->NewStringUTF(value.c_str());
}

// The engine is resolved when the surface arrives rather than when the bridge is
// created: the activity can open while the engine is still initialising, and a
// pointer to an uninitialised engine is worse than no engine at all (the
// renderer has a code path for "no AI stage, and here is why").
void resolveEngine() {
    v4k::Engine* shared = v4k::sharedEngineForDemo();
    bridge().engine = (shared != nullptr && shared->initialised()) ? shared : nullptr;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Reads the demo configuration the panel sent. Missing members keep the
// renderer's current value, so the UI can send only what changed.
bool parseConfig(v4k::demo::DemoConfig& config, const std::string& json, std::string* error) {
    if (json.empty()) return true;
    std::string parseError;
    const std::shared_ptr<v4k::JsonValue> root = v4k::JsonValue::parse(json, &parseError);
    if (root == nullptr || !root->isObject()) {
        if (error != nullptr) {
            *error = "the demo configuration is not valid JSON: " + parseError;
        }
        return false;
    }

    const v4k::JsonValue& mode = (*root)["mode"];
    if (mode.isNumber()) {
        const int64_t value = mode.asInt(0);
        if (value < 0 || value > static_cast<int64_t>(v4k::demo::DemoMode::SplitCompare)) {
            if (error != nullptr) *error = "mode must be 0 (native), 1 (AI upscaled) or 2 (split compare)";
            return false;
        }
        config.mode = static_cast<v4k::demo::DemoMode>(value);
    }

    const v4k::JsonValue& quality = (*root)["quality"];
    if (quality.isNumber()) {
        const int64_t value = quality.asInt(1);
        if (value < 0 || value > static_cast<int64_t>(v4k::demo::DemoQuality::High)) {
            if (error != nullptr) *error = "quality must be 0 (low), 1 (medium) or 2 (high)";
            return false;
        }
        config.quality = static_cast<v4k::demo::DemoQuality>(value);
    }

    const v4k::JsonValue& renderIndex = (*root)["renderIndex"];
    if (renderIndex.isNumber()) config.renderIndex = static_cast<uint32_t>(renderIndex.asInt(0));
    const v4k::JsonValue& outputIndex = (*root)["outputIndex"];
    if (outputIndex.isNumber()) config.outputIndex = static_cast<uint32_t>(outputIndex.asInt(2));
    const v4k::JsonValue& duration = (*root)["durationSeconds"];
    if (duration.isNumber()) config.durationSeconds = duration.asDouble(0.0);
    const v4k::JsonValue& seed = (*root)["seed"];
    if (seed.isNumber()) config.seed = static_cast<uint32_t>(seed.asInt(20261006));
    const v4k::JsonValue& temporal = (*root)["allowTemporal"];
    if (temporal.isBool()) config.allowTemporal = temporal.asBool(true);
    const v4k::JsonValue& split = (*root)["splitPosition"];
    if (split.isNumber()) config.splitPosition = split.asFloat(0.5f);
    const v4k::JsonValue& magnifier = (*root)["magnifierScale"];
    if (magnifier.isNumber()) config.magnifierScale = magnifier.asFloat(1.0f);

    // Same validation the UI runs before starting, applied again here because a
    // bad index would otherwise be a device-lost inside the swapchain code.
    std::string reason;
    if (!v4k::demo::validateDemoConfig(config, &reason)) {
        if (error != nullptr) *error = reason;
        return false;
    }
    return true;
}

// The configuration plus the ladder it refers to. Kotlin builds its controls
// from this rather than from a second copy of the resolutions, so the two can
// never drift apart.
std::string configJson(const v4k::demo::DemoConfig& config) {
    v4k::JsonWriter w(0);
    w.beginObject();
    w.field("mode", static_cast<int32_t>(config.mode));
    w.field("modeName", v4k::demo::demoModeName(config.mode));
    w.field("renderIndex", config.renderIndex);
    w.field("outputIndex", config.outputIndex);
    w.field("seed", config.seed);
    w.field("quality", static_cast<int32_t>(config.quality));
    w.field("durationSeconds", config.durationSeconds);
    w.field("allowTemporal", config.allowTemporal);
    w.field("splitPosition", config.splitPosition);
    w.field("magnifierScale", config.magnifierScale);

    w.key("resolutions");
    w.beginArray();
    const v4k::demo::Resolution* rungs = v4k::demo::demoResolutions();
    for (uint32_t i = 0; i < v4k::demo::kDemoResolutionCount; ++i) {
        w.beginObject();
        w.field("index", i);
        w.field("width", rungs[i].width);
        w.field("height", rungs[i].height);
        w.field("name", rungs[i].name);
        w.endObject();
    }
    w.endArray();

    // The qualities are spelled out for the same reason: the panel shows them.
    w.key("qualities");
    w.beginArray();
    for (int32_t q = 0; q <= static_cast<int32_t>(v4k::demo::DemoQuality::High); ++q) {
        w.beginObject();
        w.field("index", q);
        const char* name = q == 0 ? "Low" : q == 1 ? "Medium" : "High";
        w.field("name", name);
        w.endObject();
    }
    w.endArray();

    w.field("upscales", v4k::demo::isUpscaleConfig(config));
    w.endObject();
    return w.str();
}

}  // namespace

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

namespace {

jstring nativeCreate(JNIEnv* env, jobject) {
    std::lock_guard<std::mutex> lock(bridgeMutex());
    DemoBridge& b = bridge();
    if (b.created) return nullptr;
    b.created = true;
    b.engine = nullptr;
    V4K_LOGI("demo: bridge created");
    (void)env;
    return nullptr;
}

// `nativeWindow` is a jobject of type android.view.Surface. The reference is
// taken here and released in nativeSurfaceDestroyed(), after the renderer has
// let go of the VkSurfaceKHR.
jstring nativeSurfaceCreated(JNIEnv* env, jobject, jobject surface, jint width, jint height) {
    std::lock_guard<std::mutex> lock(bridgeMutex());
    DemoBridge& b = bridge();
    if (surface == nullptr) return toJavaString(env, "the surface is null");
    if (width <= 0 || height <= 0) return toJavaString(env, "the surface size is empty");

    ANativeWindow* window = ANativeWindow_fromSurface(env, surface);
    if (window == nullptr) return toJavaString(env, "Android did not give us the drawing surface");

    resolveEngine();

    std::string error;
    if (!b.renderer.initialise(b.engine, window, static_cast<uint32_t>(width),
                               static_cast<uint32_t>(height), &error)) {
        ANativeWindow_release(window);
        if (error.empty()) error = "the demo renderer could not start on this device";
        V4K_LOGE("demo: initialise failed: %s", error.c_str());
        return toJavaString(env, error);
    }

    // Only replace the held window once the new surface is known to work.
    if (b.window != nullptr) ANativeWindow_release(b.window);
    b.window = window;
    V4K_LOGI("demo: surface %dx%d, AI stage %s", static_cast<int>(width), static_cast<int>(height),
             b.engine != nullptr ? "available" : "unavailable");
    return nullptr;
}

jstring nativeSurfaceChanged(JNIEnv* env, jobject, jobject surface, jint width, jint height) {
    std::lock_guard<std::mutex> lock(bridgeMutex());
    DemoBridge& b = bridge();
    if (!b.renderer.initialised()) return nullptr;   // nothing to resize yet
    if (width <= 0 || height <= 0) return nullptr;   // minimised: keep the last size

    ANativeWindow* window = (surface != nullptr) ? ANativeWindow_fromSurface(env, surface) : nullptr;
    std::string error;
    const bool ok = b.renderer.resize(window, static_cast<uint32_t>(width),
                                      static_cast<uint32_t>(height), &error);
    if (window != nullptr && window != b.window) {
        // Adopt the new window only if the renderer accepted it, otherwise keep
        // the old one alive: it is what the current swapchain is built on.
        if (ok) {
            if (b.window != nullptr) ANativeWindow_release(b.window);
            b.window = window;
        } else {
            ANativeWindow_release(window);
        }
    }
    if (!ok) return toJavaString(env, error.empty() ? "the swapchain could not follow the new size" : error);
    return nullptr;
}

void nativeSurfaceDestroyed(JNIEnv*, jobject) {
    std::lock_guard<std::mutex> lock(bridgeMutex());
    DemoBridge& b = bridge();
    if (b.renderer.initialised()) b.renderer.shutdown();
    if (b.window != nullptr) {
        ANativeWindow_release(b.window);
        b.window = nullptr;
    }
    b.engine = nullptr;
}

jstring nativeSetConfig(JNIEnv* env, jobject, jstring json) {
    std::lock_guard<std::mutex> lock(bridgeMutex());
    DemoBridge& b = bridge();
    if (!b.renderer.initialised()) return toJavaString(env, "the demo has no surface yet");

    v4k::demo::DemoConfig config = b.renderer.config();
    std::string error;
    if (!parseConfig(config, toStdString(env, json), &error)) return toJavaString(env, error);
    if (!b.renderer.setConfig(config, &error)) {
        return toJavaString(env, error.empty() ? "the renderer rejected the configuration" : error);
    }
    return nullptr;
}

jstring nativeConfigJson(JNIEnv* env, jobject) {
    std::lock_guard<std::mutex> lock(bridgeMutex());
    return toJavaString(env, configJson(bridge().renderer.config()));
}

// The render loop. Success is null: no string is built, nothing is marshalled.
jstring nativeRenderFrame(JNIEnv* env, jobject, jdouble deltaSeconds, jdouble timeSeconds) {
    std::lock_guard<std::mutex> lock(bridgeMutex());
    DemoBridge& b = bridge();
    if (!b.renderer.initialised()) return nullptr;   // torn down mid-frame; not an error
    std::string error;
    if (!b.renderer.renderFrame(deltaSeconds, timeSeconds, &error)) {
        return toJavaString(env, error.empty() ? "Rendering the frame failed" : error);
    }
    return nullptr;
}

jstring nativeStatusJson(JNIEnv* env, jobject) {
    std::lock_guard<std::mutex> lock(bridgeMutex());
    return toJavaString(env, bridge().renderer.statusJson());
}

jstring nativeSceneJson(JNIEnv* env, jobject) {
    std::lock_guard<std::mutex> lock(bridgeMutex());
    return toJavaString(env, bridge().renderer.sceneJson());
}

jstring nativeLastError(JNIEnv* env, jobject) {
    std::lock_guard<std::mutex> lock(bridgeMutex());
    return toJavaString(env, bridge().renderer.lastError());
}

jstring nativeBeginBenchmark(JNIEnv* env, jobject, jint mode) {
    std::lock_guard<std::mutex> lock(bridgeMutex());
    DemoBridge& b = bridge();
    if (mode != 0 && mode != 1) {
        return toJavaString(env, "the benchmark measures mode 0 (native) or 1 (AI upscaled)");
    }
    std::string error;
    if (!b.renderer.beginBenchmark(static_cast<v4k::demo::DemoMode>(mode), &error)) {
        return toJavaString(env, error.empty() ? "the benchmark could not start" : error);
    }
    return nullptr;
}

void nativeEndBenchmark(JNIEnv*, jobject) {
    std::lock_guard<std::mutex> lock(bridgeMutex());
    bridge().renderer.endBenchmark();
}

jstring nativeBenchmarkJson(JNIEnv* env, jobject) {
    std::lock_guard<std::mutex> lock(bridgeMutex());
    return toJavaString(env, bridge().renderer.benchmarkJson());
}

jstring nativeFeatureJson(JNIEnv* env, jobject) {
    // What this build of the demo can actually do, so the panel can grey out
    // what the device cannot run instead of offering it and failing later.
    std::lock_guard<std::mutex> lock(bridgeMutex());
    DemoBridge& b = bridge();
    v4k::JsonWriter w(0);
    w.beginObject();
    w.field("initialised", b.renderer.initialised());
    w.field("engineAttached", b.engine != nullptr);
    w.field("engineInitialised", b.engine != nullptr && b.engine->initialised());
    w.field("modelInstalled", b.engine != nullptr && b.engine->modelInstalled());
    w.field("sessionActive", b.engine != nullptr && b.engine->sessionActive());
    w.field("sessionRunning", b.renderer.sessionActive());
    w.field("mode", v4k::demo::demoModeName(b.renderer.mode()));
    w.endObject();
    return toJavaString(env, w.str());
}

// The Kotlin side is an `object`, so these are instance methods and the second
// argument is the singleton instance rather than a jclass. None of them need it
// -- the native state is file-static -- but the signature should say what it is.
#define V4K_DEMO_METHOD(name, signature, fn) \
    {const_cast<char*>(name), const_cast<char*>(signature), reinterpret_cast<void*>(fn)}

const JNINativeMethod kDemoMethods[] = {
    V4K_DEMO_METHOD("nativeCreate", "()Ljava/lang/String;", nativeCreate),
    V4K_DEMO_METHOD("nativeSurfaceCreated", "(Landroid/view/Surface;II)Ljava/lang/String;",
                    nativeSurfaceCreated),
    V4K_DEMO_METHOD("nativeSurfaceChanged", "(Landroid/view/Surface;II)Ljava/lang/String;",
                    nativeSurfaceChanged),
    V4K_DEMO_METHOD("nativeSurfaceDestroyed", "()V", nativeSurfaceDestroyed),
    V4K_DEMO_METHOD("nativeSetConfig", "(Ljava/lang/String;)Ljava/lang/String;", nativeSetConfig),
    V4K_DEMO_METHOD("nativeConfigJson", "()Ljava/lang/String;", nativeConfigJson),
    V4K_DEMO_METHOD("nativeFeatureJson", "()Ljava/lang/String;", nativeFeatureJson),
    V4K_DEMO_METHOD("nativeRenderFrame", "(DD)Ljava/lang/String;", nativeRenderFrame),
    V4K_DEMO_METHOD("nativeStatusJson", "()Ljava/lang/String;", nativeStatusJson),
    V4K_DEMO_METHOD("nativeSceneJson", "()Ljava/lang/String;", nativeSceneJson),
    V4K_DEMO_METHOD("nativeLastError", "()Ljava/lang/String;", nativeLastError),
    V4K_DEMO_METHOD("nativeBeginBenchmark", "(I)Ljava/lang/String;", nativeBeginBenchmark),
    V4K_DEMO_METHOD("nativeEndBenchmark", "()V", nativeEndBenchmark),
    V4K_DEMO_METHOD("nativeBenchmarkJson", "()Ljava/lang/String;", nativeBenchmarkJson),
};

}  // namespace

// Called from the SDK bridge's JNI_OnLoad (see jni/v4k_jni_shared.h): this
// library has one JNI_OnLoad, and it registers every bridge the build contains.
bool v4kRegisterDemoBridge(JNIEnv* env) {
    jclass bridgeClass = env->FindClass(kDemoBridgeClass);
    if (bridgeClass == nullptr) {
        V4K_LOGE("demo: %s not found — the Kotlin bridge class was renamed or removed", kDemoBridgeClass);
        return false;
    }
    if (env->RegisterNatives(bridgeClass, kDemoMethods,
                             static_cast<jint>(sizeof(kDemoMethods) / sizeof(kDemoMethods[0]))) !=
        JNI_OK) {
        V4K_LOGE("demo: RegisterNatives failed");
        return false;
    }
    V4K_LOGI("demo: bridge registered (%d entry points)",
             static_cast<int>(sizeof(kDemoMethods) / sizeof(kDemoMethods[0])));
    return true;
}

#endif  // V4K_ENABLE_VULKAN
