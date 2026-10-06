#include "v4k_vk.h"

#if defined(V4K_ENABLE_VULKAN)

#include <algorithm>
#include <cstring>

namespace v4k {
namespace vk {
namespace {

VkAccessFlags accessMaskFor(VkImageLayout layout, VkImageUsageFlags usage) {
    switch (layout) {
        case VK_IMAGE_LAYOUT_UNDEFINED:
            return 0;
        case VK_IMAGE_LAYOUT_GENERAL:
            return VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        case VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL:
            return VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
        case VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL:
            return VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;
        case VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL:
            return VK_ACCESS_TRANSFER_READ_BIT;
        case VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL:
            return VK_ACCESS_TRANSFER_WRITE_BIT;
        case VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL:
            return VK_ACCESS_SHADER_READ_BIT;
        default:
            (void)usage;
            return 0;
    }
}

bool isDepthFormat(VkFormat format) {
    return format == VK_FORMAT_D16_UNORM || format == VK_FORMAT_D32_SFLOAT ||
           format == VK_FORMAT_D24_UNORM_S8_UINT || format == VK_FORMAT_D32_SFLOAT_S8_UINT;
}

}  // namespace

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------
bool createImage(Context& context, uint32_t width, uint32_t height, VkFormat format,
                 VkImageUsageFlags usage, Image& out, std::string* error) {
    out = Image{};
    if (!context.valid() || width == 0 || height == 0) {
        if (error != nullptr) *error = "invalid image dimensions";
        return false;
    }

    VkImageCreateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
    info.imageType = VK_IMAGE_TYPE_2D;
    info.format = format;
    info.extent = {width, height, 1};
    info.mipLevels = 1;
    info.arrayLayers = 1;
    info.samples = VK_SAMPLE_COUNT_1_BIT;
    info.tiling = VK_IMAGE_TILING_OPTIMAL;
    info.usage = usage;
    info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    info.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;

    VkResult result = vkCreateImage(context.device(), &info, nullptr, &out.image);
    if (result != VK_SUCCESS) {
        if (error != nullptr) {
            *error = std::string("vkCreateImage failed: ") + resultToString(result);
        }
        return false;
    }

    VkMemoryRequirements requirements{};
    vkGetImageMemoryRequirements(context.device(), out.image, &requirements);
    const VkMemoryPropertyFlags properties = VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT;
    if (!context.allocator().allocate(requirements, properties, out.allocation, error)) {
        vkDestroyImage(context.device(), out.image, nullptr);
        out.image = VK_NULL_HANDLE;
        return false;
    }
    out.allocationSize = out.allocation.size;
    result = vkBindImageMemory(context.device(), out.image, out.allocation.memory, out.allocation.offset);
    if (result != VK_SUCCESS) {
        if (error != nullptr) {
            *error = std::string("vkBindImageMemory failed: ") + resultToString(result);
        }
        vkDestroyImage(context.device(), out.image, nullptr);
        out.image = VK_NULL_HANDLE;
        return false;
    }

    VkImageViewCreateInfo viewInfo{};
    viewInfo.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
    viewInfo.image = out.image;
    viewInfo.viewType = VK_IMAGE_VIEW_TYPE_2D;
    viewInfo.format = format;
    viewInfo.subresourceRange.aspectMask =
        isDepthFormat(format) ? VK_IMAGE_ASPECT_DEPTH_BIT : VK_IMAGE_ASPECT_COLOR_BIT;
    viewInfo.subresourceRange.baseMipLevel = 0;
    viewInfo.subresourceRange.levelCount = 1;
    viewInfo.subresourceRange.baseArrayLayer = 0;
    viewInfo.subresourceRange.layerCount = 1;
    result = vkCreateImageView(context.device(), &viewInfo, nullptr, &out.view);
    if (result != VK_SUCCESS) {
        if (error != nullptr) {
            *error = std::string("vkCreateImageView failed: ") + resultToString(result);
        }
        destroyImage(context, out);
        return false;
    }

    out.width = width;
    out.height = height;
    out.format = format;
    out.usage = usage;
    out.layout = VK_IMAGE_LAYOUT_UNDEFINED;
    return true;
}

void destroyImage(Context& context, Image& image) {
    if (!context.valid()) return;
    if (image.view != VK_NULL_HANDLE) {
        vkDestroyImageView(context.device(), image.view, nullptr);
        image.view = VK_NULL_HANDLE;
    }
    if (image.image != VK_NULL_HANDLE) {
        vkDestroyImage(context.device(), image.image, nullptr);
        image.image = VK_NULL_HANDLE;
    }
    if (image.allocation.memory != VK_NULL_HANDLE) {
        // The allocator owns the block; freeing is a no-op bookkeeping step.
        context.allocator().free(image.allocation);
        image.allocation = Allocator::Allocation{};
    }
    image.layout = VK_IMAGE_LAYOUT_UNDEFINED;
}

bool createBuffer(Context& context, VkDeviceSize size, VkBufferUsageFlags usage,
                  VkMemoryPropertyFlags properties, Buffer& out, std::string* error) {
    out = Buffer{};
    if (!context.valid() || size == 0) {
        if (error != nullptr) *error = "invalid buffer size";
        return false;
    }
    VkBufferCreateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    info.size = size;
    info.usage = usage;
    info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;

    VkResult result = vkCreateBuffer(context.device(), &info, nullptr, &out.buffer);
    if (result != VK_SUCCESS) {
        if (error != nullptr) *error = std::string("vkCreateBuffer failed: ") + resultToString(result);
        return false;
    }
    VkMemoryRequirements requirements{};
    vkGetBufferMemoryRequirements(context.device(), out.buffer, &requirements);
    if (!context.allocator().allocate(requirements, properties, out.allocation, error)) {
        vkDestroyBuffer(context.device(), out.buffer, nullptr);
        out.buffer = VK_NULL_HANDLE;
        return false;
    }
    result = vkBindBufferMemory(context.device(), out.buffer, out.allocation.memory, out.allocation.offset);
    if (result != VK_SUCCESS) {
        if (error != nullptr) *error = std::string("vkBindBufferMemory failed: ") + resultToString(result);
        vkDestroyBuffer(context.device(), out.buffer, nullptr);
        out.buffer = VK_NULL_HANDLE;
        return false;
    }
    out.size = size;
    out.descriptor.buffer = out.buffer;
    out.descriptor.offset = 0;
    out.descriptor.range = size;

    if ((properties & VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT) != 0) {
        if (vkMapMemory(context.device(), out.allocation.memory, out.allocation.offset, size, 0,
                        &out.mapped) != VK_SUCCESS) {
            out.mapped = nullptr;
        }
    }
    return true;
}

void destroyBuffer(Context& context, Buffer& buffer) {
    if (!context.valid()) return;
    if (buffer.mapped != nullptr && buffer.allocation.memory != VK_NULL_HANDLE) {
        vkUnmapMemory(context.device(), buffer.allocation.memory);
        buffer.mapped = nullptr;
    }
    if (buffer.buffer != VK_NULL_HANDLE) {
        vkDestroyBuffer(context.device(), buffer.buffer, nullptr);
        buffer.buffer = VK_NULL_HANDLE;
    }
    if (buffer.allocation.memory != VK_NULL_HANDLE) {
        context.allocator().free(buffer.allocation);
        buffer.allocation = Allocator::Allocation{};
    }
}

VkSampler createLinearSampler(Context& context, bool clampToEdge) {
    VkSamplerCreateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO;
    info.magFilter = VK_FILTER_LINEAR;
    info.minFilter = VK_FILTER_LINEAR;
    info.mipmapMode = VK_SAMPLER_MIPMAP_MODE_NEAREST;
    info.addressModeU = clampToEdge ? VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE
                                    : VK_SAMPLER_ADDRESS_MODE_REPEAT;
    info.addressModeV = info.addressModeU;
    info.addressModeW = info.addressModeU;
    info.maxAnisotropy = 1.0f;
    info.compareEnable = VK_FALSE;
    info.borderColor = VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK;
    VkSampler sampler = VK_NULL_HANDLE;
    if (vkCreateSampler(context.device(), &info, nullptr, &sampler) != VK_SUCCESS) {
        return VK_NULL_HANDLE;
    }
    return sampler;
}

VkSampler createNearestSampler(Context& context) {
    VkSamplerCreateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO;
    info.magFilter = VK_FILTER_NEAREST;
    info.minFilter = VK_FILTER_NEAREST;
    info.mipmapMode = VK_SAMPLER_MIPMAP_MODE_NEAREST;
    info.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    info.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    info.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    VkSampler sampler = VK_NULL_HANDLE;
    if (vkCreateSampler(context.device(), &info, nullptr, &sampler) != VK_SUCCESS) {
        return VK_NULL_HANDLE;
    }
    return sampler;
}

void transitionImage(VkCommandBuffer cmd, Image& image, VkImageLayout newLayout,
                     VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage) {
    if (image.image == VK_NULL_HANDLE || image.layout == newLayout) return;

    VkImageMemoryBarrier barrier{};
    barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
    barrier.oldLayout = image.layout;
    barrier.newLayout = newLayout;
    barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barrier.image = image.image;
    barrier.subresourceRange.aspectMask =
        isDepthFormat(image.format) ? VK_IMAGE_ASPECT_DEPTH_BIT : VK_IMAGE_ASPECT_COLOR_BIT;
    barrier.subresourceRange.levelCount = 1;
    barrier.subresourceRange.layerCount = 1;
    barrier.srcAccessMask = accessMaskFor(image.layout, image.usage);
    barrier.dstAccessMask = accessMaskFor(newLayout, image.usage);

    vkCmdPipelineBarrier(cmd, srcStage, dstStage, 0, 0, nullptr, 0, nullptr, 1, &barrier);
    image.layout = newLayout;
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------
bool uploadToImage(Context& context, VkCommandBuffer cmd, Image& image, const void* pixels,
                   VkDeviceSize bytes, std::string* error) {
    Buffer staging;
    if (!createBuffer(context, bytes, VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
                      VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                      staging, error)) {
        return false;
    }
    if (staging.mapped == nullptr) {
        destroyBuffer(context, staging);
        if (error != nullptr) *error = "staging buffer is not mappable";
        return false;
    }
    std::memcpy(staging.mapped, pixels, static_cast<size_t>(bytes));

    transitionImage(cmd, image, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
                    VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT);

    VkBufferImageCopy region{};
    region.bufferOffset = 0;
    region.bufferRowLength = 0;
    region.bufferImageHeight = 0;
    region.imageSubresource.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
    region.imageSubresource.layerCount = 1;
    region.imageExtent = {image.width, image.height, 1};
    vkCmdCopyBufferToImage(cmd, staging.buffer, image.image, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1,
                           &region);

    transitionImage(cmd, image, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, VK_PIPELINE_STAGE_TRANSFER_BIT,
                    VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
    destroyBuffer(context, staging);
    return true;
}

bool downloadFromImage(Context& context, VkCommandBuffer cmd, Image& image, void* outPixels,
                       VkDeviceSize bytes, std::string* error) {
    Buffer staging;
    if (!createBuffer(context, bytes, VK_BUFFER_USAGE_TRANSFER_DST_BIT,
                      VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                      staging, error)) {
        return false;
    }

    const VkImageLayout previous = image.layout;
    transitionImage(cmd, image, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
                    VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT);

    VkBufferImageCopy region{};
    region.imageSubresource.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
    region.imageSubresource.layerCount = 1;
    region.imageExtent = {image.width, image.height, 1};
    vkCmdCopyImageToBuffer(cmd, image.image, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, staging.buffer, 1,
                           &region);

    transitionImage(cmd, image, previous == VK_IMAGE_LAYOUT_UNDEFINED
                                    ? VK_IMAGE_LAYOUT_GENERAL
                                    : previous,
                    VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);

    // The caller must have submitted (and waited for) the command buffer, so a
    // plain memcpy out of the coherent staging buffer is correct here.
    if (staging.mapped == nullptr) {
        destroyBuffer(context, staging);
        return false;
    }
    std::memcpy(outPixels, staging.mapped, static_cast<size_t>(bytes));
    destroyBuffer(context, staging);
    return true;
}

bool uploadToBuffer(Context& context, Buffer& buffer, const void* data, VkDeviceSize bytes) {
    if (!buffer.valid() || buffer.mapped == nullptr) return false;
    std::memcpy(buffer.mapped, data, static_cast<size_t>(std::min(bytes, buffer.size)));
    VkMappedMemoryRange range{};
    range.sType = VK_STRUCTURE_TYPE_MAPPED_MEMORY_RANGE;
    range.memory = buffer.allocation.memory;
    range.offset = buffer.allocation.offset;
    range.size = VK_WHOLE_SIZE;
    vkFlushMappedMemoryRanges(context.device(), 1, &range);
    return true;
}

bool downloadFromBuffer(Context& context, VkCommandBuffer cmd, Buffer& buffer, void* out,
                        VkDeviceSize bytes) {
    if (!buffer.valid()) return false;
    if (buffer.mapped != nullptr) {
        VkMappedMemoryRange range{};
        range.sType = VK_STRUCTURE_TYPE_MAPPED_MEMORY_RANGE;
        range.memory = buffer.allocation.memory;
        range.offset = buffer.allocation.offset;
        range.size = VK_WHOLE_SIZE;
        vkInvalidateMappedMemoryRanges(context.device(), 1, &range);
        std::memcpy(out, buffer.mapped, static_cast<size_t>(std::min(bytes, buffer.size)));
        return true;
    }
    (void)cmd;
    return false;
}

// ---------------------------------------------------------------------------
// Compute pipelines
// ---------------------------------------------------------------------------
bool createComputePipeline(Context& context, const std::vector<DescriptorBinding>& bindings,
                           uint32_t pushConstantBytes, const uint32_t* spirvWords,
                           size_t spirvWordCount, const char* debugName, ComputePipeline& out,
                           std::string* error) {
    out = ComputePipeline{};
    out.name = debugName == nullptr ? "" : debugName;
    out.pushConstantBytes = pushConstantBytes;

    if (!context.valid() || spirvWords == nullptr || spirvWordCount == 0) {
        if (error != nullptr) *error = "no SPIR-V provided for pipeline";
        return false;
    }

    std::vector<VkDescriptorSetLayoutBinding> layoutBindings;
    layoutBindings.reserve(bindings.size());
    for (const auto& binding : bindings) {
        VkDescriptorSetLayoutBinding layoutBinding{};
        layoutBinding.binding = binding.binding;
        layoutBinding.descriptorType = binding.type;
        layoutBinding.descriptorCount = binding.count;
        layoutBinding.stageFlags = binding.stages;
        layoutBindings.push_back(layoutBinding);
    }

    VkDescriptorSetLayoutCreateInfo setLayoutInfo{};
    setLayoutInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    setLayoutInfo.bindingCount = static_cast<uint32_t>(layoutBindings.size());
    setLayoutInfo.pBindings = layoutBindings.empty() ? nullptr : layoutBindings.data();
    VkResult result = vkCreateDescriptorSetLayout(context.device(), &setLayoutInfo, nullptr,
                                                 &out.descriptorSetLayout);
    if (result != VK_SUCCESS) {
        if (error != nullptr) {
            *error = std::string("vkCreateDescriptorSetLayout failed: ") + resultToString(result);
        }
        return false;
    }

    VkPushConstantRange pushRange{};
    pushRange.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    pushRange.offset = 0;
    pushRange.size = pushConstantBytes;

    VkPipelineLayoutCreateInfo layoutInfo{};
    layoutInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    layoutInfo.setLayoutCount = 1;
    layoutInfo.pSetLayouts = &out.descriptorSetLayout;
    layoutInfo.pushConstantRangeCount = (pushConstantBytes > 0) ? 1u : 0u;
    layoutInfo.pPushConstantRanges = (pushConstantBytes > 0) ? &pushRange : nullptr;
    result = vkCreatePipelineLayout(context.device(), &layoutInfo, nullptr, &out.layout);
    if (result != VK_SUCCESS) {
        if (error != nullptr) *error = std::string("vkCreatePipelineLayout failed: ") + resultToString(result);
        destroyComputePipeline(context, out);
        return false;
    }

    VkShaderModuleCreateInfo moduleInfo{};
    moduleInfo.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    moduleInfo.codeSize = spirvWordCount * sizeof(uint32_t);
    moduleInfo.pCode = spirvWords;
    VkShaderModule module = VK_NULL_HANDLE;
    result = vkCreateShaderModule(context.device(), &moduleInfo, nullptr, &module);
    if (result != VK_SUCCESS) {
        if (error != nullptr) *error = std::string("vkCreateShaderModule failed: ") + resultToString(result);
        destroyComputePipeline(context, out);
        return false;
    }

    VkPipelineShaderStageCreateInfo stageInfo{};
    stageInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stageInfo.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    stageInfo.module = module;
    stageInfo.pName = "main";

    VkComputePipelineCreateInfo pipelineInfo{};
    pipelineInfo.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
    pipelineInfo.stage = stageInfo;
    pipelineInfo.layout = out.layout;

    result = vkCreateComputePipelines(context.device(), VK_NULL_HANDLE, 1, &pipelineInfo, nullptr,
                                      &out.pipeline);
    vkDestroyShaderModule(context.device(), module, nullptr);
    if (result != VK_SUCCESS) {
        if (error != nullptr) {
            *error = std::string("vkCreateComputePipelines failed for ") + out.name + ": " +
                     resultToString(result);
        }
        destroyComputePipeline(context, out);
        return false;
    }
    return true;
}

void destroyComputePipeline(Context& context, ComputePipeline& pipeline) {
    if (!context.valid()) return;
    if (pipeline.pipeline != VK_NULL_HANDLE) {
        vkDestroyPipeline(context.device(), pipeline.pipeline, nullptr);
        pipeline.pipeline = VK_NULL_HANDLE;
    }
    if (pipeline.layout != VK_NULL_HANDLE) {
        vkDestroyPipelineLayout(context.device(), pipeline.layout, nullptr);
        pipeline.layout = VK_NULL_HANDLE;
    }
    if (pipeline.descriptorSetLayout != VK_NULL_HANDLE) {
        vkDestroyDescriptorSetLayout(context.device(), pipeline.descriptorSetLayout, nullptr);
        pipeline.descriptorSetLayout = VK_NULL_HANDLE;
    }
}

VkDescriptorPool createDescriptorPool(Context& context,
                                      const std::vector<DescriptorBinding>& bindings,
                                      uint32_t setCount) {
    std::vector<VkDescriptorPoolSize> sizes;
    for (const auto& binding : bindings) {
        VkDescriptorPoolSize size{};
        size.type = binding.type;
        size.descriptorCount = binding.count * setCount;
        bool merged = false;
        for (auto& existing : sizes) {
            if (existing.type == size.type) {
                existing.descriptorCount += size.descriptorCount;
                merged = true;
                break;
            }
        }
        if (!merged) sizes.push_back(size);
    }

    VkDescriptorPoolCreateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    info.flags = VK_DESCRIPTOR_POOL_CREATE_FREE_DESCRIPTOR_SET_BIT;
    info.maxSets = setCount;
    info.poolSizeCount = static_cast<uint32_t>(sizes.size());
    info.pPoolSizes = sizes.empty() ? nullptr : sizes.data();

    VkDescriptorPool pool = VK_NULL_HANDLE;
    if (vkCreateDescriptorPool(context.device(), &info, nullptr, &pool) != VK_SUCCESS) {
        return VK_NULL_HANDLE;
    }
    return pool;
}

VkDescriptorSet allocateDescriptorSet(Context& context, VkDescriptorPool pool,
                                     VkDescriptorSetLayout layout) {
    VkDescriptorSetAllocateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    info.descriptorPool = pool;
    info.descriptorSetCount = 1;
    info.pSetLayouts = &layout;
    VkDescriptorSet set = VK_NULL_HANDLE;
    if (vkAllocateDescriptorSets(context.device(), &info, &set) != VK_SUCCESS) {
        return VK_NULL_HANDLE;
    }
    return set;
}

void writeStorageImage(VkDevice device, VkDescriptorSet set, uint32_t binding, VkImageView view) {
    VkDescriptorImageInfo imageInfo{};
    imageInfo.imageView = view;
    imageInfo.imageLayout = VK_IMAGE_LAYOUT_GENERAL;

    VkWriteDescriptorSet write{};
    write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    write.dstSet = set;
    write.dstBinding = binding;
    write.descriptorCount = 1;
    write.descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE;
    write.pImageInfo = &imageInfo;
    vkUpdateDescriptorSets(device, 1, &write, 0, nullptr);
}

void writeCombinedSampler(VkDevice device, VkDescriptorSet set, uint32_t binding, VkImageView view,
                          VkSampler sampler) {
    VkDescriptorImageInfo imageInfo{};
    imageInfo.imageView = view;
    imageInfo.sampler = sampler;
    imageInfo.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkWriteDescriptorSet write{};
    write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    write.dstSet = set;
    write.dstBinding = binding;
    write.descriptorCount = 1;
    write.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    write.pImageInfo = &imageInfo;
    vkUpdateDescriptorSets(device, 1, &write, 0, nullptr);
}

void writeStorageBuffer(VkDevice device, VkDescriptorSet set, uint32_t binding, VkBuffer buffer,
                        VkDeviceSize size) {
    VkDescriptorBufferInfo bufferInfo{};
    bufferInfo.buffer = buffer;
    bufferInfo.offset = 0;
    bufferInfo.range = size;

    VkWriteDescriptorSet write{};
    write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    write.dstSet = set;
    write.dstBinding = binding;
    write.descriptorCount = 1;
    write.descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    write.pBufferInfo = &bufferInfo;
    vkUpdateDescriptorSets(device, 1, &write, 0, nullptr);
}

void recordDispatch(VkCommandBuffer cmd, const ComputePipeline& pipeline, VkDescriptorSet set,
                    uint32_t groupCountX, uint32_t groupCountY, uint32_t groupCountZ,
                    const void* pushData, uint32_t pushSize) {
    if (!pipeline.valid() || cmd == VK_NULL_HANDLE) return;
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline.pipeline);
    if (set != VK_NULL_HANDLE) {
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline.layout, 0, 1, &set, 0,
                                nullptr);
    }
    if (pushData != nullptr && pushSize > 0) {
        vkCmdPushConstants(cmd, pipeline.layout, VK_SHADER_STAGE_COMPUTE_BIT, 0, pushSize, pushData);
    }
    vkCmdDispatch(cmd, std::max(1u, groupCountX), std::max(1u, groupCountY), std::max(1u, groupCountZ));
}

void computeGroupCount(uint32_t width, uint32_t height, uint32_t groupSizeX, uint32_t groupSizeY,
                       uint32_t& groupsX, uint32_t& groupsY) {
    const uint32_t gx = std::max(1u, groupSizeX);
    const uint32_t gy = std::max(1u, groupSizeY);
    groupsX = std::min((width + gx - 1) / gx, 65535u);
    groupsY = std::min((height + gy - 1) / gy, 65535u);
}

}  // namespace vk
}  // namespace v4k

#endif  // V4K_ENABLE_VULKAN
