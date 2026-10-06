#include "core/v4k_common.h"
#include "core/v4k_device.h"
#include "core/v4k_json.h"
#include "core/v4k_profile.h"
#include "v4k_test.h"

using namespace v4k;

namespace {

DeviceCapabilities flagshipDevice() {
    DeviceCapabilities caps;
    caps.vulkan.available = true;
    caps.vulkan.apiVersion = 0x401000;  // 1.1
    caps.vulkan.deviceName = "Adreno (TM) 740";
    caps.vulkan.vendor = GpuVendor::Qualcomm;
    caps.vulkan.vendorId = 0x5143;
    caps.vulkan.hasComputeQueue = true;
    caps.vulkan.hasStorageImageRgba8 = true;
    caps.vulkan.hasStorageImageR8 = true;
    caps.vulkan.maxComputeWorkGroupInvocations = 1024;
    caps.vulkan.maxComputeSharedMemorySize = 32768;
    caps.vulkan.maxImageDimension2D = 16384;
    caps.vulkan.maxPushConstantsSize = 128;
    caps.vulkan.deviceLocalMemoryBytes = 4ull * 1024 * 1024 * 1024;
    caps.vulkan.hasFloat16Storage = true;
    caps.vulkan.hasInt8Storage = true;
    caps.android.sdkInt = 34;
    caps.android.socModel = "SM8650";
    caps.android.supportsArm64 = true;
    caps.android.cpuArch = 2;
    caps.android.displayRefreshRate = 120.0f;
    caps.memory.totalRamBytes = 12ull * 1024 * 1024 * 1024;
    return caps;
}

}  // namespace

V4K_TEST(profile_ladders) {
    CHECK_EQ_INT(outputResolutionLadder().size(), 5u);
    CHECK_EQ_INT(outputResolutionLadder()[0].width, 1280u);
    CHECK_EQ_INT(outputResolutionLadder()[4].width, 3840u);
    CHECK_EQ_INT(renderScaleLadder().size(), 6u);
    CHECK(isAllowedRenderScale(67));
    CHECK(!isAllowedRenderScale(68));
    CHECK_EQ_INT(nearestAllowedRenderScale(64), 67);   // 67 is nearer than 60
    CHECK_EQ_INT(nearestAllowedRenderScale(90), 83);   // 83 is nearer than 100
    CHECK_EQ_INT(nearestAllowedRenderScale(10), 50);
}

V4K_TEST(profile_labels) {
    const auto label = [](uint32_t w, uint32_t h) {
        Resolution r;
        r.width = w;
        r.height = h;
        return r.label();
    };
    CHECK_EQ_STR(label(1280, 720), "720p");
    CHECK_EQ_STR(label(1600, 900), "900p");
    CHECK_EQ_STR(label(1920, 1080), "1080p");
    CHECK_EQ_STR(label(2560, 1440), "1440p");
    CHECK_EQ_STR(label(3840, 2160), "4K");
    CHECK_EQ_STR(label(1024, 768), "1024x768");
}

V4K_TEST(profile_input_resolution_even_and_scaled) {
    GraphicsProfile p;
    p.output = {1920, 1080};
    p.renderScalePercent = 50;
    const Resolution half = p.inputResolution();
    CHECK_EQ_INT(half.width, 960u);
    CHECK_EQ_INT(half.height, 540u);

    p.renderScalePercent = 67;
    const Resolution twoThirds = p.inputResolution();
    CHECK_EQ_INT(twoThirds.width, 1286u);   // 1920*0.67 = 1286.4 -> 1286 (even)
    CHECK_EQ_INT(twoThirds.height, 724u);   // 1080*0.67 = 723.6 -> 724 (even)

    // Always even: pixel shuffle stages need it.
    CHECK_EQ_INT(twoThirds.width % 2, 0u);
    CHECK_EQ_INT(twoThirds.height % 2, 0u);
}

