// Graphics (rasterisation) pipelines, render passes and barriers.
//
// The engine's own helper set (v4k_vk_resources.h) covers compute only, because
// the upscaler is compute. The demo scene needs the other half of the API:
// render passes with a depth attachment, vertex/instance input state, blending,
// cull and depth-bias state, and the memory barrier a compute-then-draw pair
// requires. All of it is ordinary Vulkan, kept in one place so the demo does not
// grow its own copy of it.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "v4k_vk.h"

#if defined(V4K_ENABLE_VULKAN)

namespace v4k {
namespace vk {

// ---------------------------------------------------------------------------
// Render passes
// ---------------------------------------------------------------------------

struct ColorAttachment {
    VkFormat format = VK_FORMAT_UNDEFINED;
    VkImageLayout initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    VkImageLayout finalLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
    VkAttachmentLoadOp loadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    VkAttachmentStoreOp storeOp = VK_ATTACHMENT_STORE_OP_STORE;
};

/** A single colour attachment, optionally with one depth attachment. */
bool createRenderPassWithDepth(Context& context, const ColorAttachment& color, VkFormat depthFormat,
                              bool clearDepth, VkRenderPass& out, std::string* error);

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

struct VertexBinding {
    uint32_t binding = 0;
    uint32_t stride = 0;
    bool perInstance = false;
};

struct VertexAttribute {
    uint32_t location = 0;
    uint32_t binding = 0;
    VkFormat format = VK_FORMAT_R32G32B32_SFLOAT;
    uint32_t offset = 0;
};

struct GraphicsPipelineDesc {
    VkRenderPass renderPass = VK_NULL_HANDLE;
    const uint32_t* vertexSpirv = nullptr;
    size_t vertexWordCount = 0;
    // Empty for a depth-only pass (depth writes with no fragment shader is a
    // legal graphics pipeline and is exactly what the shadow pass needs).
    const uint32_t* fragmentSpirv = nullptr;
    size_t fragmentWordCount = 0;

    std::vector<VertexBinding> vertexBindings;
    std::vector<VertexAttribute> vertexAttributes;
    // One entry per descriptor set; an empty inner vector means "no descriptors".
    std::vector<std::vector<DescriptorBinding>> descriptorSets;

    uint32_t pushConstantBytes = 0;
    VkShaderStageFlags pushConstantStages = VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT;

    VkPrimitiveTopology topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;
    VkCullModeFlags cullMode = VK_CULL_MODE_BACK_BIT;
    VkFrontFace frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
    // Whether the render pass this pipeline is built for has a depth attachment.
    // A pipeline whose render pass has one but whose state says otherwise is a
    // validation error, so it is explicit rather than inferred.
    bool hasDepthAttachment = true;
    bool depthTest = true;
    bool depthWrite = true;
    bool depthBias = false;
    float depthBiasConstant = 0.0f;
    float depthBiasSlope = 0.0f;
    bool blend = false;             // standard src-alpha over one-minus-src-alpha
    bool writeColor = true;         // false for a depth-only pass
    const char* debugName = nullptr;
};

struct GraphicsPipeline {
    VkPipeline pipeline = VK_NULL_HANDLE;
    VkPipelineLayout layout = VK_NULL_HANDLE;
    std::vector<VkDescriptorSetLayout> setLayouts;
    uint32_t pushConstantBytes = 0;
    std::string name;

    bool valid() const { return pipeline != VK_NULL_HANDLE; }
};

bool createGraphicsPipeline(Context& context, const GraphicsPipelineDesc& desc, GraphicsPipeline& out,
                            std::string* error);
void destroyGraphicsPipeline(Context& context, GraphicsPipeline& pipeline);

// ---------------------------------------------------------------------------
// Framebuffers and small helpers
// ---------------------------------------------------------------------------

VkFramebuffer createFramebuffer(Context& context, VkRenderPass renderPass, const std::vector<VkImageView>& views,
                                uint32_t width, uint32_t height);
void destroyFramebuffer(Context& context, VkFramebuffer& framebuffer);

/**
 * Writes a uniform buffer into a descriptor set.
 *
 * v4k_vk_resources.h covers storage images, combined samplers and storage
 * buffers (all the compute side needs); the demo's scene uniform block is the
 * first thing in the tree that wants a plain uniform buffer.
 */
void writeUniformBuffer(VkDevice device, VkDescriptorSet set, uint32_t binding, VkBuffer buffer,
                        VkDeviceSize size);

/** A full-screen triangle needs no vertex buffer; this is the first vertex index. */
constexpr uint32_t kFullscreenTriangleVertices = 3;

void beginRenderPass(VkCommandBuffer cmd, VkRenderPass renderPass, VkFramebuffer framebuffer,
                     uint32_t width, uint32_t height, const float clearColor[4], float clearDepth);

/**
 * A general memory barrier. Needed between a compute dispatch that writes a
 * buffer and a draw call that reads it as a vertex buffer -- which is the
 * particle path: particle_sim.comp simulates, particle.vert draws the result.
 */
void recordMemoryBarrier(VkCommandBuffer cmd, VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage,
                         VkAccessFlags srcAccess, VkAccessFlags dstAccess);

/** Barrier for the common "compute wrote a storage buffer, draw reads it" pair. */
void recordStorageToVertexBarrier(VkCommandBuffer cmd);

/** Sets the dynamic viewport and scissor for a command buffer. */
void setViewport(VkCommandBuffer cmd, uint32_t width, uint32_t height, bool flipY);

}  // namespace vk
}  // namespace v4k

#endif  // V4K_ENABLE_VULKAN
