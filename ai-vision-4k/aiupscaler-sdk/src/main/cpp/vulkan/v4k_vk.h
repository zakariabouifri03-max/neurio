// AI Vision 4K — thin Vulkan wrapper.
//
// Scope is deliberately small: instance/device selection, a bump allocator,
// images/buffers/samplers, compute pipelines, descriptor sets, barriers and
// timestamp queries. That is exactly what the upscaler and the demo need, and
// nothing more. No VMA, no volk, no validation-layer-only conveniences, because
// an engine that a game ships inside its own process should not drag in a large
// dependency (and it must not fight with the game's own Vulkan usage).
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "../core/v4k_device.h"
#include "../core/v4k_log.h"

#if defined(V4K_ENABLE_VULKAN)
#if defined(__ANDROID__)
#define VK_USE_PLATFORM_ANDROID_KHR 1
#endif
#include <vulkan/vulkan.h>
#endif

namespace v4k {
namespace vk {

#if !defined(V4K_ENABLE_VULKAN)

// The engine can be built without Vulkan (see CMake option V4K_ENABLE_VULKAN).
// In that configuration every entry point reports "not available" instead of
// silently degrading, which keeps the compatibility report honest.
constexpr bool kAvailable = false;

#else

constexpr bool kAvailable = true;

const char* resultToString(VkResult result);

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------
class Allocator {
public:
    struct Allocation {
        VkDeviceMemory memory = VK_NULL_HANDLE;
        VkDeviceSize offset = 0;
        VkDeviceSize size = 0;
        uint32_t memoryTypeIndex = 0;
        bool dedicated = false;
    };

    bool init(VkDevice device, const VkPhysicalDeviceMemoryProperties& properties);
    void shutdown();

    bool allocate(const VkMemoryRequirements& requirements, VkMemoryPropertyFlags flags,
                  Allocation& out, std::string* error);
    void free(const Allocation& allocation);

    uint64_t allocatedBytes() const { return allocatedBytes_; }
    uint32_t allocationCount() const { return allocationCount_; }

    // Picks a memory type index, or UINT32_MAX when no type satisfies the flags.
    uint32_t findMemoryType(uint32_t typeBits, VkMemoryPropertyFlags flags) const;

private:
    struct Pool {
        VkDeviceMemory memory = VK_NULL_HANDLE;
        uint32_t memoryTypeIndex = 0;
        VkDeviceSize size = 0;
        VkDeviceSize used = 0;
        bool dedicated = false;
    };

    VkDevice device_ = VK_NULL_HANDLE;
    VkPhysicalDeviceMemoryProperties properties_{};
    std::vector<Pool> pools_;
    uint64_t allocatedBytes_ = 0;
    uint32_t allocationCount_ = 0;
};

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------
struct QueueFamilies {
    uint32_t compute = UINT32_MAX;
    uint32_t graphics = UINT32_MAX;
    uint32_t present = UINT32_MAX;

    bool hasCompute() const { return compute != UINT32_MAX; }
    bool hasGraphics() const { return graphics != UINT32_MAX; }
};

// ---------------------------------------------------------------------------
// Context: instance, device, queues, command pool.
// ---------------------------------------------------------------------------
class Context {
public:
    bool create(bool enableValidation, std::string* error);

    // Adopts a device owned by the caller — the integration path for a game
    // that already has its own Vulkan context and wants in-pipeline upscaling.
    // The engine never destroys an instance, physical device or VkDevice it was
    // given: destroy() only releases what the engine itself allocated (its
    // command pool, its memory blocks and its pipelines).
    // `computeQueue`/`graphicsQueue` may be VK_NULL_HANDLE; the engine then
    // takes index 0 of the corresponding family.
    bool adopt(VkInstance instance, VkPhysicalDevice physicalDevice, VkDevice device,
               const QueueFamilies& queues, VkQueue computeQueue, VkQueue graphicsQueue,
               std::string* error);
    bool ownsDevice() const { return ownsDevice_; }

    void destroy();

    bool valid() const { return device_ != VK_NULL_HANDLE; }

    DeviceCapabilities probeCapabilities(std::string* error) const;

    VkInstance instance() const { return instance_; }
    VkPhysicalDevice physicalDevice() const { return physicalDevice_; }
    VkDevice device() const { return device_; }
    VkQueue computeQueue() const { return computeQueue_; }
    VkQueue graphicsQueue() const { return graphicsQueue_; }
    const QueueFamilies& queues() const { return queues_; }
    const Allocator& allocator() const { return allocator_; }
    Allocator& allocator() { return allocator_; }
    uint32_t apiVersion() const { return apiVersion_; }
    const std::string& deviceName() const { return deviceName_; }
    float timestampPeriod() const { return timestampPeriod_; }

    // Command buffers for the compute path (one per frame in flight).
    VkCommandPool commandPool() const { return commandPool_; }
    VkCommandBuffer beginOneShot() const;
    bool endOneShot(VkCommandBuffer buffer, bool wait) const;