V4K_TEST(profile_presets_match_spec) {
    const GraphicsProfile quality = makePresetProfile(QualityPreset::Quality, {2560, 1440});
    CHECK_EQ_INT(quality.renderScalePercent, 75);
    CHECK(quality.aiQuality == AiQuality::High);
    CHECK(quality.aiUpscaling);
    CHECK_NEAR(quality.sharpening, 0.15, 1e-6);

    const GraphicsProfile balanced = makePresetProfile(QualityPreset::Balanced, {1920, 1080});
    CHECK_EQ_INT(balanced.renderScalePercent, 67);
    CHECK(balanced.aiQuality == AiQuality::Medium);
    CHECK_NEAR(balanced.sharpening, 0.20, 1e-6);
    CHECK_EQ_INT(balanced.targetFps, 60);

    const GraphicsProfile performance = makePresetProfile(QualityPreset::Performance, {1920, 1080});
    CHECK_EQ_INT(performance.renderScalePercent, 50);
    CHECK(performance.performanceMode);
    CHECK_EQ_INT(performance.targetFps, 60);

    const GraphicsProfile extreme = makePresetProfile(QualityPreset::Extreme, {3840, 2160});
    CHECK_EQ_INT(extreme.renderScalePercent, 50);
    CHECK(extreme.aiQuality == AiQuality::Ultra);
    CHECK_EQ_INT(extreme.targetFps, 30);
    // Example straight from the spec: 1080p internal -> 4K output, but EXTREME
    // renders at 50% (1920x1080) and reconstructs to 4K.
    const Resolution in = extreme.inputResolution();
    CHECK_EQ_INT(in.width, 1920u);
    CHECK_EQ_INT(in.height, 1080u);
    CHECK_EQ_STR(extreme.output.label(), "4K");
}

V4K_TEST(profile_validation_clamps_hostile_values) {
    DeviceCapabilities caps = flagshipDevice();
    GraphicsProfile p;
    p.renderScalePercent = 83;
    p.output = {1920, 1080};
    p.sharpening = 4.0f;      // way out of range
    p.noiseReduction = -1.0f;
    p.targetFps = 57;         // not on the ladder
    p.aiUpscaling = true;
    p.aiQuality = AiQuality::Ultra;
    p.integration = IntegrationKind::SdkIntegrated;

    const ValidationResult r = validateProfile(p, &caps);
    CHECK(r.ok);
    CHECK_NEAR(p.sharpening, 1.0, 1e-6);
    CHECK_NEAR(p.noiseReduction, 0.0, 1e-6);
    CHECK_EQ_INT(p.targetFps, 60);
}

V4K_TEST(profile_validation_battery_mode_caps_quality) {
    DeviceCapabilities caps = flagshipDevice();
    GraphicsProfile p = makePresetProfile(QualityPreset::Quality, {2560, 1440});
    p.batteryMode = true;
    p.aiQuality = AiQuality::Ultra;
    p.targetFps = 120;
    const ValidationResult r = validateProfile(p, &caps);
    CHECK(p.aiQuality == AiQuality::Medium);
    CHECK_EQ_INT(p.targetFps, 60);
    bool mentionsBattery = false;
    for (const auto& m : r.messages) {
        if (m.field == "aiQuality" && m.message.find("Battery mode") != std::string::npos) {
            mentionsBattery = true;
        }
    }
    CHECK(mentionsBattery);
}

V4K_TEST(profile_validation_rejects_impossible_output) {
    DeviceCapabilities caps = flagshipDevice();
    caps.vulkan.maxImageDimension2D = 4096;   // 4K still possible
    GraphicsProfile p;
    p.output = {7680, 4320};                  // 8K: beyond the ladder
    p.renderScalePercent = 50;
    const ValidationResult r = validateProfile(p, &caps);
    CHECK_EQ_INT(p.output.width, 3840u);
    CHECK_EQ_INT(p.output.height, 2160u);
    CHECK(!r.messages.empty());

    // Absolute aspect ratio rejection (a 40:1 "resolution" is not a thing).
    GraphicsProfile wide;
    wide.output = {4096, 100};
    wide.renderScalePercent = 50;
    const ValidationResult wideResult = validateProfile(wide, &caps);
    CHECK_EQ_INT(wide.output.width, 1280u);
    bool aspectMentioned = false;
    for (const auto& m : wideResult.messages) {
        if (m.message.find("Aspect ratio") != std::string::npos) aspectMentioned = true;
    }
    CHECK(aspectMentioned);
}

V4K_TEST(profile_validation_explains_missing_integration) {
    DeviceCapabilities caps = flagshipDevice();
    GraphicsProfile p = makePresetProfile(QualityPreset::Balanced, {1920, 1080});
    p.integration = IntegrationKind::None;
    const ValidationResult r = validateProfile(p, &caps);
    bool found = false;
    for (const auto& m : r.messages) {
        if (m.field == "integration") {
            found = true;
            CHECK(m.message.find("cannot") != std::string::npos ||
                  m.message.find("does not allow") != std::string::npos);
        }
    }
    CHECK(found);
}

