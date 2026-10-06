// Device capability description.
//
// Pure data: the Vulkan/Android probes fill this in (cpp/vulkan/v4k_device_probe.cpp,
// cpp/jni/*_bridge.cpp) and the compatibility engine (v4k_compat.cpp) consumes it.
// Keeping it free of platform headers is what lets the rule engine be unit tested
// against synthetic devices (see cpp/tests/test_compat.cpp).
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "v4k_common.h"

namespace v4k {

enum class GpuVendor : int32_t {
    Unknown = 0,
    Qualcomm = 1,   // Adreno
    Arm = 2,        // Mali / Immortalis
    Imagination = 3,// PowerVR
    Samsung = 4,    // Xclipse (RDNA)
    Amd = 5,
    Nvidia = 6,
    Intel = 7,
    Google = 8,     // SwiftShader / llvmpipe
    Mesa = 9,
};

inline const char* toString(GpuVendor v) {
    switch (v) {
        case GpuVendor::Qualcomm: return "Qualcomm Adreno";
        case GpuVendor::Arm: return "Arm Mali/Immortalis";
        case GpuVendor::Imagination: return "Imagination PowerVR";
        case GpuVendor::Samsung: return "Samsung Xclipse";
        case GpuVendor::Amd: return "AMD";
        case GpuVendor::Nvidia: return "NVIDIA";
        case GpuVendor::Intel: return "Intel";
        case GpuVendor::Google: return "Google (software rasteriser)";
        case GpuVendor::Mesa: return "Mesa";
        case GpuVendor::Unknown: return "Unknown";
    }
    return "Unknown";
}

inline GpuVendor gpuVendorFromVendorId(uint32_t vendorId) {
    switch (vendorId) {
        case 0x5143: return GpuVendor::Qualcomm;
        case 0x13B5: return GpuVendor::Arm;
        case 0x1010: return GpuVendor::Imagination;
        case 0x144D: return GpuVendor::Samsung;
        case 0x1002: return GpuVendor::Amd;
        case 0x10DE: return GpuVendor::Nvidia;
        case 0x8086: return GpuVendor::Intel;
        case 0x1AE0: return GpuVendor::Google;
        default: return GpuVendor::Unknown;
    }
}

// ---------------------------------------------------------------------------
// Vulkan subset
// ---------------------------------------------------------------------------
struct VulkanCaps {
    bool available = false;
    uint32_t apiVersion = 0;          // VK_MAKE_VERSION encoded
    uint32_t driverVersion = 0;
    uint32_t vendorId = 0;
    uint32_t deviceId = 0;
    std::string deviceName;
    std::string driverName;
    GpuVendor vendor = GpuVendor::Unknown;

    bool hasComputeQueue = false;
    bool hasStorageImageRgba8 = true;      // format support probe result
    bool hasStorageImageR8 = false;

    uint32_t maxComputeWorkGroupInvocations = 0;
    uint32_t maxComputeWorkGroupSizeX = 0;
    uint32_t maxComputeWorkGroupSizeY = 0;
    uint32_t maxComputeSharedMemorySize = 0;
    uint32_t maxImageDimension2D = 0;
    uint32_t maxStorageBufferRange = 0;
    uint32_t maxPushConstantsSize = 0;
    uint32_t maxMemoryAllocationCount = 0;
    uint64_t deviceLocalMemoryBytes = 0;   // largest DEVICE_LOCAL heap
    uint64_t totalMemoryBytes = 0;
    uint64_t memoryBudgetBytes = 0;        // 0 when VK_EXT_memory_budget absent

    bool hasFloat16Storage = false;      // VK_KHR_16bit_storage + shaderFloat16
    bool hasInt8Storage = false;         // VK_KHR_8bit_storage
    bool hasSubgroupOps = false;         // VK_EXT/KHR_shader_subgroup_*
    bool hasTimelineSemaphore = false;
    bool hasExternalMemoryAndroidHardwareBuffer = false;
    bool hasTimestampCompute = false;    // timestampValidBits != 0 on compute queue
    bool timestampPeriodNs = false;      // (kept for ABI stability; unused)
    float timestampPeriod = 0.0f;

