// Thermal governor.
//
// Hard requirement from the spec: never intentionally overheat the device.
// The governor is a deterministic, hysteretic state machine so that it can be
// reasoned about (and unit tested) independently of any sensor plumbing.
//
// Escalation is immediate; de-escalation requires BOTH a cooldown and a
// hysteresis margin below the threshold, and only steps down one level at a
// time. That is what a real thermal controller does — otherwise the device
// oscillates between quality levels every few frames.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "v4k_common.h"
#include "v4k_profile.h"

namespace v4k {

// PowerManager.THERMAL_STATUS_* values, mirrored so the core does not need
// Android headers.
enum class PlatformThermalStatus : int32_t {
    None = 0,
    Light = 1,
    Moderate = 2,
    Severe = 3,
    Critical = 4,
    Emergency = 5,
    Shutdown = 6,
};

struct ThermalInput {
    int32_t platformStatus = 0;          // PlatformThermalStatus
    float socTempC = 0.0f;               // 0 == unavailable
    float batteryTempC = 0.0f;           // 0 == unavailable
    float averageFrameTimeMs = 0.0f;     // rolling window
    float targetFrameTimeMs = 0.0f;      // 0 == uncapped
    bool thermalGuardEnabled = true;
    int64_t nowMs = 0;
};

struct ThermalThresholds {
    // Degrees Celsius. Below the first value the level is Nominal.
    // Index i separates level i from level i+1 (Light..Shutdown).
    float socC[6] = {68.0f, 73.0f, 78.0f, 83.0f, 88.0f, 93.0f};
    float batteryC[6] = {38.0f, 41.0f, 43.0f, 45.0f, 47.0f, 49.0f};
    float hysteresisC = 4.0f;        // must drop this far below the threshold
    int64_t cooldownMs = 20000;      // minimum dwell before stepping down
    // If the rolling average frame time exceeds the budget by this factor the
    // governor treats it as a thermal/sustained-perf symptom, not as a bug.
    float frameTimeBreachFactor = 1.6f;
};

// The complete set of limits the governor imposes for one frame.
struct ThermalDecision {
    ThermalLevel level = ThermalLevel::Nominal;
    AiQuality maxAiQuality = AiQuality::Ultra;
    int maxRenderScalePercent = 100;
    // Output-resolution ceiling in pixels (0 == no ceiling). This is the
    // "4K -> 1440p -> 1080p" ladder from the product spec: below SEVERE the
    // reconstruction target itself steps down, not just the render scale.
    uint64_t maxOutputPixels = 0;
    int maxTargetFps = 0;              // 0 == no cap
    bool allowAi = true;
    bool allowMotionEstimation = true;
    bool forceDynamicResolution = false;
    bool recommendPause = false;       // "stop the session"
    std::string reason;                // why the level changed (UI + logs)
    std::vector<std::string> actions;  // human readable list of applied limits

    std::string toJson() const;
};

class ThermalGovernor {
public:
    explicit ThermalGovernor(ThermalThresholds thresholds = ThermalThresholds())
        : thresholds_(thresholds) {}

    // Feed one sample. Returns the decision for this frame.
    ThermalDecision update(const ThermalInput& input);

    ThermalDecision current() const { return current_; }
    ThermalLevel level() const { return level_; }
    void reset();

    // Pure helper, exposed for tests and for the UI's "what-if" display.
    static ThermalLevel levelForTemperature(float tempC, const float thresholdsC[6]);
    static ThermalLevel levelForPlatformStatus(int32_t status);

private:
    ThermalThresholds thresholds_;
    ThermalLevel level_ = ThermalLevel::Nominal;
    ThermalDecision current_{};
    int64_t lastEscalationMs_ = -1;
    int64_t lastChangeMs_ = -1;
    ThermalLevel steadyAbove_ = ThermalLevel::Nominal;  // level demanded by raw inputs
    int64_t aboveSinceMs_ = -1;

    void applyLevel(ThermalLevel level, const std::string& reason);
};

// ---------------------------------------------------------------------------
// Effective runtime settings after the governor has had its say.
// This is what the engine actually configures the pipeline with, and it is what
// the dashboard displays (e.g. "ULTRA -> HIGH", "4K -> 1440p").
// ---------------------------------------------------------------------------
struct RuntimeSettings {
    Resolution input{1280, 720};
    Resolution output{1920, 1080};
    AiQuality aiQuality = AiQuality::Medium;
    UpscaleMode mode = UpscaleMode::Disabled;
    float sharpening = 0.2f;
    float noiseReduction = 0.15f;
    bool antiAliasing = true;
    bool motionAware = true;
    bool dynamicResolution = true;
    int targetFps = 60;
    ThermalLevel thermalLevel = ThermalLevel::Nominal;
    bool clampedFromProfile = false;   // true when the governor reduced anything
    std::string governorNote;

    std::string toJson() const;
};

// Combine a validated profile with a thermal decision.
RuntimeSettings resolveRuntimeSettings(const GraphicsProfile& profile, const ThermalDecision& decision,
                                       bool aiModelAvailable);

// ---------------------------------------------------------------------------
// Thermal sampler helpers (platform independent maths, used by the JNI layer).
// ---------------------------------------------------------------------------
// Converts a battery temperature reading (tenths of a degree Celsius, as
// reported by BatteryManager.EXTRA_TEMPERATURE) into Celsius.
inline float batteryTenthsToCelsius(int32_t tenths) { return static_cast<float>(tenths) / 10.0f; }

}  // namespace v4k