    // Persistent command buffer for a frame slot (real-time path: allocate
    // once, reset per frame, never allocate during rendering).
    VkCommandBuffer allocatePrimaryCommandBuffer() const;

    // Fence helpers used by the frame loop.
    VkFence createFence(bool signaled) const;
    VkSemaphore createSemaphore() const;

private:
    bool choosePhysicalDevice(std::string* error);
    bool createLogicalDevice(std::string* error);
    uint32_t scorePhysicalDevice(VkPhysicalDevice device) const;

    VkInstance instance_ = VK_NULL_HANDLE;
    VkPhysicalDevice physicalDevice_ = VK_NULL_HANDLE;
    VkDevice device_ = VK_NULL_HANDLE;
    bool ownsDevice_ = true;   // false when adopt()ing a game's device
    VkQueue computeQueue_ = VK_NULL_HANDLE;
    VkQueue graphicsQueue_ = VK_NULL_HANDLE;
    VkCommandPool commandPool_ = VK_NULL_HANDLE;
    VkPhysicalDeviceMemoryProperties memoryProperties_{};
    VkPhysicalDeviceProperties deviceProperties_{};
    QueueFamilies queues_{};
    Allocator allocator_;
    uint32_t apiVersion_ = 0;
    std::string deviceName_;
    float timestampPeriod_ = 0.0f;
    // Optional entry points.
public:
    PFN_vkGetPhysicalDeviceProperties2 getProperties2 = nullptr;
    PFN_vkGetPhysicalDeviceFeatures2 getFeatures2 = nullptr;
    PFN_vkGetPhysicalDeviceFormatProperties2 getFormatProperties2 = nullptr;
    PFN_vkGetPhysicalDeviceImageFormatProperties2 getImageFormatProperties2 = nullptr;
    PFN_vkGetPhysicalDeviceMemoryProperties2 getMemoryProperties2 = nullptr;

private:
    std::vector<VkExtensionProperties> enabledDeviceExtensions_;
public:
    bool hasDeviceExtension(const char* name) const;
};

// ---------------------------------------------------------------------------
// Images / buffers / samplers
// ---------------------------------------------------------------------------
struct Image {
    VkImage image = VK_NULL_HANDLE;
    VkImageView view = VK_NULL_HANDLE;
    uint32_t width = 0;
    uint32_t height = 0;
    VkFormat format = VK_FORMAT_UNDEFINED;
    VkImageLayout layout = VK_IMAGE_LAYOUT_UNDEFINED;
    VkImageUsageFlags usage = 0;
    Allocator::Allocation allocation;
    VkDeviceSize allocationSize = 0;

    bool valid() const { return image != VK_NULL_HANDLE; }
};

struct Buffer {
    VkBuffer buffer = VK_NULL_HANDLE;
    VkDeviceSize size = 0;
    void* mapped = nullptr;
    Allocator::Allocation allocation;
    VkDescriptorBufferInfo descriptor{};

    bool valid() const { return buffer != VK_NULL_HANDLE; }
};

bool createImage(Context& context, uint32_t width, uint32_t height, VkFormat format,
                 VkImageUsageFlags usage, Image& out, std::string* error);
void destroyImage(Context& context, Image& image);

bool createBuffer(Context& context, VkDeviceSize size, VkBufferUsageFlags usage,
                  VkMemoryPropertyFlags properties, Buffer& out, std::string* error);
void destroyBuffer(Context& context, Buffer& buffer);

VkSampler createLinearSampler(Context& context, bool clampToEdge = true);
VkSampler createNearestSampler(Context& context);

// Layout transitions. `srcStage`/`dstStage` should name the stages that produce
// and consume the image; the access masks are derived from the usage flags.
void transitionImage(VkCommandBuffer cmd, Image& image, VkImageLayout newLayout,
                     VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage);

bool uploadToImage(Context& context, VkCommandBuffer cmd, Image& image, const void* pixels,
                   VkDeviceSize bytes, std::string* error);
bool downloadFromImage(Context& context, VkCommandBuffer cmd, Image& image, void* outPixels,
                       VkDeviceSize bytes, std::string* error);
bool uploadToBuffer(Context& context, Buffer& buffer, const void* data, VkDeviceSize bytes);
bool downloadFromBuffer(Context& context, VkCommandBuffer cmd, Buffer& buffer, void* out,
                        VkDeviceSize bytes);

// ---------------------------------------------------------------------------
// Compute pipelines
// ---------------------------------------------------------------------------
struct ComputePipeline {
    VkPipeline pipeline = VK_NULL_HANDLE;
    VkPipelineLayout layout = VK_NULL_HANDLE;
    VkDescriptorSetLayout descriptorSetLayout = VK_NULL_HANDLE;
    uint32_t pushConstantBytes = 0;
    std::string name;