    uint32_t apiVersionMajor() const { return (apiVersion >> 22) & 0x7Fu; }
    uint32_t apiVersionMinor() const { return (apiVersion >> 12) & 0x3FFu; }
};

// ---------------------------------------------------------------------------
// OpenGL ES fallback
// ---------------------------------------------------------------------------
struct GlesCaps {
    bool available = false;
    int majorVersion = 0;
    int minorVersion = 0;
    bool computeShaders = false;      // ES 3.1+
    bool floatRenderTargets = false;  // EXT_color_buffer_float / half_float
    bool floatTextures = false;       // OES_texture_float
    int maxTextureSize = 0;
    int maxComputeWorkGroupInvocations = 0;
};

// ---------------------------------------------------------------------------
// Android / SoC
// ---------------------------------------------------------------------------
struct AndroidCaps {
    int sdkInt = 0;
    std::string release;
    std::string socModel;
    std::string socManufacturer;
    std::string hardware;
    std::string board;
    int cpuCoreCount = 0;
    uint32_t cpuArch = 0;             // 0 unknown, 1 arm32, 2 arm64, 3 x86_64
    bool supportsArm64 = false;
    bool isEmulator = false;
    bool hdrDisplay = false;
    float displayRefreshRate = 60.0f;
    uint32_t displayWidth = 0;
    uint32_t displayHeight = 0;
    uint32_t displayDensityDpi = 0;
};

struct MemoryCaps {
    uint64_t totalRamBytes = 0;
    uint64_t availableRamBytes = 0;
    uint32_t memoryClassMb = 0;        // ActivityManager.memoryClass
    uint32_t largeMemoryClassMb = 0;
    bool lowRamDevice = false;
};

// ---------------------------------------------------------------------------
// Neural acceleration
// ---------------------------------------------------------------------------
struct NeuralCaps {
    bool nnapiAvailable = false;                  // Android 8.1+
    int32_t nnapiFeatureLevel = 0;                // __ANDROID_API__ >= 29
    bool supportsFloat16 = false;                 // ANEURALNETWORKS_TENSOR_FLOAT16 relaxed
    bool supportsQuant8 = false;                  // ANEURALNETWORKS_TENSOR_QUANT8_ASYMM
    bool supportsQuant8Signed = false;            // QUANT8_ASYMM_SIGNED
    bool hasAccelerator = false;                  // a non-CPU device is present
    std::vector<std::string> acceleratorNames;
    std::string note;                             // human readable summary
};

// ---------------------------------------------------------------------------
// Thermal
// ---------------------------------------------------------------------------
struct ThermalCaps {
    bool powerManagerThermalApi = false;      // API 29+ getCurrentThermalStatus()
    bool hardwarePropertiesApi = false;       // API 24+ HardwarePropertiesManager (restricted)
    bool batteryTemperature = false;          // BatteryManager EXTRA_TEMPERATURE
    float batteryTemperatureC = 0.0f;
    int32_t platformThermalStatus = 0;        // PowerManager.THERMAL_STATUS_*
    bool cpuHeadroomAvailable = false;        // PerformanceHintManager (API 31+)
    bool gameManagerAvailable = false;        // GameManager (API 31+)
    bool gameModeSupported = false;           // GameManager.isGameModeSupported()
    std::string note;
};

// ---------------------------------------------------------------------------
// The complete capability snapshot
// ---------------------------------------------------------------------------
struct DeviceCapabilities {
    VulkanCaps vulkan;
    GlesCaps gles;
    AndroidCaps android;
    MemoryCaps memory;
    NeuralCaps neural;
    ThermalCaps thermal;

    // Convenience predicates used by the compatibility rules.
    bool hasUsableVulkan(uint32_t minVersion = 0x400000 /* VK 1.0 */) const {
        return vulkan.available && vulkan.apiVersion >= minVersion && vulkan.hasComputeQueue;
    }
    bool isSoftwareRenderer() const {
        const std::string& n = vulkan.deviceName;
        if (vulkan.vendor == GpuVendor::Google) return true;
        if (n.find("SwiftShader") != std::string::npos) return true;
        if (n.find("llvmpipe") != std::string::npos) return true;
        if (n.find("Software") != std::string::npos) return true;
        return false;
    }
};

// Human readable one-liner, used in the UI ("why unsupported" panel).
std::string describeDevice(const DeviceCapabilities& caps);

}  // namespace v4k