V4K_TEST(profile_validation_warns_without_gpu) {
    DeviceCapabilities caps;   // nothing available at all
    caps.android.sdkInt = 30;
    caps.android.supportsArm64 = true;
    GraphicsProfile p = makePresetProfile(QualityPreset::Balanced, {1920, 1080});
    const ValidationResult r = validateProfile(p, &caps);
    bool warned = false;
    for (const auto& m : r.messages) {
        if (m.field == "aiQuality") {
            warned = true;
        }
    }
    CHECK(warned);
}

V4K_TEST(profile_json_roundtrip) {
    GraphicsProfile p = makePresetProfile(QualityPreset::Quality, {2560, 1440});
    p.id = "profile-1";
    p.name = "PUBG Mobile · Quality";
    p.packageName = "com.tencent.ig";
    p.gameTitle = "PUBG Mobile";
    p.sharpening = 0.33f;
    p.integration = IntegrationKind::SdkIntegrated;
    p.targetFps = 90;

    const std::string json = profileToJson(p);
    GraphicsProfile back;
    std::string error;
    CHECK(profileFromJson(json, back, &error));
    if (!error.empty()) V4K_FAIL("unexpected parse error: " + error);
    CHECK_EQ_STR(back.id, p.id);
    CHECK_EQ_STR(back.name, p.name);
    CHECK_EQ_STR(back.packageName, p.packageName);
    CHECK(back.preset == p.preset);
    CHECK_EQ_INT(back.renderScalePercent, p.renderScalePercent);
    CHECK_EQ_INT(back.output.width, p.output.width);
    CHECK(back.aiQuality == p.aiQuality);
    CHECK_NEAR(back.sharpening, p.sharpening, 1e-6);
    CHECK_EQ_INT(back.targetFps, 90);
    CHECK(back.integration == IntegrationKind::SdkIntegrated);
    CHECK_EQ_INT(back.inputResolution().width, p.inputResolution().width);
}

V4K_TEST(profile_json_rejects_broken_input) {
    GraphicsProfile p;
    std::string error;
    CHECK(!profileFromJson("{not json", p, &error));
    CHECK(!error.empty());
    error.clear();
    CHECK(!profileFromJson("[1,2,3]", p, &error));
}

V4K_TEST(profile_frame_budget) {
    GraphicsProfile p;
    p.targetFps = 60;
    CHECK_NEAR(p.frameBudgetMs(), 16.6667, 0.01);
    p.targetFps = 0;
    CHECK_NEAR(p.frameBudgetMs(), 0.0, 1e-9);
}

V4K_TEST(profile_preferred_model_per_quality) {
    CHECK_EQ_STR(preferredModelId(AiQuality::Low), "mobile_sr_lite");
    CHECK_EQ_STR(preferredModelId(AiQuality::Medium), "mobile_sr_balanced");
    CHECK_EQ_STR(preferredModelId(AiQuality::High), "mobile_sr_quality");
    CHECK_EQ_STR(preferredModelId(AiQuality::Ultra), "mobile_sr_quality");
    CHECK(preferredModelId(AiQuality::Off).empty());
}

V4K_TEST(profile_device_tier_classification) {
    DeviceCapabilities flagship = flagshipDevice();
    CHECK(classifyDeviceTier(flagship) == DeviceTier::Flagship);

    DeviceCapabilities mid = flagshipDevice();
    mid.android.socModel = "SM7325";
    CHECK(classifyDeviceTier(mid) == DeviceTier::Mid);

    DeviceCapabilities entry = flagshipDevice();
    entry.android.socModel = "SM4250";
    CHECK(classifyDeviceTier(entry) == DeviceTier::Entry);

    DeviceCapabilities noVulkan = flagshipDevice();
    noVulkan.vulkan.available = false;
    CHECK(classifyDeviceTier(noVulkan) == DeviceTier::Unsupported);

    DeviceCapabilities software = flagshipDevice();
    software.vulkan.deviceName = "SwiftShader Device (Subzero)";
    CHECK(classifyDeviceTier(software) == DeviceTier::Unsupported);

    // Unknown SoC with strong measurable properties lands in HIGH, not FLAGSHIP.
    DeviceCapabilities unknown = flagshipDevice();
    unknown.android.socModel = "ACME-9000";
    CHECK(classifyDeviceTier(unknown) == DeviceTier::High);

    // Peak constraints cap the tier even for a flagship name.
    DeviceCapabilities capped = flagshipDevice();
    capped.vulkan.maxComputeWorkGroupInvocations = 32;
    CHECK(classifyDeviceTier(capped) == DeviceTier::Entry);
}