    bool valid() const { return pipeline != VK_NULL_HANDLE; }
};

struct DescriptorBinding {
    uint32_t binding = 0;
    VkDescriptorType type = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE;
    uint32_t count = 1;
    VkShaderStageFlags stages = VK_SHADER_STAGE_COMPUTE_BIT;
};

bool createComputePipeline(Context& context, const std::vector<DescriptorBinding>& bindings,
                           uint32_t pushConstantBytes, const uint32_t* spirvWords,
                           size_t spirvWordCount, const char* debugName, ComputePipeline& out,
                           std::string* error);
void destroyComputePipeline(Context& context, ComputePipeline& pipeline);

VkDescriptorPool createDescriptorPool(Context& context, const std::vector<DescriptorBinding>& bindings,
                                      uint32_t setCount);
VkDescriptorSet allocateDescriptorSet(Context& context, VkDescriptorPool pool,
                                      VkDescriptorSetLayout layout);

void writeStorageImage(VkDevice device, VkDescriptorSet set, uint32_t binding, VkImageView view);
void writeCombinedSampler(VkDevice device, VkDescriptorSet set, uint32_t binding, VkImageView view,
                          VkSampler sampler);
void writeStorageBuffer(VkDevice device, VkDescriptorSet set, uint32_t binding, VkBuffer buffer,
                        VkDeviceSize size);

// Dispatch helper: binds, pushes and dispatches in one call.
void recordDispatch(VkCommandBuffer cmd, const ComputePipeline& pipeline, VkDescriptorSet set,
                    uint32_t groupCountX, uint32_t groupCountY, uint32_t groupCountZ,
                    const void* pushData, uint32_t pushSize);

// Splits a 2D dispatch into multiples of the workgroup size, clamped to the
// device limits (a 4K frame is 480x270 groups of 8x8 — well inside the 65535
// limit, but a 64x64 workgroup on a 120 Hz 8K panel would not be).
void computeGroupCount(uint32_t width, uint32_t height, uint32_t groupSizeX, uint32_t groupSizeY,
                       uint32_t& groupsX, uint32_t& groupsY);

// ---------------------------------------------------------------------------
// Timestamp queries (real GPU timing, never estimated)
// ---------------------------------------------------------------------------
class TimestampQueries {
public:
    // `count` is the number of independent timed ranges (one per pipeline pass).
    bool init(Context& context, uint32_t count, std::string* error);
    void destroy(Context& context);

    bool available() const { return available_; }
    uint32_t count() const { return count_; }

    void reset(VkCommandBuffer cmd);
    void writeStart(VkCommandBuffer cmd, uint32_t index);
    void writeEnd(VkCommandBuffer cmd, uint32_t index);
    // Resolution to nanoseconds is done with the device's timestampPeriod.
    // Returns false when the results were not ready (never blocks).
    // Non-blocking read: entries that are not ready are reported as -1.
    bool readDurations(std::vector<double>& durationsMs, float timestampPeriodNs);
    // Blocking read used by the benchmark, which needs a complete result set.
    bool readDurationsBlocking(std::vector<double>& durationsMs, float timestampPeriodNs);

private:
    bool readImpl(std::vector<double>& durationsMs, float timestampPeriodNs, bool wait);

    VkDevice device_ = VK_NULL_HANDLE;
    VkQueryPool pool_ = VK_NULL_HANDLE;
    uint32_t count_ = 0;
    bool available_ = false;
};

// ---------------------------------------------------------------------------
// Swapchain (demo + screen enhancement presentation)
// ---------------------------------------------------------------------------
struct Swapchain {
    VkSwapchainKHR swapchain = VK_NULL_HANDLE;
    VkSurfaceKHR surface = VK_NULL_HANDLE;
    VkFormat format = VK_FORMAT_UNDEFINED;
    VkColorSpaceKHR colorSpace = VK_COLOR_SPACE_SRGB_NONLINEAR_KHR;
    VkExtent2D extent{0, 0};
    VkPresentModeKHR presentMode = VK_PRESENT_MODE_FIFO_KHR;
    std::vector<VkImage> images;
    std::vector<VkImageView> views;
    std::vector<VkFramebuffer> framebuffers;   // created for the present render pass
    VkRenderPass renderPass = VK_NULL_HANDLE;
    uint32_t imageCount = 0;
    bool ownsSurface = false;
    bool valid() const { return swapchain != VK_NULL_HANDLE; }
};

bool createSwapchain(Context& context, void* nativeWindow, Swapchain& out, std::string* error);
bool recreateSwapchain(Context& context, void* nativeWindow, Swapchain& swapchain, std::string* error);
void destroySwapchain(Context& context, Swapchain& swapchain);

struct AcquiredImage {
    uint32_t index = 0;
    bool suboptimal = false;
    VkResult result = VK_SUCCESS;
};

AcquiredImage acquireNextImage(Context& context, Swapchain& swapchain, VkSemaphore signal,
                               VkFence fence);
VkResult presentImage(Context& context, Swapchain& swapchain, uint32_t imageIndex,
                      VkSemaphore waitSemaphore);

#endif  // V4K_ENABLE_VULKAN
}  // namespace vk

// Non-Vulkan builds still need the device probe to explain themselves.
DeviceCapabilities probeDeviceWithVulkan(std::string* error);
std::string describeVulkanUnavailable();

}  // namespace v4k
