// Graphics profiles: presets, resolution ladders and validation.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "v4k_common.h"
#include "v4k_device.h"

namespace v4k {

struct Resolution {
    uint32_t width = 1280;
    uint32_t height = 720;
    bool operator==(const Resolution& o) const { return width == o.width && height == o.height; }
    uint64_t pixels() const { return static_cast<uint64_t>(width) * height; }
    std::string label() const;   // "720p", "1080p", "1440p", "4K" or "1920x1080"
};

// The resolution ladder offered in the UI.
const std::vector<Resolution>& outputResolutionLadder();
// Render scale ladder, in percent of the output resolution.
const std::vector<int>& renderScaleLadder();
bool isAllowedRenderScale(int percent);
int nearestAllowedRenderScale(int percent);

// Named tiers the engine ranks a device into.
enum class DeviceTier : int32_t {
    Unsupported = 0,
    Entry = 1,
    Mid = 2,
    High = 3,
    Flagship = 4,
};

inline const char* toString(DeviceTier t) {
    switch (t) {
        case DeviceTier::Unsupported: return "UNSUPPORTED";
        case DeviceTier::Entry: return "ENTRY";
        case DeviceTier::Mid: return "MID";
        case DeviceTier::High: return "HIGH";
        case DeviceTier::Flagship: return "FLAGSHIP";
    }
    return "UNSUPPORTED";
}

DeviceTier classifyDeviceTier(const DeviceCapabilities& caps);

struct GraphicsProfile {
    std::string id;
    std::string name;
    std::string packageName;      // may be empty for a template profile
    std::string gameTitle;

    QualityPreset preset = QualityPreset::Balanced;
    int renderScalePercent = 67;
    Resolution output{1920, 1080};

    bool aiUpscaling = true;
    AiQuality aiQuality = AiQuality::Medium;
    float sharpening = 0.20f;      // 0..1
    float noiseReduction = 0.15f;  // 0..1
    bool antiAliasing = true;
    bool motionAware = true;
    bool dynamicResolution = true;

    int targetFps = 60;            // 0 = uncapped / follow display
    bool performanceMode = false;
    bool batteryMode = false;
    bool thermalGuard = true;

    IntegrationKind integration = IntegrationKind::None;

    // Derived: the internal render resolution implied by output * scale.
    Resolution inputResolution() const;
    // Frame budget in milliseconds (0 when uncapped).
    float frameBudgetMs() const;
    // Supersample factor against a given display.
    float supersampleFactor(uint32_t displayWidth, uint32_t displayHeight) const;
};

// Preset templates. `output` is clamped by validation for the actual device.
GraphicsProfile makePresetProfile(QualityPreset preset, Resolution output);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
struct ValidationMessage {
    enum class Severity { Info, Warning, Error };
    Severity severity = Severity::Info;
    std::string field;
    std::string message;
};

struct ValidationResult {
    bool ok = true;                       // false == at least one Error
    bool modified = false;                // fields were clamped
    std::vector<ValidationMessage> messages;

    std::string toJson() const;
    bool hasError() const;
};

// Clamps an arbitrary (possibly hostile/hand edited) profile into a legal shape
// and reports everything it had to change. `caps` may be null (no device info).
ValidationResult validateProfile(GraphicsProfile& profile, const DeviceCapabilities* caps);

// Model tier a profile wants: LOW -> Mobile SR Lite, MEDIUM -> Balanced, HIGH/ULTRA -> Quality.
std::string preferredModelId(AiQuality quality);

// ---------------------------------------------------------------------------
// Serialisation (JSON, as used across the JNI boundary)
// ---------------------------------------------------------------------------
std::string profileToJson(const GraphicsProfile& profile);
bool profileFromJson(const std::string& json, GraphicsProfile& out, std::string* error);

}  // namespace v4k
