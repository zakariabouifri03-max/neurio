#include "v4k_compat.h"

#include <algorithm>
#include <cmath>

#include "v4k_json.h"
#include "v4k_log.h"

namespace v4k {
namespace {

constexpr uint32_t kVkVersion10 = 0x400000;
constexpr uint32_t kVkVersion11 = 0x401000;
constexpr uint32_t kVkVersion12 = 0x402000;

CompatStatus worse(CompatStatus a, CompatStatus b) {
    return static_cast<int>(a) < static_cast<int>(b) ? a : b;
}

void addReason(CompatResult& r, CompatStatus cap, const char* code, const std::string& message,
               const std::string& detail = std::string(), bool blocking = false) {
    CompatReason reason;
    reason.cap = cap;
    reason.code = code;
    reason.message = message;
    reason.detail = detail;
    reason.blocking = blocking;
    r.reasons.push_back(std::move(reason));
    r.status = worse(r.status, cap);
}

std::string versionString(uint32_t v) {
    return std::to_string((v >> 22) & 0x7Fu) + "." + std::to_string((v >> 12) & 0x3FFu) + "." +
           std::to_string(v & 0xFFFu);
}

std::string gbString(uint64_t bytes) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.1f GB", static_cast<double>(bytes) / (1024.0 * 1024.0 * 1024.0));
    return buf;
}

}  // namespace

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------
Resolution recommendedOutputResolution(const DeviceCapabilities& caps, DeviceTier tier) {
    const uint32_t maxDim = caps.vulkan.maxImageDimension2D == 0 ? 4096u : caps.vulkan.maxImageDimension2D;
    Resolution best{1280, 720};
    for (const Resolution& r : outputResolutionLadder()) {
        if (r.width > maxDim || r.height > maxDim) continue;
        switch (tier) {
            case DeviceTier::Unsupported: return Resolution{1280, 720};
            case DeviceTier::Entry:
                if (r.pixels() <= 1280ull * 720ull) best = r;
                break;
            case DeviceTier::Mid:
                if (r.pixels() <= 1920ull * 1080ull) best = r;
                break;
            case DeviceTier::High:
                if (r.pixels() <= 2560ull * 1440ull) best = r;
                break;
            case DeviceTier::Flagship:
                best = r;  // 4K when the driver allows it
                break;
        }
    }
    // Memory pressure check: a 4K RGBA16F render + history buffers is ~500 MB.
    if (best.pixels() > 2560ull * 1440ull && caps.memory.totalRamBytes > 0 &&
        caps.memory.totalRamBytes < 8ull * 1024 * 1024 * 1024) {
        best = Resolution{2560, 1440};
    }
    return best;
}

AiQuality recommendedAiQuality(DeviceTier tier) {
    switch (tier) {
        case DeviceTier::Unsupported: return AiQuality::Off;
        case DeviceTier::Entry: return AiQuality::Low;
        case DeviceTier::Mid: return AiQuality::Low;
        case DeviceTier::High: return AiQuality::Medium;
        case DeviceTier::Flagship: return AiQuality::High;
    }
    return AiQuality::Off;
}

int recommendedRenderScale(DeviceTier tier) {
    switch (tier) {
        case DeviceTier::Unsupported: return 100;
        case DeviceTier::Entry: return 50;
        case DeviceTier::Mid: return 60;
        case DeviceTier::High: return 67;
        case DeviceTier::Flagship: return 75;
    }
    return 67;
}

