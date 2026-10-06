#include "v4k_test.h"

#include "../core/v4k_compat.h"
#include "../core/v4k_json.h"

#include <memory>
#include "../core/v4k_profile.h"

using namespace v4k;

namespace {

DeviceCapabilities flagship() {
    DeviceCapabilities caps;
    caps.vulkan.available = true;
    caps.vulkan.apiVersion = (1u << 22) | (3u << 12);   // VK 1.3
    caps.vulkan.vendorId = 0x5143;
    caps.vulkan.vendor = GpuVendor::Qualcomm;
    caps.vulkan.deviceName = "Adreno (TM) 740";
    caps.vulkan.hasComputeQueue = true;
    caps.vulkan.hasStorageImageRgba8 = true;
    caps.vulkan.hasStorageImageR8 = true;
    caps.vulkan.hasFloat16Storage = true;
    caps.vulkan.hasInt8Storage = true;
    caps.vulkan.hasSubgroupOps = true;
    caps.vulkan.hasTimestampCompute = true;
    caps.vulkan.maxComputeWorkGroupInvocations = 1024;
    caps.vulkan.maxComputeWorkGroupSizeX = 1024;
    caps.vulkan.maxComputeSharedMemorySize = 32768;
    caps.vulkan.maxImageDimension2D = 16384;
    caps.vulkan.maxPushConstantsSize = 256;
    caps.vulkan.maxMemoryAllocationCount = 4096;
    caps.vulkan.timestampPeriod = 1.0f;
    caps.vulkan.deviceLocalMemoryBytes = 8ull * 1024 * 1024 * 1024;
    caps.vulkan.totalMemoryBytes = caps.vulkan.deviceLocalMemoryBytes;
    caps.android.sdkInt = 34;
    caps.android.socModel = "SM8650";        // Snapdragon 8 Gen 3 -- flagship tier
    caps.android.socManufacturer = "Qualcomm";
    caps.android.cpuCoreCount = 8;
    caps.android.supportsArm64 = true;
    caps.android.cpuArch = 2;
    caps.android.displayRefreshRate = 120.0f;
    caps.android.displayWidth = 1440;
    caps.android.displayHeight = 3120;
    caps.memory.totalRamBytes = 12ull * 1024 * 1024 * 1024;
    caps.memory.availableRamBytes = 6ull * 1024 * 1024 * 1024;
    caps.memory.memoryClassMb = 512;
    caps.thermal.powerManagerThermalApi = true;
    caps.thermal.batteryTemperature = true;
    caps.neural.nnapiAvailable = true;
    caps.neural.hasAccelerator = true;
    return caps;
}

CompatInput makeInput(IntegrationKind integration, bool modelInstalled) {
    CompatInput input;
    input.caps = flagship();
    input.integration = integration;
    input.aiModelInstalled = modelInstalled;
    input.desired = makePresetProfile(QualityPreset::Balanced, Resolution{1920, 1080});
    input.desired.integration = integration;
    input.screenCapturePossible = false;
    return input;
}

bool hasReason(const CompatResult& result, const char* code) {
    for (const CompatReason& reason : result.reasons) {
        if (reason.code == code) return true;
    }
    return false;
}

}  // namespace

V4K_TEST(compat_sdk_integrated_flagship_is_supported) {
    const CompatResult result = evaluateCompatibility(makeInput(IntegrationKind::SdkIntegrated, true));
    CHECK_EQ_INT(result.status, CompatStatus::Supported);
    CHECK_EQ_INT(result.tier, DeviceTier::Flagship);
    CHECK_EQ_INT(result.achievableMode, UpscaleMode::Neural);
    CHECK_EQ_INT(result.achievableBackend, InferenceBackend::GpuVulkan);
    CHECK_EQ_INT(result.recommendedOutput.width, 3840u);
    CHECK_EQ_INT(result.recommendedOutput.height, 2160u);
    CHECK_EQ_INT(result.recommendedRenderScalePercent, 75);
    CHECK_EQ_INT(result.maximumAiQuality, AiQuality::High);
    CHECK(result.monitoringAvailable);
    CHECK(hasReason(result, reason::kOk));
    CHECK(!result.headline.empty());
}

V4K_TEST(compat_plain_game_without_integration_is_unsupported_and_explains_why) {
    const CompatResult result = evaluateCompatibility(makeInput(IntegrationKind::None, true));
    CHECK_EQ_INT(result.status, CompatStatus::Unsupported);
    CHECK_EQ_INT(result.achievableMode, UpscaleMode::Disabled);
    CHECK(hasReason(result, reason::kNoIntegration));
    // Monitoring stays available: the app still reports real numbers.
    CHECK(result.monitoringAvailable);
    CHECK(result.overlayAvailable);
    CHECK_STR_CONTAINS(result.headline, "Monitoring");

    const std::shared_ptr<JsonValue> parsed = JsonValue::parse(result.toJson(), nullptr);
    CHECK(parsed != nullptr);
    if (parsed != nullptr) {
        CHECK_EQ_STR((*parsed)["status"].asString(), "UNSUPPORTED");
        CHECK_EQ_INT((*parsed)["reasons"].size(), result.reasons.size());
    }
}

