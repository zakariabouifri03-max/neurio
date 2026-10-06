#include "v4k_common.h"

#include <algorithm>
#include <cctype>

#include "v4k_device.h"

namespace v4k {
namespace {

std::string upper(const std::string& s) {
    std::string out = s;
    std::transform(out.begin(), out.end(), out.begin(),
                   [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
    return out;
}

std::string compact(const std::string& s) {
    std::string out = upper(s);
    out.erase(std::remove_if(out.begin(), out.end(),
                             [](unsigned char c) { return c == '_' || c == '-' || c == ' '; }),
              out.end());
    return out;
}

}  // namespace

QualityPreset qualityPresetFromString(const std::string& s, QualityPreset fallback) {
    const std::string v = compact(s);
    if (v == "QUALITY") return QualityPreset::Quality;
    if (v == "BALANCED") return QualityPreset::Balanced;
    if (v == "PERFORMANCE") return QualityPreset::Performance;
    if (v == "EXTREME") return QualityPreset::Extreme;
    return fallback;
}

AiQuality aiQualityFromString(const std::string& s, AiQuality fallback) {
    const std::string v = compact(s);
    if (v == "OFF" || v == "NONE" || v == "DISABLED") return AiQuality::Off;
    if (v == "LOW") return AiQuality::Low;
    if (v == "MEDIUM" || v == "MED") return AiQuality::Medium;
    if (v == "HIGH") return AiQuality::High;
    if (v == "ULTRA") return AiQuality::Ultra;
    return fallback;
}

IntegrationKind integrationFromString(const std::string& s, IntegrationKind fallback) {
    const std::string v = compact(s);
    if (v == "NONE" || v == "APPLEVEL" || v == "THIRDPARTY") return IntegrationKind::None;
    if (v == "SDKINTEGRATED" || v == "SDK") return IntegrationKind::SdkIntegrated;
    if (v == "SAMPLEDEMO" || v == "SAMPLE") return IntegrationKind::SampleDemo;
    if (v == "SCREENENHANCE" || v == "SCREEN") return IntegrationKind::ScreenEnhance;
    return fallback;
}

UpscaleMode upscaleModeFromString(const std::string& s, UpscaleMode fallback) {
    const std::string v = compact(s);
    if (v == "DISABLED" || v == "OFF" || v == "NATIVE") return UpscaleMode::Disabled;
    if (v == "ANALYTICAL") return UpscaleMode::Analytical;
    if (v == "NEURAL" || v == "AI") return UpscaleMode::Neural;
    return fallback;
}

ThermalLevel thermalLevelFromString(const std::string& s, ThermalLevel fallback) {
    const std::string v = compact(s);
    if (v == "NOMINAL" || v == "NONE") return ThermalLevel::Nominal;
    if (v == "LIGHT" || v == "THROTTLING") return ThermalLevel::Light;
    if (v == "MODERATE") return ThermalLevel::Moderate;
    if (v == "SEVERE") return ThermalLevel::Severe;
    if (v == "CRITICAL") return ThermalLevel::Critical;
    if (v == "EMERGENCY") return ThermalLevel::Emergency;
    if (v == "SHUTDOWN") return ThermalLevel::Shutdown;
    return fallback;
}

InferenceBackend backendFromString(const std::string& s, InferenceBackend fallback) {
    const std::string v = compact(s);
    if (v == "NONE") return InferenceBackend::None;
    if (v == "GPUVULKAN" || v == "GPU" || v == "VULKAN") return InferenceBackend::GpuVulkan;
    if (v == "NNAPI") return InferenceBackend::Nnapi;
    if (v == "CPU") return InferenceBackend::Cpu;
    return fallback;
}

std::string describeDevice(const DeviceCapabilities& caps) {
    std::string out;
    if (!caps.android.socManufacturer.empty() || !caps.android.socModel.empty()) {
        out += caps.android.socManufacturer;
        if (!caps.android.socManufacturer.empty() && !caps.android.socModel.empty()) out += " ";
        out += caps.android.socModel;
    }
    if (!caps.vulkan.deviceName.empty()) {
        if (!out.empty()) out += " · ";
        out += caps.vulkan.deviceName;
    }
    if (caps.vulkan.available) {
        if (!out.empty()) out += " · ";
        out += "Vulkan ";
        out += std::to_string(caps.vulkan.apiVersionMajor());
        out += ".";
        out += std::to_string(caps.vulkan.apiVersionMinor());
    } else {
        if (!out.empty()) out += " · ";
        out += "no Vulkan";
    }
    if (caps.memory.totalRamBytes > 0) {
        out += " · ";
        char buf[64];
        std::snprintf(buf, sizeof(buf), "%.1f GB RAM",
                      static_cast<double>(caps.memory.totalRamBytes) / (1024.0 * 1024.0 * 1024.0));
        out += buf;
    }
    if (caps.android.sdkInt > 0) {
        out += " · API ";
        out += std::to_string(caps.android.sdkInt);
    }
    return out;
}

uint64_t defaultWorkingSetBudget(uint64_t deviceLocalMemoryBytes, uint64_t deviceMemoryBudgetBytes) {
    constexpr uint64_t kMiB = 1024ull * 1024ull;
    constexpr uint64_t kFloor = 64ull * kMiB;
    constexpr uint64_t kCeiling = 384ull * kMiB;
    constexpr uint64_t kUnknown = 128ull * kMiB;

    const uint64_t reference = deviceMemoryBudgetBytes > 0 ? deviceMemoryBudgetBytes : deviceLocalMemoryBytes;
    if (reference == 0) return kUnknown;

    uint64_t budget = reference / 4;
    if (budget < kFloor) budget = kFloor;
    if (budget > kCeiling) budget = kCeiling;
    return budget;
}

}  // namespace v4k
