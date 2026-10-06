// AI Vision 4K — engine façade.
//
// This is the single object the JNI bridge owns (`com.aivision4k.sdk.AIUpscaler`
// is a thin Kotlin wrapper around it). It deliberately does *not* contain
// platform plumbing: the JNI layer feeds it Android facts (SDK level, RAM,
// thermals, NNAPI presence, the game's VkDevice handles) and it owns everything
// that is device independent plus the Vulkan session.
//
// A frame is always produced through the integration path: the caller (a game
// that links the SDK, or the bundled demo scene) owns the Vulkan device and
// hands over the handles plus its low-res colour image; the engine records the
// upscale into the caller's queue and writes the output image the caller gave
// it. Nothing leaves the process, no other app's rendering is touched, and the
// engine never destroys an object it did not create.
//
// Everything the UI shows comes from here: real capability probes, a real
// thermal decision, real frame timings. Nothing is invented.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "../core/v4k_common.h"
#include "../core/v4k_compat.h"
#include "../core/v4k_device.h"
#include "../core/v4k_metrics.h"
#include "../core/v4k_profile.h"
#include "../core/v4k_thermal.h"
#include "../ai/v4k_model.h"

namespace v4k {

// Resolution and feature set of one upscaling session.
struct SessionDesc {
    uint32_t inputWidth = 1280;
    uint32_t inputHeight = 720;
    uint32_t outputWidth = 1920;
    uint32_t outputHeight = 1080;
    bool temporal = true;
    bool denoise = false;
    bool antiAliasing = true;
    bool neural = true;             // the profile's aiUpscaling flag
    float sharpening = 0.2f;
    float noiseReduction = 0.15f;
    uint64_t maxWorkingBytes = 0;   // 0 == no explicit budget
};

// Per-stage GPU timings in milliseconds, taken from the driver's timestamp
// queries. Every field is kUnavailable when the device does not report it —
// the UI prints "unavailable" rather than a made-up number.
struct StageMs {
    bool available = false;
    bool countersAvailable = false;
    double preprocessMs = kUnavailable;
    double neuralMs = kUnavailable;
    double denoiseMs = kUnavailable;
    double temporalMs = kUnavailable;
    double aaMs = kUnavailable;
    double sharpenMs = kUnavailable;

    double totalMs() const;
    std::string toJson() const;
};

// What the session is actually doing (never what it was asked to do).
struct SessionStats {
    bool active = false;
    uint32_t inputWidth = 0;
    uint32_t inputHeight = 0;
    uint32_t outputWidth = 0;
    uint32_t outputHeight = 0;
    bool neural = false;            // a model graph is resident
    bool temporal = false;
    uint32_t layerCount = 0;
    uint64_t workingSetBytes = 0;
    uint64_t weightBytes = 0;
    ReconstructionMode mode = ReconstructionMode::None;
    std::string modelId;
    std::string lastError;

    std::string toJson() const;
};

// The frame a caller submits. Handles are 64-bit so they can carry a pointer or
// a Vulkan object through JNI without any per-frame allocation.
//
// Required image layouts (the engine's barriers start from these, so a caller
// that hands over the wrong layout may find its input discarded):
//   * `lowResImage` must be VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL -- render
//     the scene, then transition it before calling processFrame().
//   * `outputImage` must be VK_IMAGE_LAYOUT_GENERAL (it is written as a storage
//     image) and comes back in VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, ready
//     to be sampled for presentation.
// The demo renderer (demo/v4k_demo_renderer.cpp) does exactly this.
struct FrameHandles {
    uint64_t lowResImage = 0;      // VkImage, engine never owns it
    uint64_t lowResView = 0;       // VkImageView
    uint64_t outputImage = 0;      // rgba16f storage image the engine writes
    uint64_t outputView = 0;
    uint64_t motionImage = 0;      // optional caller motion vectors (rg16f)
    uint64_t motionView = 0;
    double deltaSeconds = 0.0;
    bool resetHistory = false;
    bool historyValid = false;
};

struct FrameResult {
    bool submitted = false;
    ReconstructionMode mode = ReconstructionMode::None;
    double upscalerMs = kUnavailable;   // CPU-side record time (not GPU time)
    std::string error;
};

// Device handles supplied by an integrating game (all raw Vulkan handles).
struct DeviceHandles {
    uint64_t instance = 0;
    uint64_t physicalDevice = 0;
    uint64_t device = 0;
    uint32_t computeQueueFamily = 0;
    uint32_t graphicsQueueFamily = 0;
    uint64_t computeQueue = 0;
    uint64_t graphicsQueue = 0;
};

class Engine {
public:
    Engine();
    ~Engine();

    Engine(const Engine&) = delete;
    Engine& operator=(const Engine&) = delete;

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------
    // `androidCapsJson` carries everything only the Java side can read (see
    // DeviceCapabilities). The Vulkan half is probed natively; when the probe
    // fails the engine still initialises and the compatibility report says why.
    bool initialise(const std::string& androidCapsJson, std::string* error);
    void shutdown();
    bool initialised() const { return initialised_; }

