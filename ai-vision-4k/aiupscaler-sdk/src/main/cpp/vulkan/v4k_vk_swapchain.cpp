#include "v4k_vk.h"

#if defined(V4K_ENABLE_VULKAN)

#include <algorithm>
#include <cstring>

#if defined(__ANDROID__)
#include <android/native_window.h>
#endif

namespace v4k {
namespace vk {
namespace {

#if defined(__ANDROID__)
PFN_vkCreateAndroidSurfaceKHR loadAndroidSurfaceCreate(VkInstance instance) {
    return reinterpret_cast<PFN_vkCreateAndroidSurfaceKHR>(
        vkGetInstanceProcAddr(instance, "vkCreateAndroidSurfaceKHR"));
}
#endif

VkSurfaceFormatKHR chooseSurfaceFormat(const std::vector<VkSurfaceFormatKHR>& formats) {
    if (formats.empty()) {
        return VkSurfaceFormatKHR{VK_FORMAT_R8G8B8A8_UNORM, VK_COLOR_SPACE_SRGB_NONLINEAR_KHR};
    }
    // Prefer 8 bit sRGB-ish formats: cheaper bandwidth on mobile, and the demo
    // shader already outputs tone-mapped values.
    const VkFormat preferred[] = {VK_FORMAT_R8G8B8A8_UNORM, VK_FORMAT_B8G8R8A8_UNORM,
                                  VK_FORMAT_R8G8B8A8_SRGB, VK_FORMAT_B8G8R8A8_SRGB};
    for (VkFormat want : preferred) {
        for (const auto& format : formats) {
            if (format.format == want) return format;
        }
    }
    if (formats.size() == 1 && formats[0].format == VK_FORMAT_UNDEFINED) {
        return VkSurfaceFormatKHR{VK_FORMAT_R8G8B8A8_UNORM, VK_COLOR_SPACE_SRGB_NONLINEAR_KHR};
    }
    return formats[0];
}

VkPresentModeKHR choosePresentMode(VkPresentModeKHR requested,
                                   const std::vector<VkPresentModeKHR>& modes) {
    for (VkPresentModeKHR mode : modes) {
        if (mode == requested) return requested;
    }
    // FIFO is the only mode Vulkan guarantees.
    return VK_PRESENT_MODE_FIFO_KHR;
}

void destroyFramebuffersAndPass(Context& context, Swapchain& swapchain) {
    for (VkFramebuffer framebuffer : swapchain.framebuffers) {
        if (framebuffer != VK_NULL_HANDLE) vkDestroyFramebuffer(context.device(), framebuffer, nullptr);
    }
    swapchain.framebuffers.clear();
    if (swapchain.renderPass != VK_NULL_HANDLE) {
        vkDestroyRenderPass(context.device(), swapchain.renderPass, nullptr);
        swapchain.renderPass = VK_NULL_HANDLE;
    }
}

bool buildRenderPass(Context& context, Swapchain& swapchain, std::string* error) {
    VkAttachmentDescription color{};
    color.format = swapchain.format;
    color.samples = VK_SAMPLE_COUNT_1_BIT;
    color.loadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;   // the sky pass covers everything
    color.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    color.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    color.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    color.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    color.finalLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;

    VkAttachmentReference colorRef{};
    colorRef.attachment = 0;
    colorRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    VkSubpassDescription subpass{};
    subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
    subpass.colorAttachmentCount = 1;
    subpass.pColorAttachments = &colorRef;

    VkSubpassDependency dependency{};
    dependency.srcSubpass = VK_SUBPASS_EXTERNAL;
    dependency.dstSubpass = 0;
    dependency.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    dependency.srcAccessMask = 0;
    dependency.dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    dependency.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;

    VkRenderPassCreateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
    info.attachmentCount = 1;
    info.pAttachments = &color;
    info.subpassCount = 1;
    info.pSubpasses = &subpass;
    info.dependencyCount = 1;
    info.pDependencies = &dependency;

    const VkResult result = vkCreateRenderPass(context.device(), &info, nullptr, &swapchain.renderPass);
    if (result != VK_SUCCESS) {
        if (error != nullptr) {
            *error = std::string("vkCreateRenderPass failed: ") + resultToString(result);
        }
        return false;
    }
    return true;
}

bool createFramebuffers(Context& context, Swapchain& swapchain, std::string* error) {
    swapchain.framebuffers.assign(swapchain.views.size(), VK_NULL_HANDLE);
    for (size_t i = 0; i < swapchain.views.size(); ++i) {
        VkFramebufferCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
        info.renderPass = swapchain.renderPass;
        info.attachmentCount = 1;
        info.pAttachments = &swapchain.views[i];
        info.width = swapchain.extent.width;
        info.height = swapchain.extent.height;
        info.layers = 1;
        const VkResult result =
            vkCreateFramebuffer(context.device(), &info, nullptr, &swapchain.framebuffers[i]);
        if (result != VK_SUCCESS) {
            if (error != nullptr) {
                *error = std::string("vkCreateFramebuffer failed: ") + resultToString(result);
            }
            return false;
        }
    }
    return true;
}

void destroySwapchainImages(Context& context, Swapchain& swapchain) {
    destroyFramebuffersAndPass(context, swapchain);
    for (VkImageView view : swapchain.views) {
        if (view != VK_NULL_HANDLE) vkDestroyImageView(context.device(), view, nullptr);
    }
    swapchain.views.clear();
    swapchain.images.clear();
    if (swapchain.swapchain != VK_NULL_HANDLE) {
        vkDestroySwapchainKHR(context.device(), swapchain.swapchain, nullptr);
        swapchain.swapchain = VK_NULL_HANDLE;
    }
}

bool buildSwapchain(Context& context, void* nativeWindow, Swapchain& swapchain, std::string* error) {
#if defined(__ANDROID__)
    if (swapchain.surface == VK_NULL_HANDLE) {
        if (nativeWindow == nullptr) {
            if (error != nullptr) *error = "no native window for the Vulkan surface";
            return false;
        }
        PFN_vkCreateAndroidSurfaceKHR createAndroidSurface = loadAndroidSurfaceCreate(context.instance());
        if (createAndroidSurface == nullptr) {
            if (error != nullptr) {
                *error = "VK_KHR_android_surface is not available on this device";
            }
            return false;
        }
        VkAndroidSurfaceCreateInfoKHR surfaceInfo{};
        surfaceInfo.sType = VK_STRUCTURE_TYPE_ANDROID_SURFACE_CREATE_INFO_KHR;
        surfaceInfo.window = reinterpret_cast<ANativeWindow*>(nativeWindow);
        const VkResult result =
            createAndroidSurface(context.instance(), &surfaceInfo, nullptr, &swapchain.surface);
        if (result != VK_SUCCESS) {
            if (error != nullptr) {
                *error = std::string("vkCreateAndroidSurfaceKHR failed: ") + resultToString(result);
            }
            return false;
        }
        swapchain.ownsSurface = true;
    }
#else
    (void)nativeWindow;
    if (error != nullptr) *error = "swapchain creation requires an Android native window";
    return false;
#endif

    VkSurfaceCapabilitiesKHR capabilities{};
    VkResult result =
        vkGetPhysicalDeviceSurfaceCapabilitiesKHR(context.physicalDevice(), swapchain.surface, &capabilities);
    if (result != VK_SUCCESS) {
        if (error != nullptr) *error = std::string("vkGetPhysicalDeviceSurfaceCapabilitiesKHR failed: ") +
                                       resultToString(result);
        return false;
    }

    uint32_t formatCount = 0;
    vkGetPhysicalDeviceSurfaceFormatsKHR(context.physicalDevice(), swapchain.surface, &formatCount, nullptr);
    std::vector<VkSurfaceFormatKHR> formats(std::max(1u, formatCount));
    if (formatCount > 0) {
        vkGetPhysicalDeviceSurfaceFormatsKHR(context.physicalDevice(), swapchain.surface, &formatCount,
                                             formats.data());
        formats.resize(formatCount);
    }
    const VkSurfaceFormatKHR surfaceFormat = chooseSurfaceFormat(formats);

    uint32_t modeCount = 0;
    vkGetPhysicalDeviceSurfacePresentModesKHR(context.physicalDevice(), swapchain.surface, &modeCount,
                                              nullptr);
    std::vector<VkPresentModeKHR> modes(std::max(1u, modeCount));
    if (modeCount > 0) {
        vkGetPhysicalDeviceSurfacePresentModesKHR(context.physicalDevice(), swapchain.surface, &modeCount,
                                                  modes.data());
        modes.resize(modeCount);
    }
    // MAILBOX when available: an uncapped queue that still tears-free, which is
    // what a benchmark needs to see the renderer's real ceiling. FIFO otherwise.
    const VkPresentModeKHR requestedMode = choosePresentMode(VK_PRESENT_MODE_MAILBOX_KHR, modes);

    VkExtent2D extent = capabilities.currentExtent;
    if (extent.width == UINT32_MAX || extent.height == UINT32_MAX) {
        // 0 means "pick something": use the display size reported by Android.
        extent.width = std::max(capabilities.minImageExtent.width,
                                std::min(capabilities.maxImageExtent.width, 1920u));
        extent.height = std::max(capabilities.minImageExtent.height,
                                 std::min(capabilities.maxImageExtent.height, 1080u));
    }

    uint32_t imageCount = capabilities.minImageCount + 1;
    if (capabilities.maxImageCount > 0 && imageCount > capabilities.maxImageCount) {
        imageCount = capabilities.maxImageCount;
    }

    VkSwapchainCreateInfoKHR info{};
    info.sType = VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR;
    info.surface = swapchain.surface;
    info.minImageCount = imageCount;
    info.imageFormat = surfaceFormat.format;
    info.imageColorSpace = surfaceFormat.colorSpace;
    info.imageExtent = extent;
    info.imageArrayLayers = 1;
    // TRANSFER_DST lets a compute pass write the final frame directly when the
    // game integrates the SDK and presents without a graphics pass.
    info.imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT |
                      VK_IMAGE_USAGE_SAMPLED_BIT;
    info.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
    info.preTransform = capabilities.currentTransform;
    info.compositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
    info.presentMode = requestedMode;
    info.clipped = VK_TRUE;
    info.oldSwapchain = swapchain.swapchain;

    result = vkCreateSwapchainKHR(context.device(), &info, nullptr, &swapchain.swapchain);
    if (result != VK_SUCCESS) {
        if (error != nullptr) *error = std::string("vkCreateSwapchainKHR failed: ") + resultToString(result);
        return false;
    }

    uint32_t swapchainImageCount = 0;
    vkGetSwapchainImagesKHR(context.device(), swapchain.swapchain, &swapchainImageCount, nullptr);
    swapchain.images.resize(swapchainImageCount);
    result = vkGetSwapchainImagesKHR(context.device(), swapchain.swapchain, &swapchainImageCount,
                                     swapchain.images.data());
    if (result != VK_SUCCESS) {
        if (error != nullptr) *error = std::string("vkGetSwapchainImagesKHR failed: ") + resultToString(result);
        return false;
    }
    swapchain.images.resize(swapchainImageCount);

    swapchain.views.assign(swapchain.images.size(), VK_NULL_HANDLE);
    for (size_t i = 0; i < swapchain.images.size(); ++i) {
        VkImageViewCreateInfo viewInfo{};
        viewInfo.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
        viewInfo.image = swapchain.images[i];
        viewInfo.viewType = VK_IMAGE_VIEW_TYPE_2D;
        viewInfo.format = surfaceFormat.format;
        viewInfo.components = {VK_COMPONENT_SWIZZLE_IDENTITY, VK_COMPONENT_SWIZZLE_IDENTITY,
                               VK_COMPONENT_SWIZZLE_IDENTITY, VK_COMPONENT_SWIZZLE_IDENTITY};
        viewInfo.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        viewInfo.subresourceRange.levelCount = 1;
        viewInfo.subresourceRange.layerCount = 1;
        result = vkCreateImageView(context.device(), &viewInfo, nullptr, &swapchain.views[i]);
        if (result != VK_SUCCESS) {
            if (error != nullptr) *error = std::string("vkCreateImageView (swapchain) failed: ") +
                                           resultToString(result);
            return false;
        }
    }

    swapchain.format = surfaceFormat.format;
    swapchain.colorSpace = surfaceFormat.colorSpace;
    swapchain.extent = extent;
    swapchain.presentMode = requestedMode;
    swapchain.imageCount = static_cast<uint32_t>(swapchain.images.size());

    if (!buildRenderPass(context, swapchain, error)) return false;
    if (!createFramebuffers(context, swapchain, error)) return false;

    V4K_LOGI("swapchain: %ux%u, %u images, mode %d", extent.width, extent.height, swapchain.imageCount,
             static_cast<int>(requestedMode));
    return true;
}

}  // namespace

bool createSwapchain(Context& context, void* nativeWindow, Swapchain& out, std::string* error) {
    out = Swapchain{};
    return buildSwapchain(context, nativeWindow, out, error);
}

bool recreateSwapchain(Context& context, void* nativeWindow, Swapchain& swapchain, std::string* error) {
    vkDeviceWaitIdle(context.device());
    // Keep the surface (it survives extent changes) but rebuild everything else.
    destroySwapchainImages(context, swapchain);
    return buildSwapchain(context, nativeWindow, swapchain, error);
}

void destroySwapchain(Context& context, Swapchain& swapchain) {
    if (!context.valid()) return;
    vkDeviceWaitIdle(context.device());
    destroySwapchainImages(context, swapchain);
    if (swapchain.surface != VK_NULL_HANDLE && swapchain.ownsSurface) {
        vkDestroySurfaceKHR(context.instance(), swapchain.surface, nullptr);
    }
    swapchain.surface = VK_NULL_HANDLE;
}

AcquiredImage acquireNextImage(Context& context, Swapchain& swapchain, VkSemaphore signal,
                               VkFence fence) {
    AcquiredImage acquired{};
    const VkResult result =
        vkAcquireNextImageKHR(context.device(), swapchain.swapchain, UINT64_MAX, signal, fence,
                              &acquired.index);
    acquired.result = result;
    acquired.suboptimal = (result == VK_SUBOPTIMAL_KHR);
    return acquired;
}

VkResult presentImage(Context& context, Swapchain& swapchain, uint32_t imageIndex,
                      VkSemaphore waitSemaphore) {
    VkPresentInfoKHR info{};
    info.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR;
    info.waitSemaphoreCount = waitSemaphore == VK_NULL_HANDLE ? 0u : 1u;
    info.pWaitSemaphores = waitSemaphore == VK_NULL_HANDLE ? nullptr : &waitSemaphore;
    info.swapchainCount = 1;
    info.pSwapchains = &swapchain.swapchain;
    info.pImageIndices = &imageIndex;
    return vkQueuePresentKHR(context.graphicsQueue() != VK_NULL_HANDLE ? context.graphicsQueue()
                                                                      : context.computeQueue(),
                             &info);
}

}  // namespace vk
}  // namespace v4k

#endif  // V4K_ENABLE_VULKAN