// ---------------------------------------------------------------------------
// Main evaluation
// ---------------------------------------------------------------------------
CompatResult evaluateCompatibility(const CompatInput& input) {
    CompatResult r;
    const DeviceCapabilities& caps = input.caps;
    const GraphicsProfile& profile = input.desired;

    r.tier = classifyDeviceTier(caps);
    r.status = CompatStatus::Supported;

    // ---- 1. Platform / ABI -------------------------------------------------
    if (caps.android.sdkInt > 0 && caps.android.sdkInt < 26) {
        addReason(r, CompatStatus::Unsupported, reason::kOldAndroid,
                  "Android 8.0 or newer is required.",
                  "This build targets minSdk 26; the Vulkan compute path needs a 64-bit "
                  "loader and the modern NDK toolchain.",
                  true);
    }
    if (!caps.android.supportsArm64 && caps.android.cpuArch != 3 /* x86_64 */) {
        addReason(r, CompatStatus::Unsupported, reason::kAbiNotSupported,
                  "This device is 32-bit only: the engine ships 64-bit binaries.",
                  "Building for armeabi-v7a is possible from source (docs/BUILD.md) but "
                  "the compute-heavy reconstruction path is not viable there.",
                  true);
    }

    // ---- 2. Graphics API ---------------------------------------------------
    if (!caps.vulkan.available) {
        addReason(r, CompatStatus::Unsupported, reason::kNoVulkan,
                  "Vulkan is not available on this device, so AI upscaling cannot run.",
                  "The engine's compute pipeline requires Vulkan 1.1. A GLES 3.1 fallback is "
                  "planned but not implemented; the analytical CPU path exists only for "
                  "offline/model validation.",
                  true);
        r.achievableMode = UpscaleMode::Disabled;
        r.achievableBackend = InferenceBackend::None;
    } else {
        if (caps.isSoftwareRenderer()) {
            addReason(r, CompatStatus::Unsupported, reason::kSoftwareRenderer,
                      "The Vulkan driver is a software rasteriser (emulator or missing GPU driver).",
                      "Device reports: " + caps.vulkan.deviceName +
                          ". Real-time upscaling is not achievable in software.",
                      true);
        }
        if (!caps.vulkan.hasComputeQueue) {
            addReason(r, CompatStatus::Unsupported, reason::kNoComputeQueue,
                      "The GPU exposes no compute queue, which the upscaler requires.",
                      "VK_QUEUE_COMPUTE_BIT was not found on any queue family.", true);
        }
        if (caps.vulkan.maxComputeWorkGroupInvocations > 0 &&
            caps.vulkan.maxComputeWorkGroupInvocations < 64) {
            addReason(r, CompatStatus::Unsupported, reason::kComputeLimits,
                      "The GPU's maximum workgroup size is too small for the compute kernels.",
                      "maxComputeWorkGroupInvocations = " +
                          std::to_string(caps.vulkan.maxComputeWorkGroupInvocations),
                      true);
        }
        if (caps.vulkan.maxComputeSharedMemorySize > 0 &&
            caps.vulkan.maxComputeSharedMemorySize < 16384) {
            addReason(r, CompatStatus::PartiallySupported, reason::kLowSharedMemory,
                      "Small compute shared memory: tiled kernels fall back to a slower variant.",
                      "maxComputeSharedMemorySize = " +
                          std::to_string(caps.vulkan.maxComputeSharedMemorySize) + " bytes");
        }
        if (!caps.vulkan.hasStorageImageRgba8) {
            addReason(r, CompatStatus::Unsupported, reason::kNoStorageImage,
                      "This GPU cannot use RGBA8 images for compute writes.",
                      "The whole pipeline writes its results with imageStore().", true);
        } else if (!caps.vulkan.hasStorageImageR8) {
            addReason(r, CompatStatus::PartiallySupported, reason::kNoR8Storage,
                      "Single-channel storage images are unsupported: luma planes use RGBA8 "
                      "and cost extra bandwidth.",
                      "R8G8B8A8_UNORM is used for luma/history planes.");
        }
        if (caps.vulkan.apiVersion < kVkVersion11) {
            addReason(r, CompatStatus::PartiallySupported, reason::kVk10Only,
                      "Only Vulkan 1.0 is exposed: the engine runs in a reduced mode.",
                      "Reported version " + versionString(caps.vulkan.apiVersion) +
                          ". Timeline semaphores and several storage formats are unavailable, "
                          "so the pipeline synchronises with fences and one extra copy.");
        }
        if (!caps.vulkan.hasFloat16Storage) {
            addReason(r, CompatStatus::PartiallySupported, reason::kNoFp16,
                      "FP16 shader storage is unavailable: neural weights run as FP32.",
                      "VK_KHR_16bit_storage / shaderFloat16 not reported. This mainly raises "
                      "weight bandwidth, not final quality.");
        }
        if (!caps.vulkan.hasInt8Storage) {
            addReason(r, CompatStatus::PartiallySupported, reason::kNoInt8,
                      "INT8 storage is unavailable: quantised models are unpacked to FP16/FP32.",
                      "VK_KHR_8bit_storage not reported. INT8 models still work, but the GPU "
                      "must widen them first.");
        }
        if (caps.vulkan.maxImageDimension2D > 0 && caps.vulkan.maxImageDimension2D < 4096) {
            addReason(r, CompatStatus::PartiallySupported, reason::kMaxImageDimension,
                      "The GPU limits image size to " + std::to_string(caps.vulkan.maxImageDimension2D) +
                          "px, so 4K output is not possible.",
                      "maxImageDimension2D = " + std::to_string(caps.vulkan.maxImageDimension2D));
        }
        if (caps.vulkan.maxPushConstantsSize > 0 && caps.vulkan.maxPushConstantsSize < 128) {
            addReason(r, CompatStatus::PartiallySupported, reason::kComputeLimits,
                      "Small push-constant budget: per-dispatch parameters go through a "
                      "uniform buffer instead.",
                      "maxPushConstantsSize = " + std::to_string(caps.vulkan.maxPushConstantsSize));
        }
        // Device-local memory.
        if (caps.vulkan.deviceLocalMemoryBytes > 0) {
            if (caps.vulkan.deviceLocalMemoryBytes < 256ull * 1024 * 1024) {
                addReason(r, CompatStatus::Unsupported, reason::kLowMemory,
                          "Device-local GPU memory is too small for the reconstruction buffers.",
                          "Largest DEVICE_LOCAL heap: " + gbString(caps.vulkan.deviceLocalMemoryBytes),
                          true);
            } else if (caps.vulkan.deviceLocalMemoryBytes < 512ull * 1024 * 1024) {
                addReason(r, CompatStatus::Experimental, reason::kLowMemory,
                          "Less than 512 MB of GPU memory: only the lite model fits.",
                          "Largest DEVICE_LOCAL heap: " + gbString(caps.vulkan.deviceLocalMemoryBytes));
            }
        }
        if (caps.memory.totalRamBytes > 0 && caps.memory.totalRamBytes < 3ull * 1024 * 1024 * 1024) {
            addReason(r, CompatStatus::Experimental, reason::kLowMemory,
                      "Less than 3 GB of system RAM: quality modes may be evicted by the OS.",
                      "totalRam = " + gbString(caps.memory.totalRamBytes));
        }
        if (caps.memory.lowRamDevice) {
            addReason(r, CompatStatus::Experimental, reason::kLowMemory,
                      "Android reports this as a low-RAM device.",
                      "ActivityManager.isLowRamDevice() == true");
        }

        // ---- 3. AI backend -------------------------------------------------
        if (profile.aiUpscaling && profile.aiQuality != AiQuality::Off) {
            if (input.aiModelInstalled) {
                if (caps.vulkan.hasComputeQueue && caps.vulkan.hasStorageImageRgba8) {
                    r.achievableMode = UpscaleMode::Neural;
                    r.achievableBackend = InferenceBackend::GpuVulkan;
                }
            } else {
                addReason(r, CompatStatus::Experimental, reason::kNoModel,
                          "No AI model is installed: the engine will use the analytical "
                          "edge-directed reconstruction, which is not a neural network.",
                          "Install a Mobile SR model from the AI Engine screen, or point the "
                          "model manager at your own repository. Models are downloaded on "
                          "demand and verified by SHA-256.");
                r.achievableMode = UpscaleMode::Analytical;
                r.achievableBackend = InferenceBackend::None;
            }
            if (input.preferNpu) {
                if (input.nnapiModelAvailable && caps.neural.nnapiAvailable) {
                    addReason(r, CompatStatus::Experimental, reason::kNnapiExperimental,
                              "NNAPI execution is requested (experimental).",
                              "NNAPI lowering is only available for models exported in the "
                              "NNAPI-compatible package format; the GPU path remains the "
                              "default because NNAPI adds driver-level latency.");
                    r.achievableBackend = InferenceBackend::Nnapi;
                } else if (!caps.neural.nnapiAvailable) {
                    addReason(r, CompatStatus::Experimental, reason::kNnapiExperimental,
                              "NNAPI is unavailable on this device (Android 8.1+ required).",
                              "Falling back to the Vulkan compute backend.");
                } else {
                    addReason(r, CompatStatus::Experimental, reason::kNnapiExperimental,
                              "NNAPI requested, but no NNAPI-compatible model is installed.",
                              "The GPU backend is used instead.");
                }
            }
        } else {
            r.achievableMode = (profile.aiUpscaling ? UpscaleMode::Analytical : UpscaleMode::Disabled);
        }
    }

    // ---- 4. Integration: can we actually change this game's resolution? ----
    switch (input.integration) {
        case IntegrationKind::SdkIntegrated:
            addReason(r, CompatStatus::Supported, reason::kOk,
                      "This game integrates the AIUpscaler SDK: the engine runs inside the "
                      "game's own Vulkan pipeline and replaces its render resolution.",
                      "AIUpscaler.initialize()/setInputResolution()/setOutputResolution()/"
                      "processFrame() are driven by the game's render loop.");
            break;

        case IntegrationKind::SampleDemo:
            addReason(r, CompatStatus::Supported, reason::kOk,
                      "Built-in Vulkan demo scene: a complete reference integration that renders "
                      "at a low internal resolution and reconstructs to 1080p/4K.",
                      "Source: cpp/demo/. Switch Native <-> AI upscaling live and compare.");
            break;

        case IntegrationKind::ScreenEnhance:
            if (!input.screenCapturePossible) {
                addReason(r, CompatStatus::Unsupported, reason::kCaptureUnavailable,
                          "Screen capture permission was declined, so screen enhancement "
                          "cannot run.",
                          "MediaProjection requires an explicit user consent dialog.", true);
            } else {
                addReason(r, CompatStatus::Experimental, reason::kScreenEnhance,
                          "Experimental screen enhancement: frames are captured with "
                          "MediaProjection, reconstructed, and displayed inside AI Vision 4K.",
                          "This does NOT change the game's internal resolution. The game keeps "
                          "rendering as before; you see an enhanced copy in our view with at "
                          "least one frame of added latency, and it stops when you leave the app.");
                r.achievableMode = profile.aiUpscaling ? r.achievableMode : UpscaleMode::Analytical;
            }
            break;

        case IntegrationKind::None:
        default:
            addReason(r, CompatStatus::Unsupported, reason::kNoIntegration,
                      "This game does not integrate the AI upscaler, so its render resolution "
                      "cannot be changed by AI Vision 4K.",
                      "Android sandboxing prevents one application from injecting shaders or "
                      "replacing another application's swapchain. No app (including this one) "
                      "can do that without the game's cooperation. Only SDK-integrated games "
                      "get true in-pipeline AI upscaling; for anything else this profile can "
                      "apply OS-level performance hints and show live metrics.",
                      true);
            r.achievableMode = UpscaleMode::Disabled;
            break;
    }

    // ---- 5. Monitoring capabilities (still useful without integration) ----
    r.monitoringAvailable = true;  // FPS/frame-time/CPU/RAM come from our own loop
    r.overlayAvailable = true;     // in-app overlay always; system overlay needs permission
    r.gameModeHintAvailable = caps.thermal.gameManagerAvailable;
    if (caps.thermal.gameManagerAvailable) {
        addReason(r, CompatStatus::Supported, reason::kPerformanceMode,
                  "Android GameManager is available: game mode and FPS-range hints can be set "
                  "for this package by the system.",
                  caps.thermal.gameModeSupported ? "GameManager.isGameModeSupported() == true"
                                                 : "Game mode not supported for this app; "
                                                   "performance hints only.");
    }
    if (!caps.thermal.powerManagerThermalApi && !caps.thermal.batteryTemperature) {
        addReason(r, CompatStatus::Experimental, reason::kNoThermalSensors,
                  "No thermal sensors are exposed: the governor relies on the platform thermal "
                  "status and on sustained frame-time breaches.",
                  "PowerManager.getCurrentThermalStatus() requires API 29+; battery "
                  "temperature comes from the ACTION_BATTERY_CHANGED sticky broadcast.");
    }

    // ---- 6. Sanity of the requested configuration --------------------------
    if (profile.output.pixels() > 1920ull * 1080ull && r.tier <= DeviceTier::Entry) {
        addReason(r, CompatStatus::Experimental, reason::kSupersampleOnly,
                  "Requesting more than 1080p output on an entry-tier GPU will not hold a "
                  "playable frame rate.",
                  "Tier " + std::string(toString(r.tier)) + "; the governor will step the "
                  "output and AI quality down automatically.");
    }

    // Recommendations
    r.recommendedOutput = recommendedOutputResolution(caps, r.tier);
    r.recommendedRenderScalePercent = recommendedRenderScale(r.tier);
    r.maximumAiQuality = recommendedAiQuality(r.tier);

    // ---- 7. Headline ------------------------------------------------------
    if (r.status == CompatStatus::Unsupported) {
        if (input.integration == IntegrationKind::None) {
            r.headline = "Unsupported for in-pipeline upscaling: this game does not integrate "
                         "the SDK. Monitoring and OS hints still work.";
        } else {
            r.headline = "Unsupported on this device. See the reasons below.";
        }
    } else if (r.status == CompatStatus::Experimental) {
        r.headline = "Experimental: it runs, but with explicit limitations.";
    } else if (r.status == CompatStatus::PartiallySupported) {
        r.headline = "Partially supported: the engine degrades to the listed fallbacks.";
    } else {
        r.headline = "Supported.";
    }

    // The device is the gate for everything: if the device cannot run the
    // engine, no integration can rescue it (except monitoring).
    if (!caps.hasUsableVulkan() || caps.isSoftwareRenderer()) {
        r.status = CompatStatus::Unsupported;
        r.achievableMode = UpscaleMode::Disabled;
        r.achievableBackend = InferenceBackend::None;
        r.headline = "Unsupported on this device. See the reasons below.";
    }

    if (r.achievableMode == UpscaleMode::Neural &&
        r.achievableBackend != InferenceBackend::GpuVulkan &&
        r.achievableBackend != InferenceBackend::Nnapi) {
        r.achievableBackend = InferenceBackend::GpuVulkan;
    }
    if (r.achievableMode == UpscaleMode::Disabled && r.achievableBackend == InferenceBackend::Cpu) {
        r.achievableBackend = InferenceBackend::None;
    }

    V4K_LOGI("compat: status=%s tier=%s mode=%s backend=%s reasons=%zu", toString(r.status),
             toString(r.tier), toString(r.achievableMode), toString(r.achievableBackend),
             r.reasons.size());
    return r;
}

std::string CompatResult::toJson() const {
    JsonWriter w(2);
    w.beginObject();
    w.field("status", toString(status));
    w.field("tier", toString(tier));
    w.field("achievableMode", toString(achievableMode));
    w.field("achievableBackend", toString(achievableBackend));
    w.field("recommendedOutputWidth", recommendedOutput.width);
    w.field("recommendedOutputHeight", recommendedOutput.height);
    w.field("recommendedOutputLabel", recommendedOutput.label());
    w.field("recommendedRenderScalePercent", recommendedRenderScalePercent);
    w.field("maximumAiQuality", toString(maximumAiQuality));
    w.field("monitoringAvailable", monitoringAvailable);
    w.field("overlayAvailable", overlayAvailable);
    w.field("gameModeHintAvailable", gameModeHintAvailable);
    w.field("headline", headline);
    w.key("reasons");
    w.beginArray();
    for (const auto& reason : reasons) {
        w.beginObject();
        w.field("cap", toString(reason.cap));
        w.field("code", reason.code);
        w.field("message", reason.message);
        w.field("detail", reason.detail);
        w.field("blocking", reason.blocking);
        w.endObject();
    }
    w.endArray();
    w.endObject();
    return w.str();
}

}  // namespace v4k