    // Replaces the Android/memory/neural/thermal caps (called when the app
    // re-reads them, e.g. after a configuration change). Vulkan caps are kept.
    bool updateAndroidCaps(const std::string& androidCapsJson, std::string* error);

    // Re-probes Vulkan from scratch (used by the "Device" refresh button).
    bool reprobeDevice(std::string* error);

    const DeviceCapabilities& capabilities() const { return caps_; }
    std::string deviceJson() const;

    void setIntegration(IntegrationKind kind) { integration_ = kind; }
    IntegrationKind integration() const { return integration_; }

    // -----------------------------------------------------------------------
    // Compatibility (evaluated, never guessed)
    // -----------------------------------------------------------------------
    CompatResult compatibility() const;
    std::string compatibilityJson() const;
    DeviceTier tier() const { return tier_; }

    // -----------------------------------------------------------------------
    // Profile + runtime policy
    // -----------------------------------------------------------------------
    const GraphicsProfile& profile() const { return profile_; }
    bool setProfileJson(const std::string& json, std::string* error);
    std::string profileJson() const;
    // Presets for the profile editor, already clamped to this device.
    std::string presetsJson() const;

    // Feed the governor one sample (~1 Hz is enough; it is hysteretic).
    void updateThermal(const ThermalInput& input);
    const ThermalDecision& thermalDecision() const { return decision_; }
    // Profile + thermal decision, i.e. what the engine would configure now.
    RuntimeSettings runtimeSettings() const;

    // Per-frame CPU timings (the caller measures the wall clock it sees).
    void addFrameSample(double frameTimeMs, int64_t nowMs, double upscalerMs);

    // -----------------------------------------------------------------------
    // AI model manager
    // -----------------------------------------------------------------------
    bool installModelBytes(const std::vector<uint8_t>& bytes, std::string* error);
    bool installModelFile(const std::string& path, std::string* error);
    void removeModel();
    bool modelInstalled() const { return modelInstalled_; }
    std::string modelJson() const;
    // Which catalog model the current profile wants ("" when none is suitable).
    std::string preferredModelId() const { return v4k::preferredModelId(profile_.aiQuality); }

    // -----------------------------------------------------------------------
    // Sessions
    // -----------------------------------------------------------------------
    // Starts an upscaling session on the caller's Vulkan device/queues. The
    // engine creates only its own pipelines, buffers and command pool; the
    // caller keeps ownership of its instance, device, queues and images.
    bool startSessionOnDevice(const DeviceHandles& handles, const SessionDesc& desc,
                              std::string* error);
    void stopSession();
    const SessionStats& session() const { return session_; }
    std::string sessionJson() const;
    bool sessionActive() const { return session_.active; }

    // Records one upscale of a caller-owned frame. Only valid for a session on
    // the caller's device; returns an error for a session the engine owns (the
    // demo drives its own frames).
    FrameResult processFrame(const FrameHandles& frame);

    // GPU timings of the newest recorded frame, as reported by the driver.
    // Never estimated: `available == false` means the device did not tell us.
    const StageMs& lastStageTimings() const { return lastTimings_; }

    // -----------------------------------------------------------------------
    // Monitoring
    // -----------------------------------------------------------------------
    // Full dashboard snapshot: resolutions, measured FPS/frame time, AI stage
    // timings, GPU busy (AI Vision passes only), RAM, temperatures and the
    // thermal level plus the exact actions the governor applied.
    std::string statusJson();
    // Rolling frame window + per-stage timers + GPU load, for the live graph.
    std::string metricsJson() const;

private:
    void evaluateNow();
    // Re-reads /proc/stat and /proc/meminfo. Called from statusJson(), which is
    // why that one is not const: the sampler needs the previous sample.
    void refreshMonitoring();

    DeviceCapabilities caps_{};
    IntegrationKind integration_ = IntegrationKind::None;
    DeviceTier tier_ = DeviceTier::Unsupported;
    CompatResult compat_{};

    GraphicsProfile profile_{};
    ThermalGovernor governor_{};
    ThermalDecision decision_{};

    FrameTimeWindow frames_{240};
    StageTimers stages_{};
    GpuLoadEstimator gpuLoad_{};
    CpuLoadSampler cpuLoad_{};
    RamSample ram_{};
    double cpuLoadFraction_ = kUnavailable;
    double ramUsedFraction_ = kUnavailable;
    double lastUpscalerMs_ = kUnavailable;

    Model model_{};
    bool modelInstalled_ = false;
    std::string modelPath_;

    SessionStats session_{};
    StageMs lastTimings_{};
    SessionDesc desc_{};
    bool initialised_ = false;

#if defined(V4K_ENABLE_VULKAN)
    struct VkState;
    VkState* vk_ = nullptr;   // pimpl: keeps Vulkan types out of this header
#endif
};

}  // namespace v4k
