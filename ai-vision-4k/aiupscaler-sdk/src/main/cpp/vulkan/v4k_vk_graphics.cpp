#include "v4k_vk_graphics.h"

#if defined(V4K_ENABLE_VULKAN)

#include "v4k_shader_registry.h"

#include <cstring>

namespace v4k {
namespace vk {
namespace {

VkShaderModule createShaderModule(Context& context, const uint32_t* words, size_t wordCount, std::string* error) {
    if (words == nullptr || wordCount == 0) return VK_NULL_HANDLE;
    VkShaderModuleCreateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    info.codeSize = wordCount * sizeof(uint32_t);
    info.pCode = words;
    VkShaderModule module = VK_NULL_HANDLE;
    const VkResult result = vkCreateShaderModule(context.device(), &info, nullptr, &module);
    if (result != VK_SUCCESS) {
        if (error != nullptr) {
            *error = std::string("vkCreateShaderModule failed: ") + resultToString(result);
        }
        return VK_NULL_HANDLE;
    }
    return module;
}

}  // namespace

bool createRenderPassWithDepth(Context& context, const ColorAttachment& color, VkFormat depthFormat,
                              bool clearDepth, VkRenderPass& out, std::string* error) {
    out = VK_NULL_HANDLE;
    std::vector<VkAttachmentDescription> attachments;
    std::vector<VkAttachmentReference> colorRefs;
    VkAttachmentReference depthRef{};
    bool hasDepth = depthFormat != VK_FORMAT_UNDEFINED;

    VkAttachmentDescription colorAttachment{};
    colorAttachment.format = color.format;
    colorAttachment.samples = VK_SAMPLE_COUNT_1_BIT;
    colorAttachment.loadOp = color.loadOp;
    colorAttachment.storeOp = color.storeOp;
    colorAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    colorAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    colorAttachment.initialLayout = color.initialLayout;
    colorAttachment.finalLayout = color.finalLayout;
    attachments.push_back(colorAttachment);

    VkAttachmentReference colorRef{};
    colorRef.attachment = 0;
    colorRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
    colorRefs.push_back(colorRef);

    if (hasDepth) {
        VkAttachmentDescription depthAttachment{};
        depthAttachment.format = depthFormat;
        depthAttachment.samples = VK_SAMPLE_COUNT_1_BIT;
        depthAttachment.loadOp = clearDepth ? VK_ATTACHMENT_LOAD_OP_CLEAR : VK_ATTACHMENT_LOAD_OP_LOAD;
        // No store: nothing samples the scene depth afterwards, and dropping it
        // saves the write-back on tile-based mobile GPUs.
        depthAttachment.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        depthAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        depthAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        depthAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        depthAttachment.finalLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;
        attachments.push_back(depthAttachment);
        depthRef.attachment = 1;
        depthRef.layout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;
    }

    VkSubpassDescription subpass{};
    subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
    subpass.colorAttachmentCount = static_cast<uint32_t>(colorRefs.size());
    subpass.pColorAttachments = colorRefs.data();
    subpass.pDepthStencilAttachment = hasDepth ? &depthRef : nullptr;

    VkSubpassDependency dependency{};
    dependency.srcSubpass = VK_SUBPASS_EXTERNAL;
    dependency.dstSubpass = 0;
    dependency.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT |
                             (hasDepth ? VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT : 0);
    dependency.srcAccessMask = 0;
    dependency.dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT |
                             (hasDepth ? VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT : 0);
    dependency.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT |
                              (hasDepth ? VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT : 0);

    VkRenderPassCreateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
    info.attachmentCount = static_cast<uint32_t>(attachments.size());
    info.pAttachments = attachments.data();
    info.subpassCount = 1;
    info.pSubpasses = &subpass;
    info.dependencyCount = 1;
    info.pDependencies = &dependency;

    const VkResult result = vkCreateRenderPass(context.device(), &info, nullptr, &out);
    if (result != VK_SUCCESS) {
        if (error != nullptr) *error = std::string("vkCreateRenderPass failed: ") + resultToString(result);
        out = VK_NULL_HANDLE;
        return false;
    }
    return true;
}

bool createGraphicsPipeline(Context& context, const GraphicsPipelineDesc& desc, GraphicsPipeline& out,
                            std::string* error) {
    out = GraphicsPipeline{};
    out.name = desc.debugName == nullptr ? "" : desc.debugName;
    out.pushConstantBytes = desc.pushConstantBytes;

    if (!context.valid() || desc.renderPass == VK_NULL_HANDLE) {
        if (error != nullptr) *error = "a graphics pipeline needs a context and a render pass";
        return false;
    }

    // ---- descriptor set layouts ---- //
    std::vector<VkDescriptorSetLayoutBinding> allBindings;
    std::vector<uint32_t> setBindingCounts;
    for (const auto& setBindings : desc.descriptorSets) {
        setBindingCounts.push_back(static_cast<uint32_t>(setBindings.size()));
        for (const DescriptorBinding& binding : setBindings) {
            VkDescriptorSetLayoutBinding layoutBinding{};
            layoutBinding.binding = binding.binding;
            layoutBinding.descriptorType = binding.type;
            layoutBinding.descriptorCount = binding.count;
            layoutBinding.stageFlags = binding.stages;
            allBindings.push_back(layoutBinding);
        }
    }
    for (size_t setIndex = 0; setIndex < desc.descriptorSets.size(); ++setIndex) {
        VkDescriptorSetLayoutCreateInfo setInfo{};
        setInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        // The bindings are contiguous in allBindings, in set order.
        uint32_t offset = 0;
        for (size_t i = 0; i < setIndex; ++i) offset += setBindingCounts[i];
        setInfo.bindingCount = setBindingCounts[setIndex];
        setInfo.pBindings = setInfo.bindingCount == 0 ? nullptr : &allBindings[offset];
        VkDescriptorSetLayout setLayout = VK_NULL_HANDLE;
        const VkResult result =
            vkCreateDescriptorSetLayout(context.device(), &setInfo, nullptr, &setLayout);
        if (result != VK_SUCCESS) {
            if (error != nullptr) {
                *error = std::string("vkCreateDescriptorSetLayout failed: ") + resultToString(result);
            }
            destroyGraphicsPipeline(context, out);
            return false;
        }
        out.setLayouts.push_back(setLayout);
    }

    // ---- pipeline layout ---- //
    VkPushConstantRange pushRange{};
    pushRange.stageFlags = desc.pushConstantStages;
    pushRange.offset = 0;
    pushRange.size = desc.pushConstantBytes;

    VkPipelineLayoutCreateInfo layoutInfo{};
    layoutInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    layoutInfo.setLayoutCount = static_cast<uint32_t>(out.setLayouts.size());
    layoutInfo.pSetLayouts = out.setLayouts.empty() ? nullptr : out.setLayouts.data();
    layoutInfo.pushConstantRangeCount = desc.pushConstantBytes > 0 ? 1u : 0u;
    layoutInfo.pPushConstantRanges = desc.pushConstantBytes > 0 ? &pushRange : nullptr;
    VkResult result = vkCreatePipelineLayout(context.device(), &layoutInfo, nullptr, &out.layout);
    if (result != VK_SUCCESS) {
        if (error != nullptr) *error = std::string("vkCreatePipelineLayout failed: ") + resultToString(result);
        destroyGraphicsPipeline(context, out);
        return false;
    }

    // ---- shader stages ---- //
    VkShaderModule vertexModule = createShaderModule(context, desc.vertexSpirv, desc.vertexWordCount, error);
    if (vertexModule == VK_NULL_HANDLE) {
        destroyGraphicsPipeline(context, out);
        return false;
    }
    VkShaderModule fragmentModule = VK_NULL_HANDLE;
    if (desc.fragmentSpirv != nullptr && desc.fragmentWordCount > 0) {
        fragmentModule = createShaderModule(context, desc.fragmentSpirv, desc.fragmentWordCount, error);
        if (fragmentModule == VK_NULL_HANDLE) {
            vkDestroyShaderModule(context.device(), vertexModule, nullptr);
            destroyGraphicsPipeline(context, out);
            return false;
        }
    }

    std::vector<VkPipelineShaderStageCreateInfo> stages;
    VkPipelineShaderStageCreateInfo vertexStage{};
    vertexStage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    vertexStage.stage = VK_SHADER_STAGE_VERTEX_BIT;
    vertexStage.module = vertexModule;
    vertexStage.pName = "main";
    stages.push_back(vertexStage);
    VkPipelineShaderStageCreateInfo fragmentStage{};
    if (fragmentModule != VK_NULL_HANDLE) {
        fragmentStage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        fragmentStage.stage = VK_SHADER_STAGE_FRAGMENT_BIT;
        fragmentStage.module = fragmentModule;
        fragmentStage.pName = "main";
        stages.push_back(fragmentStage);
    }

    // ---- vertex input ---- //
    std::vector<VkVertexInputBindingDescription> bindingDescriptions;
    for (const VertexBinding& binding : desc.vertexBindings) {
        VkVertexInputBindingDescription description{};
        description.binding = binding.binding;
        description.stride = binding.stride;
        description.inputRate = binding.perInstance ? VK_VERTEX_INPUT_RATE_INSTANCE
                                                    : VK_VERTEX_INPUT_RATE_VERTEX;
        bindingDescriptions.push_back(description);
    }
    std::vector<VkVertexInputAttributeDescription> attributeDescriptions;
    for (const VertexAttribute& attribute : desc.vertexAttributes) {
        VkVertexInputAttributeDescription description{};
        description.location = attribute.location;
        description.binding = attribute.binding;
        description.format = attribute.format;
        description.offset = attribute.offset;
        attributeDescriptions.push_back(description);
    }

    VkPipelineVertexInputStateCreateInfo vertexInput{};
    vertexInput.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
    vertexInput.vertexBindingDescriptionCount = static_cast<uint32_t>(bindingDescriptions.size());
    vertexInput.pVertexBindingDescriptions = bindingDescriptions.empty() ? nullptr : bindingDescriptions.data();
    vertexInput.vertexAttributeDescriptionCount = static_cast<uint32_t>(attributeDescriptions.size());
    vertexInput.pVertexAttributeDescriptions =
        attributeDescriptions.empty() ? nullptr : attributeDescriptions.data();

    // ---- fixed function state ---- //
    VkPipelineInputAssemblyStateCreateInfo inputAssembly{};
    inputAssembly.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
    inputAssembly.topology = desc.topology;
    inputAssembly.primitiveRestartEnable = VK_FALSE;

    // The viewport is dynamic so a resize does not rebuild the pipeline; the
    // demo renders into offscreen targets of two different sizes through the
    // same pipeline (render resolution and output resolution).
    VkPipelineViewportStateCreateInfo viewportState{};
    viewportState.sType = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO;
    viewportState.viewportCount = 1;
    viewportState.scissorCount = 1;

    VkPipelineRasterizationStateCreateInfo rasterization{};
    rasterization.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
    rasterization.depthClampEnable = VK_FALSE;
    rasterization.rasterizerDiscardEnable = VK_FALSE;
    rasterization.polygonMode = VK_POLYGON_MODE_FILL;
    rasterization.cullMode = desc.cullMode;
    rasterization.frontFace = desc.frontFace;
    rasterization.depthBiasEnable = desc.depthBias ? VK_TRUE : VK_FALSE;
    rasterization.depthBiasConstantFactor = desc.depthBiasConstant;
    rasterization.depthBiasSlopeFactor = desc.depthBiasSlope;
    rasterization.lineWidth = 1.0f;

    VkPipelineMultisampleStateCreateInfo multisample{};
    multisample.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
    multisample.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;
    multisample.sampleShadingEnable = VK_FALSE;

    VkPipelineDepthStencilStateCreateInfo depthStencil{};
    depthStencil.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
    depthStencil.depthTestEnable = desc.depthTest ? VK_TRUE : VK_FALSE;
    depthStencil.depthWriteEnable = desc.depthWrite ? VK_TRUE : VK_FALSE;
    depthStencil.depthCompareOp = VK_COMPARE_OP_LESS_OR_EQUAL;
    depthStencil.depthBoundsTestEnable = VK_FALSE;
    depthStencil.stencilTestEnable = VK_FALSE;

    VkPipelineColorBlendAttachmentState blendAttachment{};
    blendAttachment.blendEnable = desc.blend ? VK_TRUE : VK_FALSE;
    blendAttachment.srcColorBlendFactor = VK_BLEND_FACTOR_SRC_ALPHA;
    blendAttachment.dstColorBlendFactor = VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
    blendAttachment.colorBlendOp = VK_BLEND_OP_ADD;
    blendAttachment.srcAlphaBlendFactor = VK_BLEND_FACTOR_ONE;
    blendAttachment.dstAlphaBlendFactor = VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
    blendAttachment.alphaBlendOp = VK_BLEND_OP_ADD;
    blendAttachment.colorWriteMask = desc.writeColor
                                         ? (VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT |
                                            VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT)
                                         : 0;

    VkPipelineColorBlendStateCreateInfo colorBlend{};
    colorBlend.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
    colorBlend.logicOpEnable = VK_FALSE;
    colorBlend.attachmentCount = 1;
    colorBlend.pAttachments = &blendAttachment;

    const VkDynamicState dynamicStates[2] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
    VkPipelineDynamicStateCreateInfo dynamicState{};
    dynamicState.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
    dynamicState.dynamicStateCount = 2;
    dynamicState.pDynamicStates = dynamicStates;

    VkGraphicsPipelineCreateInfo pipelineInfo{};
    pipelineInfo.sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
    pipelineInfo.stageCount = static_cast<uint32_t>(stages.size());
    pipelineInfo.pStages = stages.data();
    pipelineInfo.pVertexInputState = &vertexInput;
    pipelineInfo.pInputAssemblyState = &inputAssembly;
    pipelineInfo.pViewportState = &viewportState;
    pipelineInfo.pRasterizationState = &rasterization;
    pipelineInfo.pMultisampleState = &multisample;
    pipelineInfo.pDepthStencilState = desc.hasDepthAttachment ? &depthStencil : nullptr;
    pipelineInfo.pColorBlendState = &colorBlend;
    pipelineInfo.pDynamicState = &dynamicState;
    pipelineInfo.layout = out.layout;
    pipelineInfo.renderPass = desc.renderPass;
    pipelineInfo.subpass = 0;

    result = vkCreateGraphicsPipelines(context.device(), VK_NULL_HANDLE, 1, &pipelineInfo, nullptr,
                                       &out.pipeline);
    vkDestroyShaderModule(context.device(), vertexModule, nullptr);
    if (fragmentModule != VK_NULL_HANDLE) {
        vkDestroyShaderModule(context.device(), fragmentModule, nullptr);
    }
    if (result != VK_SUCCESS) {
        if (error != nullptr) {
            *error = std::string("vkCreateGraphicsPipelines( ") + out.name + ") failed: " +
                     resultToString(result);
        }
        destroyGraphicsPipeline(context, out);
        return false;
    }
    return true;
}

void destroyGraphicsPipeline(Context& context, GraphicsPipeline& pipeline) {
    if (context.device() == VK_NULL_HANDLE) return;
    if (pipeline.pipeline != VK_NULL_HANDLE) {
        vkDestroyPipeline(context.device(), pipeline.pipeline, nullptr);
        pipeline.pipeline = VK_NULL_HANDLE;
    }
    if (pipeline.layout != VK_NULL_HANDLE) {
        vkDestroyPipelineLayout(context.device(), pipeline.layout, nullptr);
        pipeline.layout = VK_NULL_HANDLE;
    }
    for (VkDescriptorSetLayout setLayout : pipeline.setLayouts) {
        if (setLayout != VK_NULL_HANDLE) {
            vkDestroyDescriptorSetLayout(context.device(), setLayout, nullptr);
        }
    }
    pipeline.setLayouts.clear();
}

VkFramebuffer createFramebuffer(Context& context, VkRenderPass renderPass,
                                const std::vector<VkImageView>& views, uint32_t width, uint32_t height) {
    if (renderPass == VK_NULL_HANDLE || views.empty()) return VK_NULL_HANDLE;
    VkFramebufferCreateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
    info.renderPass = renderPass;
    info.attachmentCount = static_cast<uint32_t>(views.size());
    info.pAttachments = views.data();
    info.width = width;
    info.height = height;
    info.layers = 1;
    VkFramebuffer framebuffer = VK_NULL_HANDLE;
    if (vkCreateFramebuffer(context.device(), &info, nullptr, &framebuffer) != VK_SUCCESS) {
        return VK_NULL_HANDLE;
    }
    return framebuffer;
}

void destroyFramebuffer(Context& context, VkFramebuffer& framebuffer) {
    if (framebuffer != VK_NULL_HANDLE && context.device() != VK_NULL_HANDLE) {
        vkDestroyFramebuffer(context.device(), framebuffer, nullptr);
    }
    framebuffer = VK_NULL_HANDLE;
}

void writeUniformBuffer(VkDevice device, VkDescriptorSet set, uint32_t binding, VkBuffer buffer,
                        VkDeviceSize size) {
    if (device == VK_NULL_HANDLE || set == VK_NULL_HANDLE || buffer == VK_NULL_HANDLE) return;
    VkDescriptorBufferInfo info{};
    info.buffer = buffer;
    info.offset = 0;
    info.range = size;

    VkWriteDescriptorSet write{};
    write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    write.dstSet = set;
    write.dstBinding = binding;
    write.descriptorCount = 1;
    write.descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
    write.pBufferInfo = &info;
    vkUpdateDescriptorSets(device, 1, &write, 0, nullptr);
}

void beginRenderPass(VkCommandBuffer cmd, VkRenderPass renderPass, VkFramebuffer framebuffer, uint32_t width,
                     uint32_t height, const float clearColor[4], float clearDepth) {
    VkRenderPassBeginInfo info{};
    info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
    info.renderPass = renderPass;
    info.framebuffer = framebuffer;
    info.renderArea.offset = {0, 0};
    info.renderArea.extent = {width, height};
    VkClearValue clearValues[2]{};
    if (clearColor != nullptr) {
        clearValues[0].color.float32[0] = clearColor[0];
        clearValues[0].color.float32[1] = clearColor[1];
        clearValues[0].color.float32[2] = clearColor[2];
        clearValues[0].color.float32[3] = clearColor[3];
    }
    clearValues[1].depthStencil.depth = clearDepth;
    clearValues[1].depthStencil.stencil = 0;
    info.clearValueCount = clearColor != nullptr ? 2u : 1u;
    info.pClearValues = clearColor != nullptr ? clearValues : &clearValues[1];
    vkCmdBeginRenderPass(cmd, &info, VK_SUBPASS_CONTENTS_INLINE);
}

void recordMemoryBarrier(VkCommandBuffer cmd, VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage,
                         VkAccessFlags srcAccess, VkAccessFlags dstAccess) {
    VkMemoryBarrier barrier{};
    barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    barrier.srcAccessMask = srcAccess;
    barrier.dstAccessMask = dstAccess;
    vkCmdPipelineBarrier(cmd, srcStage, dstStage, 0, 1, &barrier, 0, nullptr, 0, nullptr);
}

void recordStorageToVertexBarrier(VkCommandBuffer cmd) {
    // particle_sim.comp writes the particle storage buffer and particle.vert
    // reads the very same buffer from the vertex stage, so the barrier runs
    // compute -> vertex shader with shader reads (not vertex attribute reads:
    // the particles arrive through a storage buffer, not a vertex buffer).
    recordMemoryBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                        VK_PIPELINE_STAGE_VERTEX_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT,
                        VK_ACCESS_SHADER_READ_BIT);
}

void setViewport(VkCommandBuffer cmd, uint32_t width, uint32_t height, bool flipY) {
    VkViewport viewport{};
    viewport.x = 0.0f;
    viewport.y = flipY ? static_cast<float>(height) : 0.0f;
    viewport.width = static_cast<float>(width);
    // A negative height flips the Y axis so ordinary right-handed world space
    // (matrices built by graphics/v4k_math.h) lands the right way up on Vulkan.
    viewport.height = flipY ? -static_cast<float>(height) : static_cast<float>(height);
    viewport.minDepth = 0.0f;
    viewport.maxDepth = 1.0f;
    vkCmdSetViewport(cmd, 0, 1, &viewport);

    VkRect2D scissor{};
    scissor.offset = {0, 0};
    scissor.extent = {width, height};
    vkCmdSetScissor(cmd, 0, 1, &scissor);
}

}  // namespace vk
}  // namespace v4k

#endif  // V4K_ENABLE_VULKAN
