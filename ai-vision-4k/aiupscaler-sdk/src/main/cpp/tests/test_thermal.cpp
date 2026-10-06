#include "core/v4k_json.h"
#include "core/v4k_thermal.h"
#include "v4k_test.h"

using namespace v4k;

namespace {

ThermalInput nominalInput(int64_t nowMs) {
    ThermalInput in;
    in.platformStatus = 0;
    in.nowMs = nowMs;
    in.thermalGuardEnabled = true;
    return in;
}

}  // namespace

V4K_TEST(thermal_temperature_levels) {
    ThermalThresholds t;
    CHECK(ThermalGovernor::levelForTemperature(0.0f, t.socC) == ThermalLevel::Nominal);
    CHECK(ThermalGovernor::levelForTemperature(40.0f, t.socC) == ThermalLevel::Nominal);
    CHECK(ThermalGovernor::levelForTemperature(69.0f, t.socC) == ThermalLevel::Light);
    CHECK(ThermalGovernor::levelForTemperature(74.5f, t.socC) == ThermalLevel::Moderate);
    CHECK(ThermalGovernor::levelForTemperature(79.0f, t.socC) == ThermalLevel::Severe);
    CHECK(ThermalGovernor::levelForTemperature(84.0f, t.socC) == ThermalLevel::Critical);
    CHECK(ThermalGovernor::levelForTemperature(89.0f, t.socC) == ThermalLevel::Emergency);
    CHECK(ThermalGovernor::levelForTemperature(95.0f, t.socC) == ThermalLevel::Shutdown);
}

V4K_TEST(thermal_platform_status_mapping) {
    CHECK(ThermalGovernor::levelForPlatformStatus(0) == ThermalLevel::Nominal);
    CHECK(ThermalGovernor::levelForPlatformStatus(1) == ThermalLevel::Light);
    CHECK(ThermalGovernor::levelForPlatformStatus(2) == ThermalLevel::Moderate);
    CHECK(ThermalGovernor::levelForPlatformStatus(3) == ThermalLevel::Severe);
    CHECK(ThermalGovernor::levelForPlatformStatus(4) == ThermalLevel::Critical);
    CHECK(ThermalGovernor::levelForPlatformStatus(5) == ThermalLevel::Emergency);
    CHECK(ThermalGovernor::levelForPlatformStatus(6) == ThermalLevel::Shutdown);
    // Unknown values must not escalate.
    CHECK(ThermalGovernor::levelForPlatformStatus(99) == ThermalLevel::Nominal);
}

V4K_TEST(thermal_escalation_is_immediate) {
    ThermalGovernor governor;
    CHECK(governor.level() == ThermalLevel::Nominal);

    ThermalInput in = nominalInput(1000);
    in.socTempC = 74.0f;
    ThermalDecision d = governor.update(in);
    CHECK(d.level == ThermalLevel::Moderate);
    CHECK(d.maxAiQuality == AiQuality::Medium);
    CHECK_EQ_INT(d.maxRenderScalePercent, 75);
    CHECK(!d.actions.empty());

    // Higher severity escalates in one step (no gradual walk up).
    in.socTempC = 79.0f;
    in.nowMs = 1100;
    d = governor.update(in);
    CHECK(d.level == ThermalLevel::Severe);
    CHECK_EQ_INT(d.maxOutputPixels, 2560ull * 1440ull);
}

V4K_TEST(thermal_deescalation_needs_cooldown_and_hysteresis) {
    ThermalGovernor governor;
    ThermalInput in = nominalInput(0);
    in.socTempC = 90.0f;   // Emergency
    ThermalDecision d = governor.update(in);
    CHECK(d.level == ThermalLevel::Emergency);
    CHECK(!d.allowAi);

    // Cool down hard, but too early: nothing changes.
    in.socTempC = 30.0f;
    in.nowMs = 5000;
    d = governor.update(in);
    CHECK(d.level == ThermalLevel::Emergency);

    // After the cooldown, one step down only.
    in.nowMs = 25000;
    d = governor.update(in);
    CHECK(d.level == ThermalLevel::Critical);

    // Next step needs another cooldown.
    in.nowMs = 30000;
    d = governor.update(in);
    CHECK(d.level == ThermalLevel::Critical);
    in.nowMs = 46000;
    d = governor.update(in);
    CHECK(d.level == ThermalLevel::Severe);
}

V4K_TEST(thermal_hysteresis_blocks_oscillation) {
    ThermalGovernor governor;
    ThermalInput in = nominalInput(0);
    in.socTempC = 69.0f;   // Light
    CHECK(governor.update(in).level == ThermalLevel::Light);

    // Temperature just below the LIGHT threshold (68) but within the 4 C
    // hysteresis band: the governor must NOT step back down yet.
    in.socTempC = 66.0f;
    in.nowMs = 30000;
    CHECK(governor.update(in).level == ThermalLevel::Light);

    // Clear of the band: allowed to drop.
    in.socTempC = 60.0f;
    in.nowMs = 60000;
    CHECK(governor.update(in).level == ThermalLevel::Nominal);
}

V4K_TEST(thermal_frame_time_breach_only_reaches_light) {
    ThermalGovernor governor;
    ThermalInput in = nominalInput(0);
    in.targetFrameTimeMs = 16.7f;
    in.averageFrameTimeMs = 40.0f;   // far beyond the 1.6x breach factor
    const ThermalDecision d = governor.update(in);
    CHECK(d.level == ThermalLevel::Light);
    CHECK(d.maxAiQuality == AiQuality::High);
}

