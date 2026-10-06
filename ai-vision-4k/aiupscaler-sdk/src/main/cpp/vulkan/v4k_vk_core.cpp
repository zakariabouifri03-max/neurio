#include "v4k_vk.h"

#if defined(V4K_ENABLE_VULKAN)

#include <algorithm>
#include <cstring>

namespace v4k {
namespace vk {
namespace {

constexpr const char* kValidationLayer = "VK_LAYER_KHRONOS_validation";

std::vector<VkExtensionProperties> enumerateInstanceExtensions() {
    uint32_t count = 0;
    std::vector<VkExtensionProperties> extensions;
    if (vkEnumerateInstanceExtensionProperties(nullptr, &count, nullptr) != VK_SUCCESS || count == 0) {
        return extensions;
    }
    extensions.resize(count);
    if (vkEnumerateInstanceExtensionProperties(nullptr, &count, extensions.data()) != VK_SUCCESS) {
        extensions.clear();
    }
    return extensions;
}

bool extensionListHas(const std::vector<VkExtensionProperties>& list, const char* name) {
    for (const auto& extension : list) {
        if (std::strcmp(extension.extensionName, name) == 0) return true;
    }
    return false;
}

}  // namespace

const char* resultToString(VkResult result) {
    switch (result) {
        case VK_SUCCESS: return "VK_SUCCESS";
        case VK_NOT_READY: return "VK_NOT_READY";
        case VK_TIMEOUT: return "VK_TIMEOUT";
        case VK_INCOMPLETE: return "VK_INCOMPLETE";
        case VK_SUBOPTIMAL_KHR: return "VK_SUBOPTIMAL_KHR";
        case VK_ERROR_OUT_OF_HOST_MEMORY: return "VK_ERROR_OUT_OF_HOST_MEMORY";
        case VK_ERROR_OUT_OF_DEVICE_MEMORY: return "VK_ERROR_OUT_OF_DEVICE_MEMORY";
        case VK_ERROR_INITIALIZATION_FAILED: return "VK_ERROR_INITIALIZATION_FAILED";
        case VK_ERROR_DEVICE_LOST: return "VK_ERROR_DEVICE_LOST";
        case VK_ERROR_LAYER_NOT_PRESENT: return "VK_ERROR_LAYER_NOT_PRESENT";
        case VK_ERROR_EXTENSION_NOT_PRESENT: return "VK_ERROR_EXTENSION_NOT_PRESENT";
        case VK_ERROR_FEATURE_NOT_PRESENT: return "VK_ERROR_FEATURE_NOT_PRESENT";
        case VK_ERROR_FORMAT_NOT_SUPPORTED: return "VK_ERROR_FORMAT_NOT_SUPPORTED";
        case VK_ERROR_SURFACE_LOST_KHR: return "VK_ERROR_SURFACE_LOST_KHR";
        case VK_ERROR_OUT_OF_DATE_KHR: return "VK_ERROR_OUT_OF_DATE_KHR";
        case VK_ERROR_NATIVE_WINDOW_IN_USE_KHR: return "VK_ERROR_NATIVE_WINDOW_IN_USE_KHR";
        default: return "VK_ERROR_<other>";
    }
}

// ---------------------------------------------------------------------------
// Allocator
// ---------------------------------------------------------------------------
bool Allocator::init(VkDevice device, const VkPhysicalDeviceMemoryProperties& properties) {
    device_ = device;
    properties_ = properties;
    pools_.clear();
    allocatedBytes_ = 0;
    allocationCount_ = 0;
    return device_ != VK_NULL_HANDLE;
}

void Allocator::shutdown() {
    for (auto& pool : pools_) {
        if (pool.memory != VK_NULL_HANDLE) {
            vkFreeMemory(device_, pool.memory, nullptr);
        }
    }
    pools_.clear();
    allocatedBytes_ = 0;
    allocationCount_ = 0;
}

uint32_t Allocator::findMemoryType(uint32_t typeBits, VkMemoryPropertyFlags flags) const {
    for (uint32_t i = 0; i < properties_.memoryTypeCount; ++i) {
        if ((typeBits & (1u << i)) == 0) continue;
        if ((properties_.memoryTypes[i].propertyFlags & flags) == flags) return i;
    }
    return UINT32_MAX;
}

bool Allocator::allocate(const VkMemoryRequirements& requirements, VkMemoryPropertyFlags flags,
                         Allocation& out, std::string* error) {
    const uint32_t typeIndex = findMemoryType(requirements.memoryTypeBits, flags);
    if (typeIndex == UINT32_MAX) {
        if (error != nullptr) {
            *error = "no memory type satisfies the requested properties";
        }
        return false;
    }

    const VkDeviceSize alignment = std::max<VkDeviceSize>(requirements.alignment, 16);
    const VkDeviceSize size = requirements.size;

    // Reuse an existing pool when the block fits: mobile drivers reject very
    // large numbers of allocations (maxMemoryAllocationCount is often 4096).
    for (auto& pool : pools_) {
        if (pool.memoryTypeIndex != typeIndex || pool.dedicated) continue;
        const VkDeviceSize aligned = (pool.used + alignment - 1) / alignment * alignment;
        if (aligned + size <= pool.size) {
            out.memory = pool.memory;
            out.offset = aligned;
            out.size = size;
            out.memoryTypeIndex = typeIndex;
            out.dedicated = false;
            pool.used = aligned + size;
            ++allocationCount_;
            return true;
        }
    }

    // New block: 16 MB blocks for small allocations, dedicated for big ones.
    const VkDeviceSize blockSize = size > (16u << 20) ? size : (16u << 20);
    VkMemoryAllocateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    info.allocationSize = blockSize;
    info.memoryTypeIndex = typeIndex;

    Pool pool;
    pool.memoryTypeIndex = typeIndex;
    pool.size = blockSize;
    pool.used = 0;
    pool.dedicated = (size > (16u << 20));
    const VkResult result = vkAllocateMemory(device_, &info, nullptr, &pool.memory);
    if (result != VK_SUCCESS) {
        if (error != nullptr) {
            *error = std::string("vkAllocateMemory failed: ") + resultToString(result);
        }
        return false;
    }
    pool.used = size;
    pools_.push_back(pool);
    allocatedBytes_ += blockSize;

    out.memory = pool.memory;
    out.offset = 0;
    out.size = size;
    out.memoryTypeIndex = typeIndex;
    out.dedicated = pool.dedicated;
    ++allocationCount_;
    return true;
}

void Allocator::free(const Allocation&) {
    // Bump allocation: individual blocks are returned to the driver when the
    // allocator shuts down. This is intentional (see docs/ARCHITECTURE.md):
    // the engine's resource set is fixed after initialisation, so real-time
    // frames never allocate or free memory.
    if (allocationCount_ > 0) --allocationCount_;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
bool Context::create(bool enableValidation, std::string* error) {
    VkApplicationInfo appInfo{};
    appInfo.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
    appInfo.pApplicationName = "AI Vision 4K";
    appInfo.applicationVersion = VK_MAKE_VERSION(1, 0, 0);
    appInfo.pEngineName = "AIUpscaler";
    appInfo.engineVersion = VK_MAKE_VERSION(1, 0, 0);
    appInfo.apiVersion = VK_API_VERSION_1_1;

    std::vector<const char*> instanceExtensions;
    const std::vector<VkExtensionProperties> available = enumerateInstanceExtensions();
#if defined(__ANDROID__)
    // Needed only for presentation; the compute path works without any surface.
    if (extensionListHas(available, VK_KHR_SURFACE_EXTENSION_NAME)) {
        instanceExtensions.push_back(VK_KHR_SURFACE_EXTENSION_NAME);
    }
    if (extensionListHas(available, VK_KHR_ANDROID_SURFACE_EXTENSION_NAME)) {
        instanceExtensions.push_back(VK_KHR_ANDROID_SURFACE_EXTENSION_NAME);
    }
#endif

    std::vector<const char*> layers;
    if (enableValidation) {
        uint32_t layerCount = 0;
        vkEnumerateInstanceLayerProperties(&layerCount, nullptr);
        std::vector<VkLayerProperties> layerProperties(layerCount);
        vkEnumerateInstanceLayerProperties(&layerCount, layerProperties.data());
        for (const auto& layer : layerProperties) {
            if (std::strcmp(layer.layerName, kValidationLayer) == 0) {
                layers.push_back(kValidationLayer);
                V4K_LOGI("vulkan: validation layer enabled");
                break;
            }
        }
        if (layers.empty()) {
            V4K_LOGW("vulkan: validation layer requested but not installed");
        }
    }

    VkInstanceCreateInfo createInfo{};
    createInfo.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
    createInfo.pApplicationInfo = &appInfo;
    createInfo.enabledExtensionCount = static_cast<uint32_t>(instanceExtensions.size());
    createInfo.ppEnabledExtensionNames = instanceExtensions.empty() ? nullptr : instanceExtensions.data();
    createInfo.enabledLayerCount = static_cast<uint32_t>(layers.size());
    createInfo.ppEnabledLayerNames = layers.empty() ? nullptr : layers.data();

    VkResult result = vkCreateInstance(&createInfo, nullptr, &instance_);
    if (result != VK_SUCCESS) {
        if (error != nullptr) {
            *error = std::string("vkCreateInstance failed: ") + resultToString(result) +
                     (result == VK_ERROR_INCOMPATIBLE_DRIVER
                          ? " (the device reports no usable Vulkan driver)"
                          : "");
        }
        return false;
    }

    if (enableValidation) {
        getProperties2 = reinterpret_cast<PFN_vkGetPhysicalDeviceProperties2>(
            vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceProperties2"));
        getFeatures2 = reinterpret_cast<PFN_vkGetPhysicalDeviceFeatures2>(
            vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceFeatures2"));
        getFormatProperties2 = reinterpret_cast<PFN_vkGetPhysicalDeviceFormatProperties2>(
            vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceFormatProperties2"));
        getImageFormatProperties2 = reinterpret_cast<PFN_vkGetPhysicalDeviceImageFormatProperties2>(
            vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceImageFormatProperties2"));
        getMemoryProperties2 = reinterpret_cast<PFN_vkGetPhysicalDeviceMemoryProperties2>(
            vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceMemoryProperties2"));
    }

    if (!choosePhysicalDevice(error)) {
        destroy();
        return false;
    }
    if (!createLogicalDevice(error)) {
        destroy();
        return false;
    }

    VkCommandPoolCreateInfo poolInfo{};
    poolInfo.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    poolInfo.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT |
                     VK_COMMAND_POOL_CREATE_TRANSIENT_BIT;
    poolInfo.queueFamilyIndex = queues_.compute;
    result = vkCreateCommandPool(device_, &poolInfo, nullptr, &commandPool_);
    if (result != VK_SUCCESS) {
        if (error != nullptr) {
            *error = std::string("vkCreateCommandPool failed: ") + resultToString(result);
        }
        destroy();
        return false;
    }

    return allocator_.init(device_, memoryProperties_);
}

bool Context::choosePhysicalDevice(std::string* error) {
    uint32_t deviceCount = 0;
    VkResult result = vkEnumeratePhysicalDevices(instance_, &deviceCount, nullptr);
    if (result != VK_SUCCESS || deviceCount == 0) {
        if (error != nullptr) {
            *error = "no Vulkan physical device is present";
        }
        return false;
    }
    std::vector<VkPhysicalDevice> devices(deviceCount);
    result = vkEnumeratePhysicalDevices(instance_, &deviceCount, devices.data());
    if (result != VK_SUCCESS) {
        if (error != nullptr) {
            *error = std::string("vkEnumeratePhysicalDevices failed: ") + resultToString(result);
        }
        return false;
    }

    uint32_t bestScore = 0;
    for (VkPhysicalDevice device : devices) {
        const uint32_t score = scorePhysicalDevice(device);
        if (score > bestScore) {
            bestScore = score;
            physicalDevice_ = device;
        }
    }
    if (physicalDevice_ == VK_NULL_HANDLE) {
        if (error != nullptr) {
            *error = "no Vulkan device offers a compute queue for the upscaler";
        }
        return false;
    }

    vkGetPhysicalDeviceProperties(physicalDevice_, &deviceProperties_);
    vkGetPhysicalDeviceMemoryProperties(physicalDevice_, &memoryProperties_);
    apiVersion_ = deviceProperties_.apiVersion;
    deviceName_ = deviceProperties_.deviceName;
    timestampPeriod_ = deviceProperties_.limits.timestampPeriod;

    getProperties2 = reinterpret_cast<PFN_vkGetPhysicalDeviceProperties2>(
        vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceProperties2"));
    getFeatures2 = reinterpret_cast<PFN_vkGetPhysicalDeviceFeatures2>(
        vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceFeatures2"));
    getFormatProperties2 = reinterpret_cast<PFN_vkGetPhysicalDeviceFormatProperties2>(
        vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceFormatProperties2"));
    getImageFormatProperties2 = reinterpret_cast<PFN_vkGetPhysicalDeviceImageFormatProperties2>(
        vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceImageFormatProperties2"));
    getMemoryProperties2 = reinterpret_cast<PFN_vkGetPhysicalDeviceMemoryProperties2>(
        vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceMemoryProperties2"));

    uint32_t familyCount = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(physicalDevice_, &familyCount, nullptr);
    std::vector<VkQueueFamilyProperties> families(familyCount);
    vkGetPhysicalDeviceQueueFamilyProperties(physicalDevice_, &familyCount, families.data());
    for (uint32_t i = 0; i < familyCount; ++i) {
        if ((families[i].queueFlags & VK_QUEUE_COMPUTE_BIT) != 0 && queues_.compute == UINT32_MAX) {
            queues_.compute = i;
        }
        if ((families[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) != 0 && queues_.graphics == UINT32_MAX) {
            queues_.graphics = i;
        }
    }
    if (queues_.compute == UINT32_MAX && queues_.graphics != UINT32_MAX) {
        queues_.compute = queues_.graphics;
    }

    V4K_LOGI("vulkan: using %s (api %u.%u, compute family %u)", deviceName_.c_str(),
             apiVersion_ >> 22, (apiVersion_ >> 12) & 0x3FFu, queues_.compute);
    return true;
}

uint32_t Context::scorePhysicalDevice(VkPhysicalDevice device) const {
    VkPhysicalDeviceProperties properties{};
    vkGetPhysicalDeviceProperties(device, &properties);

    uint32_t familyCount = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(device, &familyCount, nullptr);
    if (familyCount == 0) return 0;
    std::vector<VkQueueFamilyProperties> families(familyCount);
    vkGetPhysicalDeviceQueueFamilyProperties(device, &familyCount, families.data());

    bool hasCompute = false;
    for (const auto& family : families) {
        // A dedicated compute queue is ideal; a compute-capable queue is the
        // minimum the upscaler can run on.
        if ((family.queueFlags & VK_QUEUE_COMPUTE_BIT) != 0) {
            hasCompute = true;
            if ((family.queueFlags & VK_QUEUE_GRAPHICS_BIT) == 0) break;
        }
    }
    if (!hasCompute) return 0;

    uint32_t score = 1;
    if (properties.apiVersion >= VK_API_VERSION_1_1) score += 4;
    if (properties.apiVersion >= VK_API_VERSION_1_2) score += 2;

    // Software rasterisers can technically run the pipeline but never at a
    // usable frame rate; rank them last while still allowing an emulator to
    // start (the compatibility report will label the device unsupported).
    const std::string name = properties.deviceName;
    const bool software = name.find("SwiftShader") != std::string::npos ||
                          name.find("llvmpipe") != std::string::npos ||
                          properties.vendorID == 0x1AE0;
    if (!software) score += 32;

    if (properties.limits.maxComputeWorkGroupInvocations >= 128) score += 4;
    if (properties.limits.maxImageDimension2D >= 4096) score += 2;

    VkPhysicalDeviceMemoryProperties memoryProperties{};
    vkGetPhysicalDeviceMemoryProperties(device, &memoryProperties);
    for (uint32_t i = 0; i < memoryProperties.memoryHeapCount; ++i) {
        if ((memoryProperties.memoryHeaps[i].flags & VK_MEMORY_HEAP_DEVICE_LOCAL_BIT) != 0 &&
            memoryProperties.memoryHeaps[i].size >= (512ull << 20)) {
            score += 8;
        }
    }
    return score;
}

bool Context::createLogicalDevice(std::string* error) {
    if (getProperties2 == nullptr) getProperties2 = reinterpret_cast<PFN_vkGetPhysicalDeviceProperties2>(
        vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceProperties2"));

    const float priority = 1.0f;
    std::vector<VkDeviceQueueCreateInfo> queueInfos;
    const uint32_t uniqueFamilies[2] = {queues_.compute, queues_.graphics};
    for (uint32_t index = 0; index < 2; ++index) {
        if (uniqueFamilies[index] == UINT32_MAX) continue;
        bool duplicate = false;
        for (uint32_t previous = 0; previous < index; ++previous) {
            if (uniqueFamilies[previous] == uniqueFamilies[index]) duplicate = true;
        }
        if (duplicate) continue;
        VkDeviceQueueCreateInfo queueInfo{};
        queueInfo.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
        queueInfo.queueFamilyIndex = uniqueFamilies[index];
        queueInfo.queueCount = 1;
        queueInfo.pQueuePriorities = &priority;
        queueInfos.push_back(queueInfo);
    }

    // Optional extensions, enabled only when present.
    uint32_t extensionCount = 0;
    vkEnumerateDeviceExtensionProperties(physicalDevice_, nullptr, &extensionCount, nullptr);
    std::vector<VkExtensionProperties> available(extensionCount);
    vkEnumerateDeviceExtensionProperties(physicalDevice_, nullptr, &extensionCount, available.data());

    std::vector<const char*> extensions;
    const char* wanted[] = {
        VK_KHR_SWAPCHAIN_EXTENSION_NAME,
        "VK_EXT_memory_budget",
        "VK_KHR_portability_subset",
    };
    for (const char* name : wanted) {
        for (const auto& extension : available) {
            if (std::strcmp(extension.extensionName, name) == 0) {
                if (std::strcmp(name, "VK_KHR_portability_subset") == 0) {
                    // Requesting this on a non-portable device is an error.
                    continue;
                }
                extensions.push_back(name);
                break;
            }
        }
    }

    // Features: the engine needs storage images with format qualifiers. It
    // deliberately does NOT require shaderStorageImageWriteWithoutFormat (some
    // older mobile drivers lack it) because every shader declares its format.
    VkPhysicalDeviceFeatures features{};
    vkGetPhysicalDeviceFeatures(physicalDevice_, &features);
    VkPhysicalDeviceFeatures enabled{};
    enabled.shaderStorageImageWriteWithoutFormat = VK_FALSE;
    enabled.shaderFloat64 = VK_FALSE;
    enabled.robustBufferAccess = features.robustBufferAccess;

    VkDeviceCreateInfo createInfo{};
    createInfo.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
    createInfo.queueCreateInfoCount = static_cast<uint32_t>(queueInfos.size());
    createInfo.pQueueCreateInfos = queueInfos.data();
    createInfo.enabledExtensionCount = static_cast<uint32_t>(extensions.size());
    createInfo.ppEnabledExtensionNames = extensions.empty() ? nullptr : extensions.data();
    createInfo.pEnabledFeatures = &enabled;

    VkResult result = vkCreateDevice(physicalDevice_, &createInfo, nullptr, &device_);
    if (result != VK_SUCCESS) {
        if (error != nullptr) {
            *error = std::string("vkCreateDevice failed: ") + resultToString(result);
        }
        return false;
    }

    enabledDeviceExtensions_ = available;
    if (queues_.compute != UINT32_MAX) {
        vkGetDeviceQueue(device_, queues_.compute, 0, &computeQueue_);
    }
    if (queues_.graphics != UINT32_MAX) {
        vkGetDeviceQueue(device_, queues_.graphics, 0, &graphicsQueue_);
    }
    if (computeQueue_ == VK_NULL_HANDLE) computeQueue_ = graphicsQueue_;

    if (getMemoryProperties2 != nullptr) {
        getMemoryProperties2 = reinterpret_cast<PFN_vkGetPhysicalDeviceMemoryProperties2>(
            vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceMemoryProperties2"));
    }
    return true;
}

bool Context::adopt(VkInstance instance, VkPhysicalDevice physicalDevice, VkDevice device,
                    const QueueFamilies& queues, VkQueue computeQueue, VkQueue graphicsQueue,
                    std::string* error) {
    const auto fail = [&](const std::string& message) {
        if (error != nullptr) *error = message;
        return false;
    };
    if (device_ != VK_NULL_HANDLE) {
        return fail("the context already has a device; destroy() it first");
    }
    if (instance == VK_NULL_HANDLE || physicalDevice == VK_NULL_HANDLE || device == VK_NULL_HANDLE) {
        return fail("adopt() needs the caller's VkInstance, VkPhysicalDevice and VkDevice");
    }
    if (queues.compute == UINT32_MAX && queues.graphics == UINT32_MAX) {
        return fail("adopt() needs a queue family: the engine needs a compute or graphics queue");
    }

    instance_ = instance;
    physicalDevice_ = physicalDevice;
    device_ = device;
    queues_ = queues;
    ownsDevice_ = false;

    vkGetPhysicalDeviceMemoryProperties(physicalDevice_, &memoryProperties_);
    vkGetPhysicalDeviceProperties(physicalDevice_, &deviceProperties_);
    deviceName_ = deviceProperties_.deviceName;
    apiVersion_ = deviceProperties_.apiVersion;
    timestampPeriod_ = deviceProperties_.limits.timestampPeriod;

    // Optional entry points, same set the engine-created device resolves.
    getProperties2 = reinterpret_cast<PFN_vkGetPhysicalDeviceProperties2>(
        vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceProperties2"));
    getFeatures2 = reinterpret_cast<PFN_vkGetPhysicalDeviceFeatures2>(
        vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceFeatures2"));
    getFormatProperties2 = reinterpret_cast<PFN_vkGetPhysicalDeviceFormatProperties2>(
        vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceFormatProperties2"));
    getImageFormatProperties2 = reinterpret_cast<PFN_vkGetPhysicalDeviceImageFormatProperties2>(
        vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceImageFormatProperties2"));
    getMemoryProperties2 = reinterpret_cast<PFN_vkGetPhysicalDeviceMemoryProperties2>(
        vkGetInstanceProcAddr(instance_, "vkGetPhysicalDeviceMemoryProperties2"));

    // The caller picked the extensions; record what the device offers so the
    // pipeline can ask whether e.g. memory budget is available.
    uint32_t extensionCount = 0;
    if (vkEnumerateDeviceExtensionProperties(physicalDevice_, nullptr, &extensionCount, nullptr) ==
        VK_SUCCESS) {
        enabledDeviceExtensions_.resize(extensionCount);
        if (vkEnumerateDeviceExtensionProperties(physicalDevice_, nullptr, &extensionCount,
                                                 enabledDeviceExtensions_.data()) != VK_SUCCESS) {
            enabledDeviceExtensions_.clear();
        }
    }

    computeQueue_ = computeQueue;
    graphicsQueue_ = graphicsQueue;
    if (computeQueue_ == VK_NULL_HANDLE && queues_.compute != UINT32_MAX) {
        vkGetDeviceQueue(device_, queues_.compute, 0, &computeQueue_);
    }
    if (graphicsQueue_ == VK_NULL_HANDLE && queues_.graphics != UINT32_MAX) {
        vkGetDeviceQueue(device_, queues_.graphics, 0, &graphicsQueue_);
    }
    if (computeQueue_ == VK_NULL_HANDLE) computeQueue_ = graphicsQueue_;
    if (computeQueue_ == VK_NULL_HANDLE) {
        device_ = VK_NULL_HANDLE;
        instance_ = VK_NULL_HANDLE;
        physicalDevice_ = VK_NULL_HANDLE;
        return fail("the supplied queues could not be retrieved from the device");
    }

    if (!allocator_.init(device_, memoryProperties_)) {
        return fail("the allocator could not be initialised for the adopted device");
    }

    // The engine's own command pool on the caller's device.
    VkCommandPoolCreateInfo poolInfo{};
    poolInfo.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    poolInfo.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    poolInfo.queueFamilyIndex = queues_.compute != UINT32_MAX ? queues_.compute : queues_.graphics;
    const VkResult result = vkCreateCommandPool(device_, &poolInfo, nullptr, &commandPool_);
    if (result != VK_SUCCESS) {
        return fail(std::string("vkCreateCommandPool failed on the adopted device: ") +
                    resultToString(result));
    }
    V4K_LOGI("vulkan: adopted caller device '%s' (api %u.%u)", deviceName_.c_str(),
             apiVersion_ >> 22, (apiVersion_ >> 12) & 0x3FFu);
    if (error != nullptr) error->clear();
    return true;
}

void Context::destroy() {
    if (device_ != VK_NULL_HANDLE) {
        vkDeviceWaitIdle(device_);
        allocator_.shutdown();
        if (commandPool_ != VK_NULL_HANDLE) {
            vkDestroyCommandPool(device_, commandPool_, nullptr);
            commandPool_ = VK_NULL_HANDLE;
        }
        if (ownsDevice_) {
            vkDestroyDevice(device_, nullptr);
        }
        device_ = VK_NULL_HANDLE;
    }
    if (ownsDevice_ && instance_ != VK_NULL_HANDLE) {
        vkDestroyInstance(instance_, nullptr);
    }
    instance_ = VK_NULL_HANDLE;
    physicalDevice_ = VK_NULL_HANDLE;
    ownsDevice_ = true;
}

bool Context::hasDeviceExtension(const char* name) const {
    for (const auto& extension : enabledDeviceExtensions_) {
        if (std::strcmp(extension.extensionName, name) == 0) return true;
    }
    return false;
}

VkCommandBuffer Context::beginOneShot() const {
    VkCommandBufferAllocateInfo allocateInfo{};
    allocateInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    allocateInfo.commandPool = commandPool_;
    allocateInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    allocateInfo.commandBufferCount = 1;

    VkCommandBuffer cmd = VK_NULL_HANDLE;
    if (vkAllocateCommandBuffers(device_, &allocateInfo, &cmd) != VK_SUCCESS) return VK_NULL_HANDLE;

    VkCommandBufferBeginInfo beginInfo{};
    beginInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    beginInfo.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    if (vkBeginCommandBuffer(cmd, &beginInfo) != VK_SUCCESS) return VK_NULL_HANDLE;
    return cmd;
}

bool Context::endOneShot(VkCommandBuffer cmd, bool wait) const {
    if (cmd == VK_NULL_HANDLE) return false;
    if (vkEndCommandBuffer(cmd) != VK_SUCCESS) return false;

    VkFence fence = createFence(false);
    VkSubmitInfo submitInfo{};
    submitInfo.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    submitInfo.commandBufferCount = 1;
    submitInfo.pCommandBuffers = &cmd;

    const VkResult result = vkQueueSubmit(computeQueue_, 1, &submitInfo, fence);
    if (result != VK_SUCCESS) {
        vkDestroyFence(device_, fence, nullptr);
        vkFreeCommandBuffers(device_, commandPool_, 1, &cmd);
        return false;
    }
    if (wait) {
        vkWaitForFences(device_, 1, &fence, VK_TRUE, UINT64_MAX);
    }
    vkDestroyFence(device_, fence, nullptr);
    vkFreeCommandBuffers(device_, commandPool_, 1, &cmd);
    return true;
}

VkFence Context::createFence(bool signaled) const {
    VkFenceCreateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
    info.flags = signaled ? VK_FENCE_CREATE_SIGNALED_BIT : 0;
    VkFence fence = VK_NULL_HANDLE;
    if (device_ == VK_NULL_HANDLE || vkCreateFence(device_, &info, nullptr, &fence) != VK_SUCCESS) {
        return VK_NULL_HANDLE;
    }
    return fence;
}

VkSemaphore Context::createSemaphore() const {
    VkSemaphoreCreateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO;
    VkSemaphore semaphore = VK_NULL_HANDLE;
    if (device_ == VK_NULL_HANDLE ||
        vkCreateSemaphore(device_, &info, nullptr, &semaphore) != VK_SUCCESS) {
        return VK_NULL_HANDLE;
    }
    return semaphore;
}

VkCommandBuffer Context::allocatePrimaryCommandBuffer() const {
    VkCommandBufferAllocateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    info.commandPool = commandPool_;
    info.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    info.commandBufferCount = 1;
    VkCommandBuffer cmd = VK_NULL_HANDLE;
    if (device_ == VK_NULL_HANDLE || vkAllocateCommandBuffers(device_, &info, &cmd) != VK_SUCCESS) {
        return VK_NULL_HANDLE;
    }
    return cmd;
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------
bool TimestampQueries::init(Context& context, uint32_t count, std::string* error) {
    count_ = count;
    available_ = false;
    if (context.device() == VK_NULL_HANDLE || count == 0) return false;

    // Query support depends on the queue family's timestampValidBits.
    uint32_t familyCount = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(context.physicalDevice(), &familyCount, nullptr);
    std::vector<VkQueueFamilyProperties> families(familyCount);
    vkGetPhysicalDeviceQueueFamilyProperties(context.physicalDevice(), &familyCount, families.data());
    const uint32_t computeFamily = context.queues().compute;
    if (computeFamily >= families.size() || families[computeFamily].timestampValidBits == 0) {
        if (error != nullptr) {
            *error = "the compute queue family does not support timestamp queries";
        }
        return false;
    }

    VkQueryPoolCreateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_QUERY_POOL_CREATE_INFO;
    info.queryType = VK_QUERY_TYPE_TIMESTAMP;
    info.queryCount = count * 2;
    const VkResult result = vkCreateQueryPool(context.device(), &info, nullptr, &pool_);
    if (result != VK_SUCCESS) {
        if (error != nullptr) {
            *error = std::string("vkCreateQueryPool failed: ") + resultToString(result);
        }
        return false;
    }
    device_ = context.device();
    available_ = true;
    return true;
}

void TimestampQueries::destroy(Context& context) {
    if (pool_ != VK_NULL_HANDLE && context.device() != VK_NULL_HANDLE) {
        vkDestroyQueryPool(context.device(), pool_, nullptr);
    }
    pool_ = VK_NULL_HANDLE;
    device_ = VK_NULL_HANDLE;
    available_ = false;
}

void TimestampQueries::reset(VkCommandBuffer cmd) {
    if (!available_) return;
    vkCmdResetQueryPool(cmd, pool_, 0, count_ * 2);
}

void TimestampQueries::writeStart(VkCommandBuffer cmd, uint32_t index) {
    if (!available_ || index >= count_) return;
    vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, pool_, index * 2);
}

void TimestampQueries::writeEnd(VkCommandBuffer cmd, uint32_t index) {
    if (!available_ || index >= count_) return;
    vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, pool_, index * 2 + 1);
}

bool TimestampQueries::readImpl(std::vector<double>& durationsMs, float timestampPeriodNs, bool wait) {
    if (!available_ || pool_ == VK_NULL_HANDLE || device_ == VK_NULL_HANDLE) return false;
    durationsMs.assign(count_, -1.0);
    std::vector<uint64_t> values(count_ * 2, 0);
    const VkQueryResultFlags flags =
        static_cast<VkQueryResultFlags>(VK_QUERY_RESULT_64_BIT |
                                        (wait ? VK_QUERY_RESULT_WAIT_BIT : 0));
    const VkResult result = vkGetQueryPoolResults(device_, pool_, 0, count_ * 2,
                                                  sizeof(uint64_t) * values.size(), values.data(),
                                                  sizeof(uint64_t), flags);
    if (result == VK_NOT_READY && !wait) {
        return false;   // no numbers this frame; the overlay shows "n/a"
    }
    if (result != VK_SUCCESS && result != VK_NOT_READY) {
        V4K_LOGW("vkGetQueryPoolResults: %s", resultToString(result));
        return false;
    }
    for (uint32_t i = 0; i < count_; ++i) {
        const uint64_t start = values[i * 2];
        const uint64_t end = values[i * 2 + 1];
        if (end > start) {
            durationsMs[i] = static_cast<double>(end - start) * timestampPeriodNs / 1e6;
        }
    }
    return true;
}

bool TimestampQueries::readDurations(std::vector<double>& durationsMs, float timestampPeriodNs) {
    return readImpl(durationsMs, timestampPeriodNs, /*wait=*/false);
}

bool TimestampQueries::readDurationsBlocking(std::vector<double>& durationsMs,
                                             float timestampPeriodNs) {
    return readImpl(durationsMs, timestampPeriodNs, /*wait=*/true);
}

}  // namespace vk
}  // namespace v4k

#endif  // V4K_ENABLE_VULKAN
