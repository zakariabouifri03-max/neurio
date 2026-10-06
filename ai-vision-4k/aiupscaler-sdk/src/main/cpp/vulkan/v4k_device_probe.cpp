// Vulkan capability probe.
//
// Fills the Vulkan half of DeviceCapabilities. Everything the compatibility
// engine needs to explain a rejection is measured here — no guesswork, no
// hard-coded device tables.
#include <algorithm>
#include <cstring>
#include <string>
#include <vector>

#include "../core/v4k_compat.h"
#include "../core/v4k_log.h"

#if defined(V4K_ENABLE_VULKAN)
#include "v4k_vk.h"
#endif

namespace v4k {
namespace {

// The helpers below use Vulkan types, so with the backend compiled out they are
// not just unused, they do not compile: a no-Vulkan build must still be a valid
// build (that is the whole point of the CMake option).
#if defined(V4K_ENABLE_VULKAN)

bool extensionPresent(const std::vector<VkExtensionProperties>& extensions, const char* name) {
    for (const auto& extension : extensions) {
        if (std::strcmp(extension.extensionName, name) == 0) return true;
    }
    return false;
}

bool supportsStorageImage(VkPhysicalDevice device, VkFormat format, VkImageUsageFlags extraUsage) {
    VkImageFormatProperties properties{};
    const VkResult result = vkGetPhysicalDeviceImageFormatProperties(
        device, format, VK_IMAGE_TYPE_2D, VK_IMAGE_TILING_OPTIMAL,
        VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_SAMPLED_BIT | extraUsage, 0, &properties);
    return result == VK_SUCCESS;
}

#endif  // V4K_ENABLE_VULKAN

}  // namespace

#if defined(V4K_ENABLE_VULKAN)

DeviceCapabilities probeDeviceWithVulkan(std::string* error) {
    DeviceCapabilities caps;
    VulkanCaps& vulkan = caps.vulkan;

    // A short lived instance is enough: everything we report is a physical
    // device property, so no logical device (and no driver-side state) is
    // created just to answer compatibility questions.
    VkApplicationInfo appInfo{};
    appInfo.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
    appInfo.pApplicationName = "AI Vision 4K probe";
    appInfo.apiVersion = VK_API_VERSION_1_1;

    VkInstanceCreateInfo instanceInfo{};
    instanceInfo.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
    instanceInfo.pApplicationInfo = &appInfo;

    VkInstance instance = VK_NULL_HANDLE;
    VkResult result = vkCreateInstance(&instanceInfo, nullptr, &instance);
    if (result != VK_SUCCESS) {
        if (error != nullptr) {
            *error = std::string("vkCreateInstance failed during the capability probe: ") +
                     vk::resultToString(result);
        }
        return caps;
    }

    uint32_t deviceCount = 0;
    result = vkEnumeratePhysicalDevices(instance, &deviceCount, nullptr);
    if (result != VK_SUCCESS || deviceCount == 0) {
        vkDestroyInstance(instance, nullptr);
        if (error != nullptr) *error = "no Vulkan physical device found";
        return caps;
    }
    std::vector<VkPhysicalDevice> devices(deviceCount);
    vkEnumeratePhysicalDevices(instance, &deviceCount, devices.data());

    // Same scoring rules as the engine's context so the probe describes the
    // device the engine will actually use.
    VkPhysicalDevice chosen = devices.front();
    uint32_t bestScore = 0;
    for (VkPhysicalDevice device : devices) {
        VkPhysicalDeviceProperties properties{};
        vkGetPhysicalDeviceProperties(device, &properties);
        uint32_t score = 1;
        if (properties.apiVersion >= VK_API_VERSION_1_1) score += 4;
        if (properties.limits.maxComputeWorkGroupInvocations >= 128) score += 4;
        if (properties.limits.maxImageDimension2D >= 4096) score += 2;
        const std::string name = properties.deviceName;
        if (name.find("SwiftShader") == std::string::npos && properties.vendorID != 0x1AE0) {
            score += 32;
        }
        if (score > bestScore) {
            bestScore = score;
            chosen = device;
        }
    }

    VkPhysicalDeviceProperties properties{};
    vkGetPhysicalDeviceProperties(chosen, &properties);
    VkPhysicalDeviceMemoryProperties memoryProperties{};
    vkGetPhysicalDeviceMemoryProperties(chosen, &memoryProperties);

    vulkan.available = true;
    vulkan.apiVersion = properties.apiVersion;
    vulkan.driverVersion = properties.driverVersion;
    vulkan.vendorId = properties.vendorID;
    vulkan.deviceId = properties.deviceID;
    vulkan.deviceName = properties.deviceName;
    vulkan.vendor = gpuVendorFromVendorId(properties.vendorID);
    vulkan.timestampPeriod = properties.limits.timestampPeriod;
    vulkan.maxComputeWorkGroupInvocations = properties.limits.maxComputeWorkGroupInvocations;
    vulkan.maxComputeWorkGroupSizeX = properties.limits.maxComputeWorkGroupSize[0];
    vulkan.maxComputeWorkGroupSizeY = properties.limits.maxComputeWorkGroupSize[1];
    vulkan.maxComputeSharedMemorySize = properties.limits.maxComputeSharedMemorySize;
    vulkan.maxImageDimension2D = properties.limits.maxImageDimension2D;
    vulkan.maxStorageBufferRange = properties.limits.maxStorageBufferRange;
    vulkan.maxPushConstantsSize = properties.limits.maxPushConstantsSize;
    vulkan.maxMemoryAllocationCount = properties.limits.maxMemoryAllocationCount;

    for (uint32_t i = 0; i < memoryProperties.memoryHeapCount; ++i) {
        const VkMemoryHeap& heap = memoryProperties.memoryHeaps[i];
        vulkan.totalMemoryBytes += heap.size;
        if ((heap.flags & VK_MEMORY_HEAP_DEVICE_LOCAL_BIT) != 0) {
            vulkan.deviceLocalMemoryBytes = std::max(vulkan.deviceLocalMemoryBytes,
                                                     static_cast<uint64_t>(heap.size));
        }
    }

    uint32_t familyCount = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(chosen, &familyCount, nullptr);
    std::vector<VkQueueFamilyProperties> families(familyCount);
    vkGetPhysicalDeviceQueueFamilyProperties(chosen, &familyCount, families.data());
    for (const auto& family : families) {
        if ((family.queueFlags & VK_QUEUE_COMPUTE_BIT) != 0) {
            vulkan.hasComputeQueue = true;
            if (family.timestampValidBits != 0) vulkan.hasTimestampCompute = true;
        }
    }

    vulkan.hasStorageImageRgba8 = supportsStorageImage(chosen, VK_FORMAT_R8G8B8A8_UNORM, 0);
    vulkan.hasStorageImageR8 = supportsStorageImage(chosen, VK_FORMAT_R8_UNORM, 0);

    uint32_t extensionCount = 0;
    vkEnumerateDeviceExtensionProperties(chosen, nullptr, &extensionCount, nullptr);
    std::vector<VkExtensionProperties> extensions(extensionCount);
    vkEnumerateDeviceExtensionProperties(chosen, nullptr, &extensionCount, extensions.data());

    vulkan.hasFloat16Storage = extensionPresent(extensions, "VK_KHR_16bit_storage") ||
                               extensionPresent(extensions, "VK_KHR_shader_float16_int8");
    vulkan.hasInt8Storage = extensionPresent(extensions, "VK_KHR_8bit_storage") ||
                            extensionPresent(extensions, "VK_KHR_shader_float16_int8");
    vulkan.hasTimelineSemaphore = (properties.apiVersion >= VK_API_VERSION_1_2) ||
                                 extensionPresent(extensions, "VK_KHR_timeline_semaphore");
    vulkan.hasExternalMemoryAndroidHardwareBuffer =
        extensionPresent(extensions, "VK_ANDROID_external_memory_android_hardware_buffer");
    vulkan.hasSubgroupOps = (properties.apiVersion >= VK_API_VERSION_1_1) ||
                           extensionPresent(extensions, "VK_EXT_shader_subgroup_ballot");

    // Shader float16 is a *feature*, not just an extension: ask properly.
    if (properties.apiVersion >= VK_API_VERSION_1_2) {
        VkPhysicalDeviceShaderFloat16Int8Features float16Features{};
        float16Features.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SHADER_FLOAT16_INT8_FEATURES;
        VkPhysicalDeviceFeatures2 features2{};
        features2.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2;
        features2.pNext = &float16Features;
        auto getFeatures2 = reinterpret_cast<PFN_vkGetPhysicalDeviceFeatures2>(
            vkGetInstanceProcAddr(instance, "vkGetPhysicalDeviceFeatures2"));
        if (getFeatures2 != nullptr) {
            getFeatures2(chosen, &features2);
            vulkan.hasFloat16Storage = vulkan.hasFloat16Storage && float16Features.shaderFloat16;
            vulkan.hasInt8Storage = vulkan.hasInt8Storage && float16Features.shaderInt8;
        }
    }

    // Memory budget (VK_EXT_memory_budget) gives the real headroom the driver
    // is willing to hand out; without it we report the heap size only.
    if (extensionPresent(extensions, "VK_EXT_memory_budget") && properties.apiVersion >= VK_API_VERSION_1_1) {
        VkPhysicalDeviceMemoryBudgetPropertiesEXT budget{};
        budget.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MEMORY_BUDGET_PROPERTIES_EXT;
        VkPhysicalDeviceMemoryProperties2 memoryProperties2{};
        memoryProperties2.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MEMORY_PROPERTIES_2;
        memoryProperties2.pNext = &budget;
        auto getMemoryProperties2 = reinterpret_cast<PFN_vkGetPhysicalDeviceMemoryProperties2>(
            vkGetInstanceProcAddr(instance, "vkGetPhysicalDeviceMemoryProperties2"));
        if (getMemoryProperties2 != nullptr) {
            getMemoryProperties2(chosen, &memoryProperties2);
            for (uint32_t i = 0; i < memoryProperties2.memoryProperties.memoryHeapCount; ++i) {
                if ((memoryProperties2.memoryProperties.memoryHeaps[i].flags &
                     VK_MEMORY_HEAP_DEVICE_LOCAL_BIT) != 0) {
                    vulkan.memoryBudgetBytes =
                        std::max(vulkan.memoryBudgetBytes, static_cast<uint64_t>(budget.heapBudget[i]));
                }
            }
        }
    }

    if (error != nullptr) error->clear();
    vkDestroyInstance(instance, nullptr);

    V4K_LOGI("probe: %s | %s | Vulkan %u.%u | deviceLocal %.1f GB | storage RGBA8 %d R8 %d | fp16 %d",
             vulkan.deviceName.c_str(), toString(vulkan.vendor), vulkan.apiVersionMajor(),
             vulkan.apiVersionMinor(),
             static_cast<double>(vulkan.deviceLocalMemoryBytes) / (1024.0 * 1024.0 * 1024.0),
             vulkan.hasStorageImageRgba8, vulkan.hasStorageImageR8, vulkan.hasFloat16Storage);
    return caps;
}

#else  // !V4K_ENABLE_VULKAN

DeviceCapabilities probeDeviceWithVulkan(std::string* error) {
    if (error != nullptr) {
        *error = "this build was compiled without Vulkan support (V4K_ENABLE_VULKAN=OFF); "
                 "no GPU capability can be probed";
    }
    return DeviceCapabilities{};
}

#endif

std::string describeVulkanUnavailable() {
    return "The engine reports NO_VULKAN: the device (or this build) exposes no Vulkan compute "
           "device, so no frame can be reconstructed on the GPU.";
}

}  // namespace v4k