V4K_TEST(thermal_safety_override_cannot_be_disabled) {
    ThermalGovernor governor;
    ThermalInput in = nominalInput(0);
    in.thermalGuardEnabled = false;
    in.platformStatus = 5;   // EMERGENCY

    const ThermalDecision d = governor.update(in);
    CHECK(d.level == ThermalLevel::Emergency);
    CHECK(!d.allowAi);
    CHECK(d.reason.find("Safety override") != std::string::npos);

    // With the guard disabled and cool hardware, nothing is applied.
    ThermalInput cool = nominalInput(1000);
    cool.thermalGuardEnabled = false;
    const ThermalDecision d2 = governor.update(cool);
    CHECK(d2.level == ThermalLevel::Nominal);
    CHECK(d2.actions.empty());
}

V4K_TEST(thermal_runtime_settings_follow_the_spec_ladder) {
    // "AI Quality: Ultra -> High -> Medium" and "Resolution: 4K -> 1440p".
    GraphicsProfile profile = makePresetProfile(QualityPreset::Extreme, {3840, 2160});
    profile.aiUpscaling = true;
    profile.aiQuality = AiQuality::Ultra;

    ThermalGovernor governor;
    ThermalInput in;
    in.nowMs = 0;
    in.thermalGuardEnabled = true;

    // Nominal: the profile is used as-is.
    ThermalDecision nominal = governor.update(in);
    RuntimeSettings s = resolveRuntimeSettings(profile, nominal, /*aiModelAvailable=*/true);
    CHECK(s.mode == UpscaleMode::Neural);
    CHECK(s.aiQuality == AiQuality::Ultra);
    CHECK_EQ_INT(s.output.width, 3840u);
    CHECK(!s.clampedFromProfile);

    // Light: Ultra -> High.
    in.socTempC = 69.0f;
    in.nowMs = 1000;
    ThermalDecision light = governor.update(in);
    s = resolveRuntimeSettings(profile, light, true);
    CHECK(s.aiQuality == AiQuality::High);
    CHECK(s.clampedFromProfile);

    // Severe: High -> Medium and 4K -> 1440p.
    in.socTempC = 79.0f;
    in.nowMs = 2000;
    ThermalDecision severe = governor.update(in);
    s = resolveRuntimeSettings(profile, severe, true);
    CHECK(s.aiQuality == AiQuality::Medium);
    CHECK_EQ_INT(s.output.width, 2560u);
    CHECK_EQ_INT(s.output.height, 1440u);
    CHECK_EQ_INT(s.input.width, 1280u);   // EXTREME renders at 50%: 2560 * 0.5
    CHECK(s.mode == UpscaleMode::Neural);

    // Emergency: AI suspended, analytical path only, 1080p ceiling, 30 FPS.
    in.socTempC = 90.0f;
    in.nowMs = 3000;
    ThermalDecision emergency = governor.update(in);
    s = resolveRuntimeSettings(profile, emergency, true);
    CHECK(s.mode == UpscaleMode::Analytical);
    CHECK(s.aiQuality == AiQuality::Off);
    CHECK_EQ_INT(s.output.width, 1920u);
    CHECK_EQ_INT(s.targetFps, 30);
    CHECK(s.governorNote.find("governor") != std::string::npos ||
          s.governorNote.find("suspended") != std::string::npos);
}

V4K_TEST(thermal_runtime_settings_without_model_never_claims_neural) {
    GraphicsProfile profile = makePresetProfile(QualityPreset::Balanced, {1920, 1080});
    ThermalDecision nominal;
    nominal.level = ThermalLevel::Nominal;

    const RuntimeSettings withModel = resolveRuntimeSettings(profile, nominal, true);
    CHECK(withModel.mode == UpscaleMode::Neural);

    const RuntimeSettings withoutModel = resolveRuntimeSettings(profile, nominal, false);
    CHECK(withoutModel.mode == UpscaleMode::Analytical);
    CHECK(withoutModel.governorNote.find("no AI model installed") != std::string::npos);
}

V4K_TEST(thermal_shutdown_recommends_pause) {
    ThermalGovernor governor;
    ThermalInput in;
    in.nowMs = 0;
    in.socTempC = 96.0f;
    const ThermalDecision d = governor.update(in);
    CHECK(d.level == ThermalLevel::Shutdown);
    CHECK(d.recommendPause);
    CHECK(!d.allowAi);
}

V4K_TEST(thermal_battery_thresholds) {
    ThermalGovernor governor;
    ThermalInput in;
    in.nowMs = 0;
    in.batteryTempC = 44.0f;   // Severe per the battery ladder
    const ThermalDecision d = governor.update(in);
    CHECK(d.level == ThermalLevel::Severe);
    CHECK(d.reason.find("battery") != std::string::npos);
}

V4K_TEST(thermal_json_is_parseable) {
    ThermalGovernor governor;
    ThermalInput in;
    in.nowMs = 0;
    in.socTempC = 79.0f;
    const ThermalDecision d = governor.update(in);
    std::string error;
    auto parsed = JsonValue::parse(d.toJson(), &error);
    CHECK(parsed != nullptr);
    if (parsed != nullptr) {
        CHECK_EQ_STR((*parsed)["level"].asString(), "SEVERE");
        CHECK((*parsed)["actions"].size() >= 3);
    }
}
