// AI Vision 4K — core/common types.
//
// Everything in cpp/core/ is platform independent: it compiles for Android
// (arm64/x86_64) AND for the host, which is how the policy/format logic is
// unit tested (see tools/run-native-tests.sh and cpp/tests/).
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace v4k {

// Sentinel for a value the device would not tell us. It is rendered as
// "unavailable" in the UI instead of being guessed, and it never takes part in
// an average or a threshold decision.
constexpr double kUnavailable = -1.0;


// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------
constexpr int kEngineVersionMajor = 1;
constexpr int kEngineVersionMinor = 0;
constexpr int kEngineVersionPatch = 0;

// Container format version for .v4kmodel files.
constexpr uint32_t kModelFormatVersion = 1;

// ---------------------------------------------------------------------------
// Enumerations. These values cross the JNI boundary: keep them stable.
// ---------------------------------------------------------------------------

// Graphics presets requested by the product spec.
enum class QualityPreset : int32_t {
    Quality = 0,      // maximum reconstruction quality
    Balanced = 1,     // good quality, reasonable GPU load
    Performance = 2,  // maximum FPS
    Extreme = 3,      // experimental maximum-resolution mode
};

// Strength of the neural reconstruction. Off = no AI stage at all.
enum class AiQuality : int32_t {
    Off = 0,
    Low = 1,
    Medium = 2,
    High = 3,
    Ultra = 4,
};

// Which upscaling implementation is actually producing the output frame.
// This is reported to the UI verbatim: we never label an analytical filter
// as "AI".
enum class UpscaleMode : int32_t {
    Disabled = 0,     // frame is passed through untouched
    Analytical = 1,   // non-neural: edge-directed reconstruction + sharpening
    Neural = 2,       // a .v4kmodel graph is being executed (GPU or NNAPI)
};

// Where the AI graph executes.
enum class InferenceBackend : int32_t {
    None = 0,
    GpuVulkan = 1,    // compute shaders over the model graph (default)
    Nnapi = 2,        // Android NNAPI / NPU path (experimental)
    Cpu = 3,          // reference interpreter, always available, slow
};

// Game compatibility classification.
enum class CompatStatus : int32_t {
    Unsupported = 0,
    Experimental = 1,
    PartiallySupported = 2,
    Supported = 3,
};

// How a game is connected to the engine. This is the single most important
// distinction in the whole product: only SdkIntegrated can actually replace a
// game's rendering resolution.
enum class IntegrationKind : int32_t {
    None = 0,            // plain third-party app, no integration at all
    SdkIntegrated = 1,   // game links libaiupscaler and calls processFrame()
    SampleDemo = 2,      // our own Vulkan demo scene (reference integration)
    ScreenEnhance = 3,   // MediaProjection frame enhancement (experimental)
};

enum class ThermalLevel : int32_t {
    Nominal = 0,
    Light = 1,
    Moderate = 2,
    Severe = 3,
    Critical = 4,
    Emergency = 5,
    Shutdown = 6,
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
inline const char* toString(QualityPreset v) {
    switch (v) {
        case QualityPreset::Quality: return "QUALITY";
        case QualityPreset::Balanced: return "BALANCED";
        case QualityPreset::Performance: return "PERFORMANCE";
        case QualityPreset::Extreme: return "EXTREME";
    }
    return "BALANCED";
}

inline const char* toString(AiQuality v) {
    switch (v) {
        case AiQuality::Off: return "OFF";
        case AiQuality::Low: return "LOW";
        case AiQuality::Medium: return "MEDIUM";
        case AiQuality::High: return "HIGH";
        case AiQuality::Ultra: return "ULTRA";
    }
    return "OFF";
}

inline const char* toString(UpscaleMode v) {
    switch (v) {
        case UpscaleMode::Disabled: return "DISABLED";
        case UpscaleMode::Analytical: return "ANALYTICAL";
        case UpscaleMode::Neural: return "NEURAL";
    }
    return "DISABLED";
}

inline const char* toString(InferenceBackend v) {
    switch (v) {
        case InferenceBackend::None: return "NONE";
        case InferenceBackend::GpuVulkan: return "GPU_VULKAN";
        case InferenceBackend::Nnapi: return "NNAPI";
        case InferenceBackend::Cpu: return "CPU";
    }
    return "NONE";
}

inline const char* toString(CompatStatus v) {
    switch (v) {
        case CompatStatus::Unsupported: return "UNSUPPORTED";
        case CompatStatus::Experimental: return "EXPERIMENTAL";
        case CompatStatus::PartiallySupported: return "PARTIALLY_SUPPORTED";
        case CompatStatus::Supported: return "SUPPORTED";
    }
    return "UNSUPPORTED";
}

inline const char* toString(IntegrationKind v) {
    switch (v) {
        case IntegrationKind::None: return "NONE";
        case IntegrationKind::SdkIntegrated: return "SDK_INTEGRATED";
        case IntegrationKind::SampleDemo: return "SAMPLE_DEMO";
        case IntegrationKind::ScreenEnhance: return "SCREEN_ENHANCE";
    }
    return "NONE";
}

inline const char* toString(ThermalLevel v) {
    switch (v) {
        case ThermalLevel::Nominal: return "NOMINAL";
        case ThermalLevel::Light: return "LIGHT";
        case ThermalLevel::Moderate: return "MODERATE";
        case ThermalLevel::Severe: return "SEVERE";
        case ThermalLevel::Critical: return "CRITICAL";
        case ThermalLevel::Emergency: return "EMERGENCY";
        case ThermalLevel::Shutdown: return "SHUTDOWN";
    }

    return "NOMINAL";
}

// Which reconstruction actually ran for a frame. Lives in core (not in the
// Vulkan header) because the JNI status JSON reports it on every device,
// including a build without a Vulkan backend. Values are JNI-stable.
enum class ReconstructionMode : uint32_t {
    None = 0,
    Analytical = 1,       // edge-directed upscale, no network
    Neural = 2,           // model inference ran
    NeuralTemporal = 3,   // model inference + temporal accumulation
    AnalyticalTemporal = 4,
};

inline const char* toString(ReconstructionMode mode) {
    switch (mode) {
        case ReconstructionMode::None: return "NONE";
        case ReconstructionMode::Analytical: return "ANALYTICAL";
        case ReconstructionMode::Neural: return "NEURAL";
        case ReconstructionMode::NeuralTemporal: return "NEURAL_TEMPORAL";
        case ReconstructionMode::AnalyticalTemporal: return "ANALYTICAL_TEMPORAL";
    }
    return "NONE";
}


// Parsing helpers (tolerant: unknown -> default).
QualityPreset qualityPresetFromString(const std::string& s, QualityPreset fallback = QualityPreset::Balanced);
AiQuality aiQualityFromString(const std::string& s, AiQuality fallback = AiQuality::Medium);
IntegrationKind integrationFromString(const std::string& s, IntegrationKind fallback = IntegrationKind::None);
UpscaleMode upscaleModeFromString(const std::string& s, UpscaleMode fallback = UpscaleMode::Disabled);
ThermalLevel thermalLevelFromString(const std::string& s, ThermalLevel fallback = ThermalLevel::Nominal);
InferenceBackend backendFromString(const std::string& s, InferenceBackend fallback = InferenceBackend::None);

// Clamp helper that also reports whether it changed the value.
template <typename T>
inline bool clampTo(T& value, T lo, T hi) {
    if (value < lo) { value = lo; return true; }
    if (value > hi) { value = hi; return true; }
    return false;
}

inline float lerp(float a, float b, float t) { return a + (b - a) * t; }

/**
 * Activation budget for a session that did not state one.
 *
 * `v4k::SessionDesc::maxWorkingBytes == 0` used to mean "unlimited", which is
 * the wrong default for a phone: a graph that needs a few hundred MiB of
 * intermediate tensors is then attempted instead of rejected, and the failure
 * surfaces as an allocation error deep inside the driver, or as the system
 * killing the app. The engine now asks for a number derived from what the device
 * reported:
 *
 *   * prefer the VK_EXT_memory_budget figure, else the largest DEVICE_LOCAL heap;
 *   * spend a quarter of it on activations;
 *   * clamp to [64 MiB, 384 MiB];
 *   * when nothing is known, cap at 128 MiB.
 *
 * This is a policy, not a measurement -- a quarter of the heap is a defensible
 * starting point for transient buffers, and the ceiling stops a large phone from
 * being handed a budget nobody has profiled. Both figures can be overridden by
 * passing an explicit budget to a session.
 */
uint64_t defaultWorkingSetBudget(uint64_t deviceLocalMemoryBytes, uint64_t deviceMemoryBudgetBytes);

// Round up to a multiple (used for workgroup/tile alignment).
inline uint32_t alignUp(uint32_t v, uint32_t a) {
    if (a == 0) return v;
    return (v + a - 1) / a * a;
}

}  // namespace v4k
