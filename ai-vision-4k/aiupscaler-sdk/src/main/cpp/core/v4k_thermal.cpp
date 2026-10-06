#include "v4k_thermal.h"

#include <algorithm>
#include <cmath>

#include "v4k_json.h"
#include "v4k_log.h"

namespace v4k {

namespace {
const char* levelName(ThermalLevel l) { return toString(l); }
}  // namespace

ThermalLevel ThermalGovernor::levelForTemperature(float tempC, const float thresholdsC[6]) {
    if (tempC <= 0.0f) return ThermalLevel::Nominal;  // unavailable
    // thresholdsC[i] is the temperature at which level (i+1) starts.
    for (int i = 5; i >= 0; --i) {
        if (tempC >= thresholdsC[i]) {
            return static_cast<ThermalLevel>(i + 1);
        }
    }
    return ThermalLevel::Nominal;
}

ThermalLevel ThermalGovernor::levelForPlatformStatus(int32_t status) {
    switch (status) {
        case 0: return ThermalLevel::Nominal;
        case 1: return ThermalLevel::Light;
        case 2: return ThermalLevel::Moderate;
        case 3: return ThermalLevel::Severe;
        case 4: return ThermalLevel::Critical;
        case 5: return ThermalLevel::Emergency;
        case 6: return ThermalLevel::Shutdown;
        default: return ThermalLevel::Nominal;
    }
}

void ThermalGovernor::reset() {
    level_ = ThermalLevel::Nominal;
    current_ = ThermalDecision{};
    lastEscalationMs_ = -1;
    lastChangeMs_ = -1;
    steadyAbove_ = ThermalLevel::Nominal;
    aboveSinceMs_ = -1;
}

void ThermalGovernor::applyLevel(ThermalLevel level, const std::string& reason) {
    level_ = level;
    current_ = ThermalDecision{};
    current_.level = level;
    current_.reason = reason;

    switch (level) {
        case ThermalLevel::Nominal:
            break;

        case ThermalLevel::Light:
            current_.maxAiQuality = AiQuality::High;
            current_.actions.push_back("AI quality ceiling: HIGH");
            break;

        case ThermalLevel::Moderate:
            current_.maxAiQuality = AiQuality::Medium;
            current_.maxRenderScalePercent = 75;
            current_.forceDynamicResolution = true;
            current_.actions.push_back("AI quality ceiling: MEDIUM");
            current_.actions.push_back("Render scale ceiling: 75%");
            break;

        case ThermalLevel::Severe:
            current_.maxAiQuality = AiQuality::Medium;
            current_.maxRenderScalePercent = 67;
            current_.maxOutputPixels = 2560ull * 1440ull;
            current_.maxTargetFps = 60;
            current_.forceDynamicResolution = true;
            current_.actions.push_back("AI quality ceiling: MEDIUM");
            current_.actions.push_back("Render scale ceiling: 67%");
            current_.actions.push_back("Output ceiling: 1440p");
            current_.actions.push_back("Frame rate capped at 60 FPS");
            break;

        case ThermalLevel::Critical:
            current_.maxAiQuality = AiQuality::Low;
            current_.maxRenderScalePercent = 60;
            current_.maxOutputPixels = 1920ull * 1080ull;
            current_.maxTargetFps = 45;
            current_.allowMotionEstimation = false;
            current_.forceDynamicResolution = true;
            current_.actions.push_back("AI quality ceiling: LOW");
            current_.actions.push_back("Render scale ceiling: 60%");
            current_.actions.push_back("Output ceiling: 1080p");
            current_.actions.push_back("Frame rate capped at 45 FPS");
            current_.actions.push_back("Motion estimation disabled (cheaper path)");
            break;

        case ThermalLevel::Emergency:
            current_.allowAi = false;
            current_.maxAiQuality = AiQuality::Off;
            current_.maxRenderScalePercent = 50;
            current_.maxOutputPixels = 1920ull * 1080ull;
            current_.maxTargetFps = 30;
            current_.allowMotionEstimation = false;
            current_.forceDynamicResolution = true;
            current_.actions.push_back("AI processing suspended (analytical path only)");
            current_.actions.push_back("Render scale ceiling: 50%");
            current_.actions.push_back("Output ceiling: 1080p");
            current_.actions.push_back("Frame rate capped at 30 FPS");
            break;

        case ThermalLevel::Shutdown:
            current_.allowAi = false;
            current_.maxAiQuality = AiQuality::Off;
            current_.maxRenderScalePercent = 50;
            current_.maxTargetFps = 30;
            current_.allowMotionEstimation = false;
            current_.recommendPause = true;
            current_.maxOutputPixels = 1920ull * 1080ull;
            current_.actions.push_back("AI processing suspended");
            current_.actions.push_back("Session pause recommended: device is at shutdown-level thermal state");
            break;
    }
}

ThermalDecision ThermalGovernor::update(const ThermalInput& in) {
    // 1. Where do the raw inputs want us to be?
    ThermalLevel demanded = ThermalGovernor::levelForPlatformStatus(in.platformStatus);
    demanded = std::max(demanded, ThermalGovernor::levelForTemperature(in.socTempC, thresholds_.socC));
    demanded = std::max(demanded, ThermalGovernor::levelForTemperature(in.batteryTempC, thresholds_.batteryC));

    // A sustained frame-time breach is a symptom, not proof, of throttling: it
    // can only push us to LIGHT (drop to the cheaper AI tier) by itself.
    bool frameTimeBreach = false;
    if (in.targetFrameTimeMs > 0.0f && in.averageFrameTimeMs > 0.0f) {
        frameTimeBreach = in.averageFrameTimeMs > in.targetFrameTimeMs * thresholds_.frameTimeBreachFactor;
    }
    if (frameTimeBreach && demanded < ThermalLevel::Light) {
        demanded = ThermalLevel::Light;
    }

    // 2. Safety override: even with the guard disabled, AI stops at
    //    EMERGENCY/SHUTDOWN. A user preference must not cook the SoC.
    const ThermalLevel safetyFloor =
        demanded >= ThermalLevel::Emergency ? demanded : ThermalLevel::Nominal;
    if (!in.thermalGuardEnabled) {
        if (safetyFloor != ThermalLevel::Nominal) {
            if (level_ != safetyFloor) {
                applyLevel(safetyFloor,
                           "Safety override: thermal protection was disabled by the user, "
                           "but AI processing is suspended at " +
                               std::string(levelName(safetyFloor)) + " thermal level.");
                lastChangeMs_ = in.nowMs;
                lastEscalationMs_ = in.nowMs;
            }
            return current_;
        }
        if (level_ != ThermalLevel::Nominal) {
            applyLevel(ThermalLevel::Nominal, "Thermal protection disabled by the user.");
            lastChangeMs_ = in.nowMs;
        }
        return current_;
    }

    // 3. Escalation is immediate.
    if (demanded > level_) {
        const std::string reason = [&]() {
            std::string r = std::string("Thermal level raised to ") + levelName(demanded);
            if (in.platformStatus > 0) {
                r += " (platform thermal status " + std::to_string(in.platformStatus) + ")";
            }
            if (in.socTempC > 0.0f) {
                char buf[64];
                std::snprintf(buf, sizeof(buf), " (SoC %.1f C)", static_cast<double>(in.socTempC));
                r += buf;
            }
            if (in.batteryTempC > 0.0f) {
                char buf[64];
                std::snprintf(buf, sizeof(buf), " (battery %.1f C)", static_cast<double>(in.batteryTempC));
                r += buf;
            }
            if (frameTimeBreach) r += " (sustained frame-time breach)";
            return r;
        }();
        applyLevel(demanded, reason);
        lastChangeMs_ = in.nowMs;
        lastEscalationMs_ = in.nowMs;
        steadyAbove_ = demanded;
        aboveSinceMs_ = -1;
        V4K_LOGW("thermal governor: %s", reason.c_str());
        for (const auto& a : current_.actions) V4K_LOGW("  applied: %s", a.c_str());
        return current_;
    }

    // 4. De-escalation: one step at a time, after cooldown, with hysteresis.
    if (demanded < level_) {
        if (aboveSinceMs_ < 0) aboveSinceMs_ = in.nowMs;
        const bool cooledDown =
            (lastEscalationMs_ < 0) || (in.nowMs - lastEscalationMs_ >= thresholds_.cooldownMs);
        if (cooledDown) {
            // Step down only if the *next lower* level's thresholds are cleared
            // with margin, i.e. we are not just oscillating around a boundary.
            const ThermalLevel target = static_cast<ThermalLevel>(static_cast<int>(level_) - 1);
            bool clear = demanded <= target;
            // To drop *to* level T we must be comfortably below the threshold at
            // which level T+1 starts, otherwise we would oscillate across the
            // boundary. thresholdsC[i] separates level i from level i+1.
            const int idx = static_cast<int>(target);
            if (clear && idx < 6) {
                if (in.socTempC > 0.0f) {
                    clear = in.socTempC < thresholds_.socC[idx] - thresholds_.hysteresisC;
                }
                if (clear && in.batteryTempC > 0.0f) {
                    clear = in.batteryTempC < thresholds_.batteryC[idx] - thresholds_.hysteresisC;
                }
            }
            if (clear) {
                applyLevel(target, std::string("Thermal level lowered to ") + levelName(target) +
                                       " after cooldown (hysteresis cleared).");
                lastChangeMs_ = in.nowMs;
                lastEscalationMs_ = in.nowMs;  // restart cooldown for the next step
                current_.reason = current_.reason;
                return current_;
            }
        }
        return current_;
    }

    // 5. Level unchanged.
    if (level_ == ThermalLevel::Nominal) {
        // Refresh the decision so "actions" is empty and the reason is stable.
        if (current_.actions.empty() && current_.reason.empty()) {
            current_ = ThermalDecision{};
            current_.level = ThermalLevel::Nominal;
            current_.reason = "Nominal: no thermal limiting active.";
        }
    }
    return current_;
}

std::string ThermalDecision::toJson() const {
    JsonWriter w;
    w.beginObject();
    w.field("level", toString(level));
    w.field("maxAiQuality", toString(maxAiQuality));
    w.field("maxRenderScalePercent", maxRenderScalePercent);
    w.field("maxOutputPixels", maxOutputPixels);
    w.field("maxTargetFps", maxTargetFps);
    w.field("allowAi", allowAi);
    w.field("allowMotionEstimation", allowMotionEstimation);
    w.field("forceDynamicResolution", forceDynamicResolution);
    w.field("recommendPause", recommendPause);
    w.field("reason", reason);
    w.key("actions");
    w.beginArray();
    for (const auto& a : actions) w.value(a);
    w.endArray();
    w.endObject();
    return w.str();
}

// ---------------------------------------------------------------------------
// Runtime settings
// ---------------------------------------------------------------------------
RuntimeSettings resolveRuntimeSettings(const GraphicsProfile& profile, const ThermalDecision& decision,
                                       bool aiModelAvailable) {
    RuntimeSettings s;
    GraphicsProfile effective = profile;

    // Thermal ceilings first.
    effective.renderScalePercent = std::min(effective.renderScalePercent, decision.maxRenderScalePercent);
    if (decision.maxAiQuality < effective.aiQuality) effective.aiQuality = decision.maxAiQuality;
    if (decision.forceDynamicResolution) effective.dynamicResolution = true;
    if (!decision.allowMotionEstimation) effective.motionAware = false;
    if (decision.maxOutputPixels > 0 && effective.output.pixels() > decision.maxOutputPixels) {
        // Step down the output ladder ("4K -> 1440p -> 1080p").
        Resolution best = outputResolutionLadder().front();
        for (const Resolution& candidate : outputResolutionLadder()) {
            if (candidate.pixels() <= decision.maxOutputPixels) best = candidate;
        }
        effective.output = best;
    }
    if (decision.maxTargetFps > 0) {
        if (effective.targetFps == 0) {
            effective.targetFps = decision.maxTargetFps;
        } else {
            effective.targetFps = std::min(effective.targetFps, decision.maxTargetFps);
        }
    }

    s.clampedFromProfile = (effective.renderScalePercent != profile.renderScalePercent) ||
                           (effective.aiQuality != profile.aiQuality) ||
                           (effective.targetFps != profile.targetFps) ||
                           (effective.motionAware != profile.motionAware) ||
                           !(effective.output == profile.output);
    s.governorNote = decision.reason;
    s.thermalLevel = decision.level;

    s.input = effective.inputResolution();
    s.output = effective.output;
    s.aiQuality = effective.aiQuality;
    s.sharpening = effective.sharpening;
    s.noiseReduction = effective.noiseReduction;
    s.antiAliasing = effective.antiAliasing;
    s.motionAware = effective.motionAware;
    s.dynamicResolution = effective.dynamicResolution;
    s.targetFps = effective.targetFps;

    // Which mode can actually run? Note that "the profile wanted AI" is judged
    // from the profile itself, not from the value the governor already clamped,
    // so the explanation stays accurate when AI was suspended for heat reasons.
    const bool profileWantsAi = effective.aiUpscaling && profile.aiQuality != AiQuality::Off;
    const bool aiRunnable = effective.aiUpscaling && effective.aiQuality != AiQuality::Off &&
                            decision.allowAi;

    if (!effective.aiUpscaling) {
        s.mode = UpscaleMode::Disabled;
    } else if (aiRunnable && aiModelAvailable) {
        s.mode = UpscaleMode::Neural;
    } else {
        s.mode = UpscaleMode::Analytical;
    }

    if (profileWantsAi && !aiModelAvailable) {
        s.governorNote += " | no AI model installed: using the analytical reconstruction path";
    }
    if (profileWantsAi && !decision.allowAi) {
        s.governorNote += " | AI suspended by the thermal governor";
    }
    return s;
}

std::string RuntimeSettings::toJson() const {
    JsonWriter w;
    w.beginObject();
    w.field("inputWidth", input.width);
    w.field("inputHeight", input.height);
    w.field("outputWidth", output.width);
    w.field("outputHeight", output.height);
    w.field("outputLabel", output.label());
    w.field("aiQuality", toString(aiQuality));
    w.field("mode", toString(mode));
    w.field("sharpening", sharpening);
    w.field("noiseReduction", noiseReduction);
    w.field("antiAliasing", antiAliasing);
    w.field("motionAware", motionAware);
    w.field("dynamicResolution", dynamicResolution);
    w.field("targetFps", targetFps);
    w.field("thermalLevel", toString(thermalLevel));
    w.field("clampedFromProfile", clampedFromProfile);
    w.field("governorNote", governorNote);
    w.endObject();
    return w.str();
}

}  // namespace v4k