V4K_TEST(compat_screen_enhancement_is_experimental_never_supported) {
    CompatInput input = makeInput(IntegrationKind::ScreenEnhance, true);
    input.screenCapturePossible = true;
    CompatResult result = evaluateCompatibility(input);
    CHECK_EQ_INT(result.status, CompatStatus::Experimental);
    CHECK(hasReason(result, reason::kScreenEnhance));

    input.screenCapturePossible = false;
    result = evaluateCompatibility(input);
    CHECK_EQ_INT(result.status, CompatStatus::Unsupported);
    CHECK(hasReason(result, reason::kCaptureUnavailable));
}

V4K_TEST(compat_no_vulkan_is_unsupported) {
    CompatInput input = makeInput(IntegrationKind::SdkIntegrated, true);
    input.caps.vulkan.available = false;
    input.caps.vulkan.apiVersion = 0;
    input.caps.vulkan.hasComputeQueue = false;
    const CompatResult result = evaluateCompatibility(input);
    CHECK_EQ_INT(result.status, CompatStatus::Unsupported);
    CHECK(hasReason(result, reason::kNoVulkan));
    CHECK(!result.headline.empty());
}

V4K_TEST(compat_software_renderer_is_rejected) {
    CompatInput input = makeInput(IntegrationKind::SdkIntegrated, true);
    input.caps.vulkan.deviceName = "SwiftShader Device (Subzero)";
    input.caps.vulkan.vendor = GpuVendor::Google;
    const CompatResult result = evaluateCompatibility(input);
    CHECK_EQ_INT(result.status, CompatStatus::Unsupported);
    CHECK(hasReason(result, reason::kSoftwareRenderer));
}

V4K_TEST(compat_vulkan_1_0_without_fp16_is_partially_supported) {
    CompatInput input = makeInput(IntegrationKind::SdkIntegrated, true);
    input.caps.vulkan.apiVersion = (1u << 22);   // VK 1.0
    input.caps.vulkan.hasFloat16Storage = false;
    input.caps.vulkan.hasInt8Storage = false;
    input.caps.vulkan.hasSubgroupOps = false;
    input.caps.vulkan.hasTimestampCompute = false;
    const CompatResult result = evaluateCompatibility(input);
    CHECK_EQ_INT(result.status, CompatStatus::PartiallySupported);
    CHECK(hasReason(result, reason::kVk10Only));
    CHECK(hasReason(result, reason::kNoFp16));
    CHECK(hasReason(result, reason::kNoInt8));
    CHECK_GT(result.recommendedRenderScalePercent, 0);
}

V4K_TEST(compat_missing_model_degrades_to_analytical) {
    const CompatResult result = evaluateCompatibility(makeInput(IntegrationKind::SampleDemo, false));
    CHECK_EQ_INT(result.achievableMode, UpscaleMode::Analytical);
    CHECK_EQ_INT(result.achievableBackend, InferenceBackend::None);
    CHECK(hasReason(result, reason::kNoModel));
}

V4K_TEST(compat_low_memory_device_is_rejected) {
    CompatInput input = makeInput(IntegrationKind::SdkIntegrated, true);
    input.caps.vulkan.deviceLocalMemoryBytes = 180ull * 1024 * 1024;
    input.caps.memory.totalRamBytes = 3ull * 1024 * 1024 * 1024;
    const CompatResult result = evaluateCompatibility(input);
    CHECK_EQ_INT(result.status, CompatStatus::Unsupported);
    CHECK(hasReason(result, reason::kLowMemory));
}

V4K_TEST(compat_image_dimension_limit_clamps_the_recommendation) {
    CompatInput input = makeInput(IntegrationKind::SdkIntegrated, true);
    input.caps.vulkan.maxImageDimension2D = 2000;   // 1080p fits, 1440p does not
    const CompatResult result = evaluateCompatibility(input);
    CHECK(hasReason(result, reason::kMaxImageDimension));
    CHECK(result.recommendedOutput.width <= 2000u);
    CHECK(result.recommendedOutput.height <= 2000u);
    // 1080p is the largest rung that fits a 2048 px limit.
    CHECK_EQ_INT(result.recommendedOutput.width, 1920u);
}

V4K_TEST(compat_empty_device_reports_a_blocker) {
    CompatInput input;
    input.integration = IntegrationKind::SdkIntegrated;
    input.aiModelInstalled = true;
    const CompatResult result = evaluateCompatibility(input);
    CHECK_EQ_INT(result.status, CompatStatus::Unsupported);
    CHECK(!result.headline.empty());
    CHECK(!result.reasons.empty());
}

V4K_TEST(compat_tier_recommendations_follow_the_ladder) {
    CHECK_EQ_INT(recommendedRenderScale(DeviceTier::Flagship), 75);
    CHECK_EQ_INT(recommendedRenderScale(DeviceTier::High), 67);
    CHECK_EQ_INT(recommendedRenderScale(DeviceTier::Mid), 60);
    CHECK_EQ_INT(recommendedRenderScale(DeviceTier::Entry), 50);
    CHECK_EQ_INT(recommendedAiQuality(DeviceTier::Flagship), AiQuality::High);
    CHECK_EQ_INT(recommendedAiQuality(DeviceTier::Mid), AiQuality::Low);

    const DeviceCapabilities caps = flagship();
    const Resolution flagshipOutput = recommendedOutputResolution(caps, DeviceTier::Flagship);
    CHECK_EQ_INT(flagshipOutput.width, 3840u);

    DeviceCapabilities small = caps;
    small.memory.totalRamBytes = 6ull * 1024 * 1024 * 1024;
    const Resolution demoted = recommendedOutputResolution(small, DeviceTier::Flagship);
    CHECK_MSG(demoted.width <= 2560u, "a 6 GB device must not be told to render 4K");
}
