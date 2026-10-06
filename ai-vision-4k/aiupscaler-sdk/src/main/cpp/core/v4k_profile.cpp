#include "v4k_profile.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "v4k_json.h"
#include "v4k_log.h"

namespace v4k {
namespace {

constexpr uint32_t kMinOutputWidth = 640;
constexpr uint32_t kMaxOutputWidth = 4096;   // 4K is the top of the ladder
constexpr uint32_t kMaxAspectRatio = 32;     // 32:9 ultrawide
const std::vector<int> kFpsSteps = {0, 30, 45, 60, 90, 120, 144};

GraphicsProfile presetBase(QualityPreset preset, Resolution output) {
    GraphicsProfile p;
    p.preset = preset;
    p.output = output;
    p.integration = IntegrationKind::SdkIntegrated;  // presets are for integrated games
    p.thermalGuard = true;

    switch (preset) {
        case QualityPreset::Quality:
            p.renderScalePercent = 75;
            p.aiQuality = AiQuality::High;
            p.sharpening = 0.15f;
            p.noiseReduction = 0.10f;
            p.dynamicResolution = true;
            p.targetFps = 60;
            p.performanceMode = false;
            break;

        case QualityPreset::Balanced:
            p.renderScalePercent = 67;
            p.aiQuality = AiQuality::Medium;
            p.sharpening = 0.20f;
            p.noiseReduction = 0.15f;
            p.dynamicResolution = true;
            p.targetFps = 60;
            p.performanceMode = false;
            break;

        case QualityPreset::Performance:
            p.renderScalePercent = 50;
            p.aiQuality = AiQuality::Low;
            p.sharpening = 0.25f;
            p.noiseReduction = 0.20f;
            p.dynamicResolution = true;
            p.targetFps = 60;
            p.performanceMode = true;
            break;

        case QualityPreset::Extreme:
            // Experimental: render small, reconstruct large. Only meaningful on
            // devices that can afford a 4K storage image and the bandwidth.
            p.renderScalePercent = 50;
            p.aiQuality = AiQuality::Ultra;
            p.sharpening = 0.10f;
            p.noiseReduction = 0.05f;
            p.dynamicResolution = true;
            p.targetFps = 30;
            p.performanceMode = false;
            break;
    }
    return p;
}

void addMessage(ValidationResult& r, ValidationMessage::Severity sev, const std::string& field,
                const std::string& message) {
    ValidationMessage m;
    m.severity = sev;
    m.field = field;
    m.message = message;
    r.messages.push_back(std::move(m));
    if (sev == ValidationMessage::Severity::Error) r.ok = false;
    if (sev != ValidationMessage::Severity::Info) r.modified = true;
}

std::string severityToString(ValidationMessage::Severity s) {
    switch (s) {
        case ValidationMessage::Severity::Info: return "INFO";
        case ValidationMessage::Severity::Warning: return "WARNING";
        case ValidationMessage::Severity::Error: return "ERROR";
    }
    return "INFO";
}

}  // namespace

// ---------------------------------------------------------------------------
// Ladders
// ---------------------------------------------------------------------------
const std::vector<Resolution>& outputResolutionLadder() {
    static const std::vector<Resolution> ladder = {
        {1280, 720},   // 720p
        {1600, 900},   // 900p
        {1920, 1080},  // 1080p
        {2560, 1440},  // 1440p
        {3840, 2160},  // 4K
    };
    return ladder;
}

const std::vector<int>& renderScaleLadder() {
    static const std::vector<int> ladder = {50, 60, 67, 75, 83, 100};
    return ladder;
}

bool isAllowedRenderScale(int percent) {
    const auto& ladder = renderScaleLadder();
    return std::find(ladder.begin(), ladder.end(), percent) != ladder.end();
}

int nearestAllowedRenderScale(int percent) {
    const auto& ladder = renderScaleLadder();
    int best = ladder.front();
    int bestDelta = std::abs(percent - best);
    for (int v : ladder) {
        const int delta = std::abs(percent - v);
        if (delta < bestDelta) {
            bestDelta = delta;
            best = v;
        }
    }
    return best;
}

std::string Resolution::label() const {
    for (const auto& r : outputResolutionLadder()) {
        if (r.width == width && r.height == height) {
            if (r.width == 1280) return "720p";
            if (r.width == 1600) return "900p";
            if (r.width == 1920) return "1080p";
            if (r.width == 2560) return "1440p";
            if (r.width == 3840) return "4K";
        }
    }
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%ux%u", width, height);
    return buf;
}

// ---------------------------------------------------------------------------
// GraphicsProfile helpers
// ---------------------------------------------------------------------------
Resolution GraphicsProfile::inputResolution() const {
    const double scale = static_cast<double>(renderScalePercent) / 100.0;
    // Round to even numbers: every consumer (Vulkan images, model padding)
    // wants even dimensions for 2x pixel-shuffle stages.
    auto even = [](double v) {
        uint32_t r = static_cast<uint32_t>(std::lround(v));
        r = (r + 1u) & ~1u;
        return std::max(2u, r);
    };
    Resolution in;
    in.width = even(output.width * scale);
    in.height = even(output.height * scale);
    return in;
}

float GraphicsProfile::frameBudgetMs() const {
    if (targetFps <= 0) return 0.0f;
    return 1000.0f / static_cast<float>(targetFps);
}

float GraphicsProfile::supersampleFactor(uint32_t displayWidth, uint32_t displayHeight) const {
    if (displayWidth == 0 || displayHeight == 0) return 1.0f;
    const double outPixels = static_cast<double>(output.pixels());
    const double dispPixels = static_cast<double>(displayWidth) * displayHeight;
    return static_cast<float>(std::sqrt(outPixels / dispPixels));
}

GraphicsProfile makePresetProfile(QualityPreset preset, Resolution output) {
    if (output.width == 0 || output.height == 0) {
        switch (preset) {
            case QualityPreset::Quality: output = {2560, 1440}; break;
            case QualityPreset::Balanced: output = {1920, 1080}; break;
            case QualityPreset::Performance: output = {1920, 1080}; break;
            case QualityPreset::Extreme: output = {3840, 2160}; break;
        }
    }
    return presetBase(preset, output);
}

std::string preferredModelId(AiQuality quality) {
    switch (quality) {
        case AiQuality::Off: return "";
        case AiQuality::Low: return "mobile_sr_lite";
        case AiQuality::Medium: return "mobile_sr_balanced";
        case AiQuality::High:
        case AiQuality::Ultra: return "mobile_sr_quality";
    }
    return "";
}

// ---------------------------------------------------------------------------
// Device classification
// ---------------------------------------------------------------------------
namespace {

// Heuristic SoC/tier mapping. Deliberately transparent: the UI shows the score
// components so a user can see *why* a device landed in a tier.
struct SocHint {
    const char* needle;
    DeviceTier tier;
};

const SocHint kSocHints[] = {
    {"SM8750", DeviceTier::Flagship}, {"SM8650", DeviceTier::Flagship}, {"SM8550", DeviceTier::Flagship},
    {"SM8475", DeviceTier::High},     {"SM8450", DeviceTier::High},     {"SM8350", DeviceTier::High},
    {"SM8250", DeviceTier::High},     {"SM8150", DeviceTier::High},     {"SM7750", DeviceTier::Mid},
    {"SM7650", DeviceTier::Mid},      {"SM7550", DeviceTier::Mid},      {"SM7450", DeviceTier::Mid},
    {"SM7350", DeviceTier::Mid},      {"SM7325", DeviceTier::Mid},      {"SM7250", DeviceTier::Mid},
    {"SM7150", DeviceTier::Mid},      {"SM7125", DeviceTier::Mid},      {"SM6350", DeviceTier::Entry},
    {"SM6125", DeviceTier::Entry},    {"SM6115", DeviceTier::Entry},    {"SM4250", DeviceTier::Entry},
    {"MT6989", DeviceTier::Flagship}, {"MT6985", DeviceTier::Flagship}, {"MT6983", DeviceTier::High},
    {"MT6895", DeviceTier::High},     {"MT6893", DeviceTier::Mid},      {"MT6877", DeviceTier::Mid},
    {"MT6853", DeviceTier::Mid},      {"MT6833", DeviceTier::Entry},    {"MT6769", DeviceTier::Entry},
    {"MT6768", DeviceTier::Entry},    {"EXYNOS2200", DeviceTier::High}, {"EXYNOS2100", DeviceTier::High},
    {"EXYNOS1380", DeviceTier::Mid},  {"EXYNOS1280", DeviceTier::Mid},  {"EXYNOS990", DeviceTier::Mid},
    {"EXYNOS850", DeviceTier::Entry}, {"TENSOR", DeviceTier::High},     {"GS101", DeviceTier::High},
    {"RK3588", DeviceTier::Mid},      {"RK3568", DeviceTier::Entry},    {"T618", DeviceTier::Entry},
};

DeviceTier tierFromSocString(const std::string& soc) {
    std::string s;
    s.reserve(soc.size());
    for (char c : soc) s += static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    for (const auto& hint : kSocHints) {
        if (s.find(hint.needle) != std::string::npos) return hint.tier;
    }
    return DeviceTier::Unsupported;
}

DeviceTier minTier(DeviceTier a, DeviceTier b) { return static_cast<int>(a) < static_cast<int>(b) ? a : b; }

}  // namespace

DeviceTier classifyDeviceTier(const DeviceCapabilities& caps) {
    // A device is only ever as capable as its weakest relevant constraint.
    if (!caps.hasUsableVulkan() || caps.isSoftwareRenderer()) return DeviceTier::Unsupported;

    DeviceTier tier = tierFromSocString(caps.android.socModel);
    if (tier == DeviceTier::Unsupported) {
        tier = tierFromSocString(caps.android.hardware);
    }
    if (tier == DeviceTier::Unsupported) {
        // Unknown SoC: fall back on measurable properties.
        if (caps.vulkan.apiVersion >= 0x401000 /* 1.1 */ && caps.memory.totalRamBytes >= 8ull * 1024 * 1024 * 1024) {
            tier = DeviceTier::High;
        } else if (caps.vulkan.apiVersion >= 0x401000) {
            tier = DeviceTier::Mid;
        } else {
            tier = DeviceTier::Entry;
        }
    }

    // Hard constraints that cap the tier regardless of the marketing name.
    if (!caps.vulkan.hasStorageImageRgba8) tier = minTier(tier, DeviceTier::Entry);
    if (caps.vulkan.maxComputeWorkGroupInvocations > 0 && caps.vulkan.maxComputeWorkGroupInvocations < 64) {
        tier = minTier(tier, DeviceTier::Entry);
    }
    if (caps.vulkan.maxImageDimension2D > 0 && caps.vulkan.maxImageDimension2D < 4096) {
        tier = minTier(tier, DeviceTier::Mid);
    }
    if (caps.memory.totalRamBytes > 0 && caps.memory.totalRamBytes < 4ull * 1024 * 1024 * 1024) {
        tier = minTier(tier, DeviceTier::Mid);
    }
    if (caps.memory.totalRamBytes > 0 && caps.memory.totalRamBytes < 3ull * 1024 * 1024 * 1024) {
        tier = minTier(tier, DeviceTier::Entry);
    }
    return tier;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
ValidationResult validateProfile(GraphicsProfile& profile, const DeviceCapabilities* caps) {
    ValidationResult r;

    // --- render scale -------------------------------------------------------
    if (!isAllowedRenderScale(profile.renderScalePercent)) {
        const int snapped = nearestAllowedRenderScale(profile.renderScalePercent);
        addMessage(r, ValidationMessage::Severity::Warning, "renderScalePercent",
                   "Render scale " + std::to_string(profile.renderScalePercent) +
                       "% is not on the ladder; snapped to " + std::to_string(snapped) + "%.");
        profile.renderScalePercent = snapped;
    }

    // --- output resolution --------------------------------------------------
    // Aspect sanity first, on what was *requested*: overly wide/tall shapes are
    // rejected outright because they cannot come from the resolution ladder.
    {
        const uint32_t longSide = std::max(profile.output.width, profile.output.height);
        const uint32_t shortSide = std::max(1u, std::min(profile.output.width, profile.output.height));
        if (longSide / shortSide > kMaxAspectRatio) {
            addMessage(r, ValidationMessage::Severity::Error, "output",
                       "Aspect ratio beyond 32:9 is rejected (requested " +
                           std::to_string(profile.output.width) + "x" +
                           std::to_string(profile.output.height) + ").");
            profile.output = {1280, 720};
        }
    }
    if (profile.output.width < kMinOutputWidth || profile.output.height < 360) {
        addMessage(r, ValidationMessage::Severity::Error, "output",
                   "Output resolution " + profile.output.label() + " is below the 640x360 minimum.");
        profile.output = {1280, 720};
    }
    if (profile.output.width > kMaxOutputWidth || profile.output.height > 2160) {
        addMessage(r, ValidationMessage::Severity::Warning, "output",
                   "Output resolution above 4K is not supported by this build; clamped to 4K.");
        profile.output = {3840, 2160};
    }
    if (caps != nullptr && caps->vulkan.available && caps->vulkan.maxImageDimension2D > 0) {
        const uint32_t maxDim = caps->vulkan.maxImageDimension2D;
        if (profile.output.width > maxDim || profile.output.height > maxDim) {
            addMessage(r, ValidationMessage::Severity::Error, "output",
                       "This GPU caps 2D images at " + std::to_string(maxDim) + "px; " +
                           profile.output.label() + " output is impossible.");
            profile.output = {1280, 720};
        }
    }

    // --- AI settings --------------------------------------------------------
    clampTo(profile.sharpening, 0.0f, 1.0f);
    clampTo(profile.noiseReduction, 0.0f, 1.0f);

    if (!profile.aiUpscaling && profile.aiQuality != AiQuality::Off) {
        profile.aiQuality = AiQuality::Off;
        addMessage(r, ValidationMessage::Severity::Info, "aiQuality",
                   "AI upscaling is off, so AI quality was set to OFF.");
    }
    if (profile.aiUpscaling && profile.aiQuality == AiQuality::Off) {
        // Explicitly allowed: AI on, quality Off means "analytical reconstruction only".
        addMessage(r, ValidationMessage::Severity::Info, "aiQuality",
                   "AI quality OFF with upscaling enabled: only the analytical "
                   "edge-directed reconstruction runs (no neural network).");
    }

    if (caps != nullptr) {
        const bool neuralPossible = caps->hasUsableVulkan() || caps->neural.nnapiAvailable;
        if (profile.aiQuality != AiQuality::Off && !neuralPossible) {
            addMessage(r, ValidationMessage::Severity::Warning, "aiQuality",
                       "Neither Vulkan compute nor NNAPI is available on this device; "
                       "neural reconstruction cannot run (analytical fallback only).");
        }
        if (profile.aiQuality == AiQuality::Ultra && !caps->vulkan.hasFloat16Storage) {
            addMessage(r, ValidationMessage::Severity::Info, "aiQuality",
                       "FP16 storage is unavailable: ULTRA will execute the model in "
                       "FP32, which costs more bandwidth and time.");
        }
        if (profile.preset == QualityPreset::Extreme) {
            addMessage(r, ValidationMessage::Severity::Warning, "preset",
                       "EXTREME is experimental: 4K output at 50% render scale is only "
                       "viable on flagship GPUs and will be throttled by the thermal governor.");
        }
        if (caps->memory.totalRamBytes > 0 && caps->memory.totalRamBytes < 4ull * 1024 * 1024 * 1024 &&
            profile.output.pixels() > 1920ull * 1080ull) {
            addMessage(r, ValidationMessage::Severity::Warning, "output",
                       "Output above 1080p on a device with under 4 GB RAM risks memory pressure.");
        }
    }

    // --- frame rate ---------------------------------------------------------
    const int fps = profile.targetFps;
    if (fps != 0) {
        bool known = false;
        for (int candidate : kFpsSteps) {
            if (candidate == fps) known = true;
        }
        if (!known) {
            int best = kFpsSteps[1];
            int bestDelta = std::abs(fps - best);
            for (int candidate : kFpsSteps) {
                const int delta = std::abs(fps - candidate);
                if (delta < bestDelta) {
                    bestDelta = delta;
                    best = candidate;
                }
            }
            addMessage(r, ValidationMessage::Severity::Warning, "targetFps",
                       "Target FPS " + std::to_string(fps) + " snapped to " + std::to_string(best) + ".");
            profile.targetFps = best;
        }
    }
    if (caps != nullptr && caps->android.displayRefreshRate > 0 && profile.targetFps > 0 &&
        static_cast<float>(profile.targetFps) > caps->android.displayRefreshRate + 0.5f) {
        addMessage(r, ValidationMessage::Severity::Info, "targetFps",
                   "Target FPS exceeds the display refresh rate (" +
                       std::to_string(static_cast<int>(caps->android.displayRefreshRate)) + " Hz).");
    }

    // --- modes --------------------------------------------------------------
    if (profile.batteryMode) {
        if (profile.aiQuality > AiQuality::Medium) {
            profile.aiQuality = AiQuality::Medium;
            addMessage(r, ValidationMessage::Severity::Info, "aiQuality",
                       "Battery mode caps AI quality at MEDIUM.");
        }
        if (profile.targetFps == 0 || profile.targetFps > 60) {
            profile.targetFps = 60;
            addMessage(r, ValidationMessage::Severity::Info, "targetFps",
                       "Battery mode caps the frame rate at 60 FPS.");
        }
        profile.dynamicResolution = true;
    }
    if (profile.performanceMode) {
        profile.dynamicResolution = true;
    }
    if (!profile.thermalGuard && profile.preset != QualityPreset::Performance) {
        addMessage(r, ValidationMessage::Severity::Warning, "thermalGuard",
                   "Thermal protection is disabled. The device may throttle or overheat; "
                   "the engine will still cut AI work at CRITICAL battery temperature.");
    }

    // --- integration honesty ------------------------------------------------
    if (profile.integration == IntegrationKind::None) {
        addMessage(r, ValidationMessage::Severity::Info, "integration",
                   "No SDK integration: this profile affects monitoring and OS hints only. "
                   "Android does not allow one app to replace another app's render resolution.");
    } else if (profile.integration == IntegrationKind::ScreenEnhance) {
        addMessage(r, ValidationMessage::Severity::Info, "integration",
                   "Experimental screen enhancement: frames are captured via MediaProjection, "
                   "enhanced and shown in AI Vision 4K's own view. The game itself still "
                   "renders at its own resolution, and a frame of added latency applies.");
    }

    if (profile.aiUpscaling && profile.renderScalePercent > 83) {
        addMessage(r, ValidationMessage::Severity::Info, "renderScalePercent",
                   "Render scale above 83% leaves little headroom for reconstruction: "
                   "the upscaler will mostly behave like a sharpening pass.");
    }

    return r;
}

std::string ValidationResult::toJson() const {
    JsonWriter w;
    w.beginObject();
    w.field("ok", ok);
    w.field("modified", modified);
    w.key("messages");
    w.beginArray();
    for (const auto& m : messages) {
        w.beginObject();
        w.field("severity", severityToString(m.severity));
        w.field("field", m.field);
        w.field("message", m.message);
        w.endObject();
    }
    w.endArray();
    w.endObject();
    return w.str();
}

bool ValidationResult::hasError() const { return !ok; }

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------
std::string profileToJson(const GraphicsProfile& p) {
    JsonWriter w;
    w.beginObject();
    w.field("id", p.id);
    w.field("name", p.name);
    w.field("packageName", p.packageName);
    w.field("gameTitle", p.gameTitle);
    w.field("preset", toString(p.preset));
    w.field("renderScalePercent", p.renderScalePercent);
    w.field("inputWidth", p.inputResolution().width);
    w.field("inputHeight", p.inputResolution().height);
    w.field("outputWidth", p.output.width);
    w.field("outputHeight", p.output.height);
    w.field("outputLabel", p.output.label());
    w.field("aiUpscaling", p.aiUpscaling);
    w.field("aiQuality", toString(p.aiQuality));
    w.field("sharpening", p.sharpening);
    w.field("noiseReduction", p.noiseReduction);
    w.field("antiAliasing", p.antiAliasing);
    w.field("motionAware", p.motionAware);
    w.field("dynamicResolution", p.dynamicResolution);
    w.field("targetFps", p.targetFps);
    w.field("performanceMode", p.performanceMode);
    w.field("batteryMode", p.batteryMode);
    w.field("thermalGuard", p.thermalGuard);
    w.field("integration", toString(p.integration));
    w.field("preferredModel", preferredModelId(p.aiQuality));
    w.field("frameBudgetMs", p.frameBudgetMs());
    w.endObject();
    return w.str();
}

bool profileFromJson(const std::string& json, GraphicsProfile& out, std::string* error) {
    auto root = JsonValue::parse(json, error);
    if (root == nullptr) return false;
    if (!root->isObject()) {
        if (error != nullptr) *error = "profile JSON must be an object";
        return false;
    }
    GraphicsProfile p = out;  // keep defaults for absent keys
    const JsonValue& v = *root;

    if (v.has("id")) p.id = v["id"].asString(p.id);
    if (v.has("name")) p.name = v["name"].asString(p.name);
    if (v.has("packageName")) p.packageName = v["packageName"].asString(p.packageName);
    if (v.has("gameTitle")) p.gameTitle = v["gameTitle"].asString(p.gameTitle);
    if (v.has("preset")) p.preset = qualityPresetFromString(v["preset"].asString(""), p.preset);
    if (v.has("renderScalePercent")) p.renderScalePercent = static_cast<int>(v["renderScalePercent"].asInt(p.renderScalePercent));
    if (v.has("outputWidth") && v.has("outputHeight")) {
        p.output.width = static_cast<uint32_t>(v["outputWidth"].asInt(p.output.width));
        p.output.height = static_cast<uint32_t>(v["outputHeight"].asInt(p.output.height));
    }
    if (v.has("aiUpscaling")) p.aiUpscaling = v["aiUpscaling"].asBool(p.aiUpscaling);
    if (v.has("aiQuality")) p.aiQuality = aiQualityFromString(v["aiQuality"].asString(""), p.aiQuality);
    if (v.has("sharpening")) p.sharpening = v["sharpening"].asFloat(p.sharpening);
    if (v.has("noiseReduction")) p.noiseReduction = v["noiseReduction"].asFloat(p.noiseReduction);
    if (v.has("antiAliasing")) p.antiAliasing = v["antiAliasing"].asBool(p.antiAliasing);
    if (v.has("motionAware")) p.motionAware = v["motionAware"].asBool(p.motionAware);
    if (v.has("dynamicResolution")) p.dynamicResolution = v["dynamicResolution"].asBool(p.dynamicResolution);
    if (v.has("targetFps")) p.targetFps = static_cast<int>(v["targetFps"].asInt(p.targetFps));
    if (v.has("performanceMode")) p.performanceMode = v["performanceMode"].asBool(p.performanceMode);
    if (v.has("batteryMode")) p.batteryMode = v["batteryMode"].asBool(p.batteryMode);
    if (v.has("thermalGuard")) p.thermalGuard = v["thermalGuard"].asBool(p.thermalGuard);
    if (v.has("integration")) p.integration = integrationFromString(v["integration"].asString(""), p.integration);

    out = p;
    return true;
}

}  // namespace v4k
