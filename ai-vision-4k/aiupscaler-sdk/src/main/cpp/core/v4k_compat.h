// Compatibility rule engine.
//
// This is the honest heart of the product. Android does not let a normal
// application replace another application's rendering pipeline, so the rules
// here answer three separate questions, never conflated:
//
//   1. Can the *device* run the engine at all, and at which capability level?
//   2. Is this *game* connected through a mechanism that can actually change
//      its render resolution (SDK integration / our demo / screen enhancement)?
//   3. What will the user actually see if they press START?
//
// Every rule that reduces the status also produces a human readable reason with
// a stable machine code, so the UI can explain exactly why something is
// unsupported instead of silently degrading.
#pragma once

#include <string>
#include <vector>

#include "v4k_common.h"
#include "v4k_device.h"
#include "v4k_profile.h"

namespace v4k {

// Stable reason codes (also used by the Kotlin UI for localisation and icons).
namespace reason {
constexpr const char* kNoVulkan = "NO_VULKAN";
constexpr const char* kSoftwareRenderer = "SOFTWARE_RENDERER";
constexpr const char* kOldAndroid = "ANDROID_TOO_OLD";
constexpr const char* kAbiNotSupported = "ABI_NOT_SUPPORTED";
constexpr const char* kNoComputeQueue = "NO_COMPUTE_QUEUE";
constexpr const char* kComputeLimits = "COMPUTE_LIMITS_TOO_LOW";
constexpr const char* kNoStorageImage = "NO_STORAGE_IMAGE_SUPPORT";
constexpr const char* kNoR8Storage = "NO_R8_STORAGE_IMAGE";
constexpr const char* kLowMemory = "LOW_MEMORY";
constexpr const char* kLowSharedMemory = "LOW_COMPUTE_SHARED_MEMORY";
constexpr const char* kVk10Only = "VULKAN_1_0_ONLY";
constexpr const char* kMaxImageDimension = "MAX_IMAGE_DIMENSION_LIMIT";
constexpr const char* kNoModel = "NO_AI_MODEL_INSTALLED";
constexpr const char* kNoIntegration = "NO_SDK_INTEGRATION";
constexpr const char* kScreenEnhance = "SCREEN_ENHANCEMENT_EXPERIMENTAL";
constexpr const char* kCaptureUnavailable = "SCREEN_CAPTURE_UNAVAILABLE";
constexpr const char* kNoFp16 = "NO_FP16_STORAGE";
constexpr const char* kNoInt8 = "NO_INT8_STORAGE";
constexpr const char* kNnapiExperimental = "NNAPI_EXPERIMENTAL";
constexpr const char* kNoThermalSensors = "NO_THERMAL_SENSORS";
constexpr const char* kPerformanceMode = "PERFORMANCE_MODE";
constexpr const char* kSupersampleOnly = "SUPERSAMPLE_ONLY";
constexpr const char* kOk = "OK";
}  // namespace reason

struct CompatReason {
    CompatStatus cap = CompatStatus::Supported;  // status this reason caps the result to
    std::string code;
    std::string message;     // user facing, complete sentence
    std::string detail;      // technical detail for the expandable panel
    bool blocking = false;   // true == this alone makes the feature impossible
};

struct CompatInput {
    DeviceCapabilities caps;
    IntegrationKind integration = IntegrationKind::None;
    GraphicsProfile desired;
    bool aiModelInstalled = false;
    bool nnapiModelAvailable = false;
    bool preferNpu = false;
    bool screenCapturePossible = true;   // MediaProjection can be requested/consented
};

struct CompatResult {
    CompatStatus status = CompatStatus::Unsupported;
    DeviceTier tier = DeviceTier::Unsupported;

    // What the engine will really do with this configuration, right now.
    UpscaleMode achievableMode = UpscaleMode::Disabled;
    InferenceBackend achievableBackend = InferenceBackend::None;
    Resolution recommendedOutput{1280, 720};
    int recommendedRenderScalePercent = 67;
    AiQuality maximumAiQuality = AiQuality::Off;

    // True when the app can still deliver value (metrics, OS hints) even if
    // in-pipeline upscaling is impossible.
    bool monitoringAvailable = false;
    bool overlayAvailable = false;
    bool gameModeHintAvailable = false;

    std::string headline;                    // one sentence for the UI
    std::vector<CompatReason> reasons;       // may include supporting notes
    std::string toJson() const;
};

CompatResult evaluateCompatibility(const CompatInput& input);

// Largest output resolution that this device can hold as a storage image and
// comfortably afford; used as the default when creating a profile.
Resolution recommendedOutputResolution(const DeviceCapabilities& caps, DeviceTier tier);
AiQuality recommendedAiQuality(DeviceTier tier);
int recommendedRenderScale(DeviceTier tier);

}  // namespace v4k
