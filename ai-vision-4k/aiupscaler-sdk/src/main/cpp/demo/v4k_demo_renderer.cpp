// Implementation of the demo renderer. See v4k_demo_renderer.h for the picture.
//
// Frame structure, in order:
//
//   1. shadow pass   -- the scene drawn from the sun into a depth map
//   2. particle sim  -- one compute dispatch over the particle storage buffer
//   3. scene pass    -- sky, terrain, buildings, props, moving objects,
//                       particles into an offscreen colour image
//   4. upscale       -- engine.processFrame() on the same device, AI modes only
//   5. present pass  -- the enhanced image (or the native render) to the
//                       swapchain, optionally split against the low-res render
//
// One frame is in flight: everything waits on a fence before the next frame
// starts. That keeps resource lifetime trivial to reason about, and the engine's
// own processFrame() already blocks for its result, so a deeper queue would buy
// nothing but a chance to hand the GPU work whose resources are being rebuilt.

#include "v4k_demo_renderer.h"

#include "../sdk/v4k_engine.h"
#include "../vulkan/v4k_shader_registry.h"
#include "../vulkan/v4k_vk_graphics.h"
#include "../vulkan/v4k_vk_push.h"

#if defined(V4K_ENABLE_VULKAN)

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

namespace v4k {
namespace demo {
namespace {

constexpr VkFormat kColorFormat = VK_FORMAT_R16G16B16A16_SFLOAT;
constexpr VkFormat kDepthFormat = VK_FORMAT_D32_SFLOAT;
constexpr uint32_t kSceneUniformBytes = 256;      // sizeof(SceneUniforms) rounded up
// How long to wait before trying to start the AI session again after a failed
// attempt: long enough not to burn GPU time on a graph this device cannot run,
// short enough that installing a model is noticed without touching anything.
constexpr double kSessionRetryMs = 2000.0;
constexpr uint32_t kParticleCapacity = 16384;

double nowMs() {
    using clock = std::chrono::steady_clock;
    return std::chrono::duration<double, std::milli>(clock::now().time_since_epoch()).count();
}

std::string quote(const std::string& text) {
    std::string out = "\"";
    for (char c : text) {
        if (c == '"' || c == '\\') out += '\\';
        out += c;
    }
    out += "\"";
    return out;
}

std::string numberOrNull(double value, int decimals) {
    if (value == kUnavailable) return "null";
    char buffer[64];
    std::snprintf(buffer, sizeof(buffer), "%.*f", decimals, value);
    return buffer;
}

/** Buffer helpers keep the create/upload/destroy trio in one place. */
bool makeVertexBuffer(vk::Context& context, const void* data, VkDeviceSize bytes, vk::Buffer& out,
                      std::string* error) {
    if (!vk::createBuffer(context, bytes, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT,
                          VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT, out,
                          error)) {
        return false;
    }
    return vk::uploadToBuffer(context, out, data, bytes);
}

bool makeIndexBuffer(vk::Context& context, const std::vector<uint32_t>& indices, vk::Buffer& out,
                     std::string* error) {
    const VkDeviceSize bytes = indices.size() * sizeof(uint32_t);
    if (!vk::createBuffer(context, bytes, VK_BUFFER_USAGE_INDEX_BUFFER_BIT,
                          VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT, out,
                          error)) {
        return false;
    }
    return vk::uploadToBuffer(context, out, indices.data(), bytes);
}

}  // namespace

struct DemoRenderer::Impl {
    // ---- configuration and scene state ----
    Engine* engine = nullptr;
    DemoConfig config{};
    SceneBuild scene{};
    SceneStats sceneStats{};
    SessionPlan plan{};
    bool initialised = false;
    bool sessionActive = false;
    double lastSessionAttemptMs = kUnavailable;
    std::string lastError;
    uint32_t surfaceWidth = 0;
    uint32_t surfaceHeight = 0;
    void* window = nullptr;

    double time = 0.0;
    double frameCpuMs = kUnavailable;
    double lastPresentMs = kUnavailable;
    uint64_t frameIndex = 0;
    bool historyValid = false;
    bool swapchainDirty = false;
    bool needsNativeTarget = false;
    AbComparison comparison{};
    FrameStats frameStats{240};
    FrameStats presentStats{240};

    // ---- Vulkan objects ----
    vk::Context context{};
    vk::Swapchain swapchain{};
    vk::Image renderImage{};        // scene colour at the render resolution
    vk::Image nativeImage{};        // scene colour at the output resolution (native mode)
    vk::Image enhancedImage{};      // engine output (storage + sampled)
    vk::Image depthImage{};         // scene depth at the scene pass resolution
    vk::Image shadowImage{};        // sun depth map
    bool renderImageSampled = false;   // layout bookkeeping is in Image::layout
    bool nativeImageSampled = false;

    vk::Buffer terrainVb{};
    vk::Buffer terrainIb{};
    vk::Buffer boxVb{};
    vk::Buffer boxIb{};
    vk::Buffer sphereVb{};
    vk::Buffer sphereIb{};
    vk::Buffer quadVb{};
    vk::Buffer terrainInstances{};
    vk::Buffer buildingInstances{};
    vk::Buffer propInstances{};
    vk::Buffer movingInstances{};
    vk::Buffer uniformBuffer{};
    vk::Buffer particleBuffer{};
    uint32_t movingInstanceCapacity = 0;
    uint32_t particleCapacity = 0;

    vk::GraphicsPipeline skyPipeline{};
    vk::GraphicsPipeline scenePipeline{};
    vk::GraphicsPipeline shadowPipeline{};
    vk::GraphicsPipeline particlePipeline{};
    vk::GraphicsPipeline presentPipeline{};
    vk::ComputePipeline particleSim{};

    VkRenderPass scenePass = VK_NULL_HANDLE;
    VkRenderPass shadowPass = VK_NULL_HANDLE;
    VkFramebuffer sceneFramebuffer = VK_NULL_HANDLE;
    VkFramebuffer nativeFramebuffer = VK_NULL_HANDLE;
    VkFramebuffer shadowFramebuffer = VK_NULL_HANDLE;

    VkDescriptorPool scenePool = VK_NULL_HANDLE;
    VkDescriptorSet sceneSet = VK_NULL_HANDLE;
    VkDescriptorPool shadowPool = VK_NULL_HANDLE;
    VkDescriptorSet shadowSet = VK_NULL_HANDLE;
    VkDescriptorPool particlePool0 = VK_NULL_HANDLE;
    VkDescriptorSet particleSet0 = VK_NULL_HANDLE;
    VkDescriptorPool particlePool1 = VK_NULL_HANDLE;
    VkDescriptorSet particleSet1 = VK_NULL_HANDLE;
    VkDescriptorPool presentPool = VK_NULL_HANDLE;
    VkDescriptorSet presentSet = VK_NULL_HANDLE;
    VkDescriptorPool simPool = VK_NULL_HANDLE;
    VkDescriptorSet simSet = VK_NULL_HANDLE;

    VkSampler shadowSampler = VK_NULL_HANDLE;
    VkSampler enhancedSampler = VK_NULL_HANDLE;
    VkSampler referenceSampler = VK_NULL_HANDLE;

    VkCommandBuffer cmd = VK_NULL_HANDLE;
    VkCommandBuffer cmdPost = VK_NULL_HANDLE;
    VkFence frameFence = VK_NULL_HANDLE;
    // Three semaphores, because the frame is two submissions: the scene pass
    // waits for the acquired image, the present pass waits for the scene pass,
    // and the presentation engine waits for the present pass. Passing
    // VK_NULL_HANDLE to vkQueuePresentKHR (which this started out doing) presents
    // a swapchain image that may still be being written.
    VkSemaphore imageAvailable = VK_NULL_HANDLE;
    VkSemaphore sceneComplete = VK_NULL_HANDLE;
    VkSemaphore presentReady = VK_NULL_HANDLE;

    std::vector<Particle> particles{};
    SceneUniforms uniforms{};

    // -----------------------------------------------------------------------
    // Teardown
    // -----------------------------------------------------------------------
    void destroyTargets() {
        vk::destroyFramebuffer(context, sceneFramebuffer);
        vk::destroyFramebuffer(context, nativeFramebuffer);
        vk::destroyFramebuffer(context, shadowFramebuffer);
        vk::destroyImage(context, renderImage);
        vk::destroyImage(context, nativeImage);
        vk::destroyImage(context, enhancedImage);
        vk::destroyImage(context, depthImage);
        vk::destroyImage(context, shadowImage);
        // Layout bookkeeping lives in the Image structs, which destroyImage owns.
        renderImage = {};
        nativeImage = {};
        enhancedImage = {};
        depthImage = {};
        shadowImage = {};
    }

    void destroyPipelines() {
        vk::destroyGraphicsPipeline(context, skyPipeline);
        vk::destroyGraphicsPipeline(context, scenePipeline);
        vk::destroyGraphicsPipeline(context, shadowPipeline);
        vk::destroyGraphicsPipeline(context, particlePipeline);
        vk::destroyGraphicsPipeline(context, presentPipeline);
        vk::destroyComputePipeline(context, particleSim);
        if (scenePass != VK_NULL_HANDLE) {
            vkDestroyRenderPass(context.device(), scenePass, nullptr);
            scenePass = VK_NULL_HANDLE;
        }
        if (shadowPass != VK_NULL_HANDLE) {
            vkDestroyRenderPass(context.device(), shadowPass, nullptr);
            shadowPass = VK_NULL_HANDLE;
        }
        if (scenePool != VK_NULL_HANDLE) vkDestroyDescriptorPool(context.device(), scenePool, nullptr);
        if (shadowPool != VK_NULL_HANDLE) vkDestroyDescriptorPool(context.device(), shadowPool, nullptr);
        if (particlePool0 != VK_NULL_HANDLE) vkDestroyDescriptorPool(context.device(), particlePool0, nullptr);
        if (particlePool1 != VK_NULL_HANDLE) vkDestroyDescriptorPool(context.device(), particlePool1, nullptr);
        if (presentPool != VK_NULL_HANDLE) vkDestroyDescriptorPool(context.device(), presentPool, nullptr);
        if (simPool != VK_NULL_HANDLE) vkDestroyDescriptorPool(context.device(), simPool, nullptr);
        scenePool = shadowPool = particlePool0 = particlePool1 = presentPool = simPool = VK_NULL_HANDLE;
        sceneSet = shadowSet = particleSet0 = particleSet1 = presentSet = simSet = VK_NULL_HANDLE;
    }

    // -----------------------------------------------------------------------
    // Target (re)creation
    // -----------------------------------------------------------------------
    uint32_t shadowExtent() const {
        return config.quality == DemoQuality::High ? 2048u : 1024u;
    }

    uint32_t sceneWidth() const {
        // Native mode renders at the output resolution: that is the whole point
        // of the comparison, and it is what the benchmark measures.
        return config.mode == DemoMode::Native ? demoResolutions()[config.outputIndex].width
                                              : demoResolutions()[config.renderIndex].width;
    }

    uint32_t sceneHeight() const {
        return config.mode == DemoMode::Native ? demoResolutions()[config.outputIndex].height
                                              : demoResolutions()[config.renderIndex].height;
    }

    uint32_t outputWidth() const { return demoResolutions()[config.outputIndex].width; }
    uint32_t outputHeight() const { return demoResolutions()[config.outputIndex].height; }

    bool wantsNativeTarget() const { return config.mode == DemoMode::Native; }

    bool createTargets(std::string* error) {
        const uint32_t sceneW = sceneWidth();
        const uint32_t sceneH = sceneHeight();

        if (!vk::createImage(context, sceneW, sceneH, kColorFormat,
                             VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT, renderImage,
                             error)) {
            return false;
        }
        if (!vk::createImage(context, sceneW, sceneH, kDepthFormat, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT,
                             depthImage, error)) {
            return false;
        }
        if (!vk::createImage(context, shadowExtent(), shadowExtent(), kDepthFormat,
                             VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT,
                             shadowImage, error)) {
            return false;
        }
        // The engine writes the output as a storage image and hands it back
        // sampleable, so both usages are required.
        if (!vk::createImage(context, outputWidth(), outputHeight(), kColorFormat,
                             VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_SAMPLED_BIT, enhancedImage, error)) {
            return false;
        }
        if (wantsNativeTarget()) {
            if (!vk::createImage(context, outputWidth(), outputHeight(), kColorFormat,
                                 VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT, nativeImage,
                                 error)) {
                return false;
            }
            nativeFramebuffer = vk::createFramebuffer(context, scenePass, {nativeImage.view}, outputWidth(),
                                                      outputHeight());
            if (nativeFramebuffer == VK_NULL_HANDLE) {
                if (error != nullptr) *error = "could not create the native-resolution framebuffer";
                return false;
            }
        }
        sceneFramebuffer = vk::createFramebuffer(context, scenePass, {renderImage.view, depthImage.view}, sceneW,
                                                 sceneH);
        if (sceneFramebuffer == VK_NULL_HANDLE) {
            if (error != nullptr) *error = "could not create the scene framebuffer";
            return false;
        }
        shadowFramebuffer = vk::createFramebuffer(context, shadowPass, {shadowImage.view}, shadowExtent(),
                                                  shadowExtent());
        if (shadowFramebuffer == VK_NULL_HANDLE) {
            if (error != nullptr) *error = "could not create the shadow framebuffer";
            return false;
        }
        return true;
    }

    bool rebuildTargets(std::string* error) {
        // The device must be idle: every one of these images may still be read by
        // a command buffer that has been submitted.
        if (context.device() != VK_NULL_HANDLE) vkDeviceWaitIdle(context.device());
        destroyTargets();
        if (!createTargets(error)) return false;
        // The new images start UNDEFINED; the render passes declare that layout,
        // and the engine is told what it receives every frame anyway.
        renderImage.layout = VK_IMAGE_LAYOUT_UNDEFINED;
        nativeImage.layout = VK_IMAGE_LAYOUT_UNDEFINED;
        enhancedImage.layout = VK_IMAGE_LAYOUT_UNDEFINED;
        depthImage.layout = VK_IMAGE_LAYOUT_UNDEFINED;
        shadowImage.layout = VK_IMAGE_LAYOUT_UNDEFINED;
        renderImageSampled = false;
        nativeImageSampled = false;
        return true;
    }

    // -----------------------------------------------------------------------
    // Setup
    // -----------------------------------------------------------------------
    bool createBuffers(std::string* error) {
        if (!makeVertexBuffer(context, scene.terrain.vertices.data(),
                              scene.terrain.vertices.size() * sizeof(Vertex), terrainVb, error)) {
            return false;
        }
        if (!makeIndexBuffer(context, scene.terrain.indices, terrainIb, error)) return false;
        if (!makeVertexBuffer(context, scene.box.vertices.data(), scene.box.vertices.size() * sizeof(Vertex),
                              boxVb, error)) {
            return false;
        }
        if (!makeIndexBuffer(context, scene.box.indices, boxIb, error)) return false;
        if (!makeVertexBuffer(context, scene.sphere.vertices.data(),
                              scene.sphere.vertices.size() * sizeof(Vertex), sphereVb, error)) {
            return false;
        }
        if (!makeIndexBuffer(context, scene.sphere.indices, sphereIb, error)) return false;

        // The particle pass expands one camera-facing quad per particle from a
        // six-vertex corner list (two triangles, no index buffer).
        const float corners[6][2] = {{-1.0f, -1.0f}, {1.0f, -1.0f}, {1.0f, 1.0f},
                                     {-1.0f, -1.0f}, {1.0f, 1.0f}, {-1.0f, 1.0f}};
        if (!makeVertexBuffer(context, corners, sizeof(corners), quadVb, error)) return false;

        const VkMemoryPropertyFlags host = VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                                          VK_MEMORY_PROPERTY_HOST_COHERENT_BIT;
        const VkDeviceSize instanceBytes = 96;   // sizeof(Instance)
        if (!vk::createBuffer(context, instanceBytes, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, host,
                              terrainInstances, error)) {
            return false;
        }
        const uint64_t buildingCount = std::max<uint64_t>(1, scene.buildingInstances.count());
        if (!vk::createBuffer(context, instanceBytes * buildingCount, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, host,
                              buildingInstances, error)) {
            return false;
        }
        const uint64_t propCount = std::max<uint64_t>(1, scene.propInstances.count());
        if (!vk::createBuffer(context, instanceBytes * propCount, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, host,
                              propInstances, error)) {
            return false;
        }
        // One slot per possible moving object, with room for the props if the
        // scene is rebuilt smaller.
        movingInstanceCapacity = std::max<uint32_t>(8u, scene.movingObjectCount);
        if (!vk::createBuffer(context, instanceBytes * movingInstanceCapacity, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT,
                              host, movingInstances, error)) {
            return false;
        }
        if (!vk::createBuffer(context, kSceneUniformBytes, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT, host,
                              uniformBuffer, error)) {
            return false;
        }

        particleCapacity = std::min<uint32_t>(
            kParticleCapacity, std::max<uint32_t>(256u, scene.particleCount));
        if (!vk::createBuffer(context, sizeof(Particle) * particleCapacity,
                              VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, host, particleBuffer, error)) {
            return false;
        }
        particles.clear();
        resetParticles(particles, particleCapacity, config.seed, scene.emitter);
        return vk::uploadToBuffer(context, particleBuffer, particles.data(),
                                  sizeof(Particle) * particles.size());
    }

    void uploadStaticInstances() {
        if (terrainInstances.valid() && scene.terrainInstances.count() > 0) {
            vk::uploadToBuffer(context, terrainInstances, scene.terrainInstances.instances.data(),
                               scene.terrainInstances.count() * sizeof(Instance));
        }
        if (buildingInstances.valid() && scene.buildingInstances.count() > 0) {
            vk::uploadToBuffer(context, buildingInstances, scene.buildingInstances.instances.data(),
                               scene.buildingInstances.count() * sizeof(Instance));
        }
        if (propInstances.valid() && scene.propInstances.count() > 0) {
            vk::uploadToBuffer(context, propInstances, scene.propInstances.instances.data(),
                               scene.propInstances.count() * sizeof(Instance));
        }
    }

    bool createRenderPasses(std::string* error) {
        vk::ColorAttachment color;
        color.format = kColorFormat;
        // The sky pass covers every pixel, so the previous contents are dead on
        // arrival: DONT_CARE avoids a tile load that mobile GPUs charge for.
        color.loadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        color.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
        color.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        color.finalLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
        if (!vk::createRenderPassWithDepth(context, color, kDepthFormat, true, scenePass, error)) {
            return false;
        }

        // The shadow pass has no colour attachment: a depth-only pass may omit
        // the fragment shader entirely.
        VkAttachmentDescription depth{};
        depth.format = kDepthFormat;
        depth.samples = VK_SAMPLE_COUNT_1_BIT;
        depth.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
        depth.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
        depth.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        depth.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        depth.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        // DEPTH_STENCIL_READ_ONLY so the scene pass can sample it.
        depth.finalLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_READ_ONLY_OPTIMAL;

        VkAttachmentReference depthRef{};
        depthRef.attachment = 0;
        depthRef.layout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

        VkSubpassDescription subpass{};
        subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
        subpass.colorAttachmentCount = 0;
        subpass.pDepthStencilAttachment = &depthRef;

        VkSubpassDependency dependency{};
        dependency.srcSubpass = VK_SUBPASS_EXTERNAL;
        dependency.dstSubpass = 0;
        dependency.srcStageMask = VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
        dependency.dstStageMask = VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
        dependency.dstAccessMask = VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;

        VkRenderPassCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
        info.attachmentCount = 1;
        info.pAttachments = &depth;
        info.subpassCount = 1;
        info.pSubpasses = &subpass;
        info.dependencyCount = 1;
        info.pDependencies = &dependency;
        if (vkCreateRenderPass(context.device(), &info, nullptr, &shadowPass) != VK_SUCCESS) {
            if (error != nullptr) *error = "could not create the shadow render pass";
            return false;
        }
        return true;
    }

    bool createPipelines(std::string* error) {
        // ---- sky: a fullscreen triangle behind everything ----
        {
            const shaders::ShaderBlob vertexShader = shaders::loadShader("fullscreen.vert");
            const shaders::ShaderBlob fragmentShader = shaders::loadShader("sky.frag");
            vk::GraphicsPipelineDesc desc;
            desc.renderPass = scenePass;
            desc.vertexSpirv = vertexShader.words;
            desc.vertexWordCount = vertexShader.wordCount;
            desc.fragmentSpirv = fragmentShader.words;
            desc.fragmentWordCount = fragmentShader.wordCount;
            desc.hasDepthAttachment = true;
            desc.depthTest = false;
            desc.depthWrite = false;
            desc.cullMode = VK_CULL_MODE_NONE;
            desc.pushConstantBytes = sizeof(vk::SkyPush);
            desc.pushConstantStages = VK_SHADER_STAGE_FRAGMENT_BIT;
            desc.debugName = "demo.sky";
            if (!vk::createGraphicsPipeline(context, desc, skyPipeline, error)) return false;
        }

        // ---- scene: instanced terrain, buildings, props, moving objects ----
        {
            const shaders::ShaderBlob vertexShader = shaders::loadShader("scene.vert");
            const shaders::ShaderBlob fragmentShader = shaders::loadShader("scene.frag");
            vk::GraphicsPipelineDesc desc;
            desc.renderPass = scenePass;
            desc.vertexSpirv = vertexShader.words;
            desc.vertexWordCount = vertexShader.wordCount;
            desc.fragmentSpirv = fragmentShader.words;
            desc.fragmentWordCount = fragmentShader.wordCount;
            desc.vertexBindings = {{0, sizeof(Vertex), false}, {1, sizeof(Instance), true}};
            desc.vertexAttributes = {
                {0, 0, VK_FORMAT_R32G32B32_SFLOAT, 0},    // aPosition
                {1, 0, VK_FORMAT_R32G32B32_SFLOAT, 12},   // aNormal
                {2, 0, VK_FORMAT_R32G32_SFLOAT, 24},      // aTexCoord
                {3, 1, VK_FORMAT_R32G32B32A32_SFLOAT, 0},  // instance row 0
                {4, 1, VK_FORMAT_R32G32B32A32_SFLOAT, 16},
                {5, 1, VK_FORMAT_R32G32B32A32_SFLOAT, 32},
                {6, 1, VK_FORMAT_R32G32B32A32_SFLOAT, 48},
                {7, 1, VK_FORMAT_R32G32B32A32_SFLOAT, 64},  // aInstanceColor
                {8, 1, VK_FORMAT_R32G32B32A32_SFLOAT, 80},  // aInstanceMaterial
            };
            desc.descriptorSets = {{{0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1,
                                      VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT},
                                     {1, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1,
                                      VK_SHADER_STAGE_FRAGMENT_BIT}}};
            desc.hasDepthAttachment = true;
            desc.depthTest = true;
            desc.depthWrite = true;
            desc.debugName = "demo.scene";
            if (!vk::createGraphicsPipeline(context, desc, scenePipeline, error)) return false;
        }

        // ---- shadow: the same scene from the sun, depth only ----
        {
            const shaders::ShaderBlob vertexShader = shaders::loadShader("scene_shadow.vert");
            vk::GraphicsPipelineDesc desc;
            desc.renderPass = shadowPass;
            desc.vertexSpirv = vertexShader.words;
            desc.vertexWordCount = vertexShader.wordCount;
            desc.vertexBindings = {{0, sizeof(Vertex), false}, {1, sizeof(Instance), true}};
            desc.vertexAttributes = {
                {0, 0, VK_FORMAT_R32G32B32_SFLOAT, 0},
                {1, 0, VK_FORMAT_R32G32B32_SFLOAT, 12},
                {2, 0, VK_FORMAT_R32G32_SFLOAT, 24},
                {3, 1, VK_FORMAT_R32G32B32A32_SFLOAT, 0},
                {4, 1, VK_FORMAT_R32G32B32A32_SFLOAT, 16},
                {5, 1, VK_FORMAT_R32G32B32A32_SFLOAT, 32},
                {6, 1, VK_FORMAT_R32G32B32A32_SFLOAT, 48},
                {7, 1, VK_FORMAT_R32G32B32A32_SFLOAT, 64},
                {8, 1, VK_FORMAT_R32G32B32A32_SFLOAT, 80},
            };
            desc.descriptorSets = {{{0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_VERTEX_BIT}}};
            desc.hasDepthAttachment = true;
            desc.depthTest = true;
            desc.depthWrite = true;
            // Front-face culling plus a slope-scaled bias: the standard cure for
            // shadow acne (self-shadowing) and peter-panning.
            desc.cullMode = VK_CULL_MODE_FRONT_BIT;
            desc.depthBias = true;
            desc.depthBiasConstant = 1.5f;
            desc.depthBiasSlope = 2.5f;
            desc.debugName = "demo.shadow";
            if (!vk::createGraphicsPipeline(context, desc, shadowPipeline, error)) return false;
        }

        // ---- particles: camera-facing quads, alpha blended ----
        {
            const shaders::ShaderBlob vertexShader = shaders::loadShader("particle.vert");
            const shaders::ShaderBlob fragmentShader = shaders::loadShader("particle.frag");
            vk::GraphicsPipelineDesc desc;
            desc.renderPass = scenePass;
            desc.vertexSpirv = vertexShader.words;
            desc.vertexWordCount = vertexShader.wordCount;
            desc.fragmentSpirv = fragmentShader.words;
            desc.fragmentWordCount = fragmentShader.wordCount;
            desc.vertexBindings = {{0, sizeof(float) * 2, false}};
            desc.vertexAttributes = {{0, 0, VK_FORMAT_R32G32_SFLOAT, 0}};
            // Set 0 is the scene uniform block, set 1 the particle storage buffer:
            // particle.vert declares both, and they cannot share a binding.
            desc.descriptorSets = {
                {{0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_VERTEX_BIT}},
                {{0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_VERTEX_BIT}},
            };
            desc.hasDepthAttachment = true;
            desc.depthTest = true;
            desc.depthWrite = false;   // alpha-blended: depth-tested, not depth-writing
            desc.blend = true;
            desc.cullMode = VK_CULL_MODE_NONE;   // corner winding depends on the view
            desc.debugName = "demo.particles";
            if (!vk::createGraphicsPipeline(context, desc, particlePipeline, error)) return false;
        }

        // ---- present: the comparison view ----
        {
            const shaders::ShaderBlob vertexShader = shaders::loadShader("fullscreen.vert");
            const shaders::ShaderBlob fragmentShader = shaders::loadShader("present.frag");
            vk::GraphicsPipelineDesc desc;
            desc.renderPass = swapchain.renderPass;
            desc.vertexSpirv = vertexShader.words;
            desc.vertexWordCount = vertexShader.wordCount;
            desc.fragmentSpirv = fragmentShader.words;
            desc.fragmentWordCount = fragmentShader.wordCount;
            desc.descriptorSets = {{{0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1,
                                      VK_SHADER_STAGE_FRAGMENT_BIT},
                                     {1, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1,
                                      VK_SHADER_STAGE_FRAGMENT_BIT}}};
            desc.hasDepthAttachment = false;
            desc.depthTest = false;
            desc.depthWrite = false;
            desc.cullMode = VK_CULL_MODE_NONE;
            desc.pushConstantBytes = sizeof(vk::PresentPush);
            desc.pushConstantStages = VK_SHADER_STAGE_FRAGMENT_BIT;
            desc.debugName = "demo.present";
            if (!vk::createGraphicsPipeline(context, desc, presentPipeline, error)) return false;
        }

        // ---- particle simulation (compute) ----
        {
            const shaders::ShaderBlob shader = shaders::loadShader("particle_sim.comp");
            const std::vector<vk::DescriptorBinding> bindings = {
                {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT}};
            if (!vk::createComputePipeline(context, bindings, sizeof(vk::ParticleSimPush), shader.words,
                                           shader.wordCount, "demo.particle_sim", particleSim, error)) {
                return false;
            }
        }

        // ---- samplers ----
        shadowSampler = vk::createLinearSampler(context, true);
        // The comparison must show reconstructed pixels, not a smoothed version
        // of them, so the enhanced image is sampled nearest. The reference is
        // sampled linearly on purpose: that is the cost-matched baseline a game
        // would get from the platform scaler.
        enhancedSampler = vk::createNearestSampler(context);
        referenceSampler = vk::createLinearSampler(context, true);
        return shadowSampler != VK_NULL_HANDLE && enhancedSampler != VK_NULL_HANDLE &&
               referenceSampler != VK_NULL_HANDLE;
    }

    void destroyDescriptorPools() {
        if (context.device() == VK_NULL_HANDLE) return;
        vkDeviceWaitIdle(context.device());
        for (VkDescriptorPool* pool : {&scenePool, &shadowPool, &particlePool0, &particlePool1, &presentPool,
                                       &simPool}) {
            if (*pool != VK_NULL_HANDLE) vkDestroyDescriptorPool(context.device(), *pool, nullptr);
            *pool = VK_NULL_HANDLE;
        }
        sceneSet = shadowSet = particleSet0 = particleSet1 = presentSet = simSet = VK_NULL_HANDLE;
    }

    bool createDescriptors(std::string* error) {
        // A rebuild replaces every set (the shadow map and the images the present
        // pass samples have changed), so the old pools go first: their memory is
        // finite and a leak here would accumulate on every config change.
        destroyDescriptorPools();
        // Scene set: uniform block + shadow map.
        scenePool = vk::createDescriptorPool(
            context, {{0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1,
                       VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT},
                      {1, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1, VK_SHADER_STAGE_FRAGMENT_BIT}},
            1);
        if (scenePool == VK_NULL_HANDLE) {
            if (error != nullptr) *error = "could not create the scene descriptor pool";
            return false;
        }
        sceneSet = vk::allocateDescriptorSet(context, scenePool, scenePipeline.setLayouts[0]);

        // Shadow set: the uniform block only.
        shadowPool = vk::createDescriptorPool(
            context, {{0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_VERTEX_BIT}}, 1);
        shadowSet = vk::allocateDescriptorSet(context, shadowPool, shadowPipeline.setLayouts[0]);

        // Particles: set 0 uniform, set 1 storage.
        particlePool0 = vk::createDescriptorPool(
            context, {{0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_VERTEX_BIT}}, 1);
        particleSet0 = vk::allocateDescriptorSet(context, particlePool0, particlePipeline.setLayouts[0]);
        particlePool1 = vk::createDescriptorPool(
            context, {{0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_VERTEX_BIT}}, 1);
        particleSet1 = vk::allocateDescriptorSet(context, particlePool1, particlePipeline.setLayouts[1]);

        // Present: enhanced + reference samplers.
        presentPool = vk::createDescriptorPool(
            context, {{0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1, VK_SHADER_STAGE_FRAGMENT_BIT},
                      {1, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1, VK_SHADER_STAGE_FRAGMENT_BIT}},
            1);
        presentSet = vk::allocateDescriptorSet(context, presentPool, presentPipeline.setLayouts[0]);

        // Simulation: one storage buffer.
        simPool = vk::createDescriptorPool(
            context, {{0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT}}, 1);
        simSet = vk::allocateDescriptorSet(context, simPool, particleSim.descriptorSetLayout);

        if (sceneSet == VK_NULL_HANDLE || shadowSet == VK_NULL_HANDLE || particleSet0 == VK_NULL_HANDLE ||
            particleSet1 == VK_NULL_HANDLE || presentSet == VK_NULL_HANDLE || simSet == VK_NULL_HANDLE) {
            if (error != nullptr) *error = "could not allocate the demo descriptor sets";
            return false;
        }

        const VkDevice device = context.device();
        vk::writeUniformBuffer(device, sceneSet, 0, uniformBuffer.buffer, kSceneUniformBytes);
        vk::writeCombinedSampler(device, sceneSet, 1, shadowImage.view, shadowSampler);
        vk::writeUniformBuffer(device, shadowSet, 0, uniformBuffer.buffer, kSceneUniformBytes);
        vk::writeUniformBuffer(device, particleSet0, 0, uniformBuffer.buffer, kSceneUniformBytes);
        vk::writeStorageBuffer(device, particleSet1, 0, particleBuffer.buffer, particleBuffer.size);
        vk::writeStorageBuffer(device, simSet, 0, particleBuffer.buffer, particleBuffer.size);
        return true;
    }

    /** The present pass points its samplers at whatever this frame produced. */
    // Which image is "the enhanced one": the engine's output when a session is
    // running, otherwise whatever the scene pass produced. Sampling enhancedImage
    // with no session would present an image nothing wrote.
    // Non-const on purpose: transitionImage() records the new layout back into the
    // image it is given, and that bookkeeping is what the next frame's barriers
    // believe.
    vk::Image& enhancedForPresent() {
        if (sessionActive) return enhancedImage;
        return wantsNativeTarget() ? nativeImage : renderImage;
    }

    void updatePresentDescriptors() {
        const VkDevice device = context.device();
        vk::Image& enhanced = enhancedForPresent();
        vk::writeCombinedSampler(device, presentSet, 0, enhanced.view, enhancedSampler);
        // The reference is the low-resolution render: in the comparison the left
        // half shows exactly what the AI stage was given.
        vk::writeCombinedSampler(device, presentSet, 1, renderImage.view, referenceSampler);
    }

    // -----------------------------------------------------------------------
    // Scene updates
    // -----------------------------------------------------------------------
    void updateUniforms() {
        const float radius = config.quality == DemoQuality::High ? 34.0f : 30.0f;
        const Camera camera = orbitCamera(time, radius, 15.0f, 0);
        const Vec3 sun = sunDirectionForTime(time);

        const float aspect = static_cast<float>(sceneWidth()) / static_cast<float>(sceneHeight());
        const Mat4 view = cameraViewMatrix(camera);
        const Mat4 projection = cameraProjectionMatrix(camera, aspect);
        uniforms.viewProjection = projection * view;
        uniforms.lightViewProjection = sunViewProjection(sun, Vec3{0.0f, 2.0f, 0.0f}, 58.0f, 90.0f);

        uniforms.lightDirection[0] = sun.x;
        uniforms.lightDirection[1] = sun.y;
        uniforms.lightDirection[2] = sun.z;
        uniforms.lightDirection[3] = 1.05f;   // intensity
        uniforms.cameraPosition[0] = camera.position.x;
        uniforms.cameraPosition[1] = camera.position.y;
        uniforms.cameraPosition[2] = camera.position.z;
        uniforms.cameraPosition[3] = 0.0f;
        uniforms.fogColor[0] = scene.fogColor.x;
        uniforms.fogColor[1] = scene.fogColor.y;
        uniforms.fogColor[2] = scene.fogColor.z;
        uniforms.fogColor[3] = scene.fogDensity;
        uniforms.ambientSky[0] = scene.ambientSky.x;
        uniforms.ambientSky[1] = scene.ambientSky.y;
        uniforms.ambientSky[2] = scene.ambientSky.z;
        uniforms.ambientSky[3] = scene.groundBounce;
        uniforms.params[0] = static_cast<float>(time);
        uniforms.params[1] = 0.85f;   // shadow strength
        uniforms.params[2] = 1.0f / static_cast<float>(shadowExtent());
        uniforms.params[3] = 0.0f;
        vk::uploadToBuffer(context, uniformBuffer, &uniforms, sizeof(uniforms));
    }

    void updateMovingInstances() {
        InstanceBatch batch;
        batch.instances.reserve(movingInstanceCapacity);
        animateMovingObjects(scene.movingObjectCount, time, batch, scene.emitter);
        if (!batch.instances.empty()) {
            vk::uploadToBuffer(context, movingInstances, batch.instances.data(),
                               batch.instances.size() * sizeof(Instance));
        }
    }

    void recordSceneDraws(VkCommandBuffer commandBuffer, bool withParticles) {
        // Terrain: one instance, its own mesh.
        if (scene.terrainInstances.count() > 0) {
            const VkBuffer buffers[2] = {terrainVb.buffer, terrainInstances.buffer};
            const VkDeviceSize offsets[2] = {0, 0};
            vkCmdBindVertexBuffers(commandBuffer, 0, 2, buffers, offsets);
            vkCmdBindIndexBuffer(commandBuffer, terrainIb.buffer, 0, VK_INDEX_TYPE_UINT32);
            vkCmdDrawIndexed(commandBuffer, scene.terrain.indexCount(), scene.terrainInstances.count(), 0, 0, 0);
        }
        // Buildings and props share the box and sphere meshes.
        if (scene.buildingInstances.count() > 0) {
            const VkBuffer buffers[2] = {boxVb.buffer, buildingInstances.buffer};
            const VkDeviceSize offsets[2] = {0, 0};
            vkCmdBindVertexBuffers(commandBuffer, 0, 2, buffers, offsets);
            vkCmdBindIndexBuffer(commandBuffer, boxIb.buffer, 0, VK_INDEX_TYPE_UINT32);
            vkCmdDrawIndexed(commandBuffer, scene.box.indexCount(), scene.buildingInstances.count(), 0, 0, 0);
        }
        if (scene.propInstances.count() > 0) {
            const VkBuffer buffers[2] = {sphereVb.buffer, propInstances.buffer};
            const VkDeviceSize offsets[2] = {0, 0};
            vkCmdBindVertexBuffers(commandBuffer, 0, 2, buffers, offsets);
            vkCmdBindIndexBuffer(commandBuffer, sphereIb.buffer, 0, VK_INDEX_TYPE_UINT32);
            vkCmdDrawIndexed(commandBuffer, scene.sphere.indexCount(), scene.propInstances.count(), 0, 0, 0);
        }
        if (scene.movingObjectCount > 0) {
            const VkBuffer buffers[2] = {sphereVb.buffer, movingInstances.buffer};
            const VkDeviceSize offsets[2] = {0, 0};
            vkCmdBindVertexBuffers(commandBuffer, 0, 2, buffers, offsets);
            vkCmdBindIndexBuffer(commandBuffer, sphereIb.buffer, 0, VK_INDEX_TYPE_UINT32);
            vkCmdDrawIndexed(commandBuffer, scene.sphere.indexCount(), scene.movingObjectCount, 0, 0, 0);
        }
        if (withParticles && particleCapacity > 0 && particlePipeline.valid()) {
            vkCmdBindPipeline(commandBuffer, VK_PIPELINE_BIND_POINT_GRAPHICS, particlePipeline.pipeline);
            vkCmdBindDescriptorSets(commandBuffer, VK_PIPELINE_BIND_POINT_GRAPHICS, particlePipeline.layout, 0, 1,
                                    &particleSet0, 0, nullptr);
            vkCmdBindDescriptorSets(commandBuffer, VK_PIPELINE_BIND_POINT_GRAPHICS, particlePipeline.layout, 1, 1,
                                    &particleSet1, 0, nullptr);
            const VkBuffer buffers[1] = {quadVb.buffer};
            const VkDeviceSize offsets[1] = {0};
            vkCmdBindVertexBuffers(commandBuffer, 0, 1, buffers, offsets);
            // One quad per particle, expanded in the vertex shader.
            vkCmdDraw(commandBuffer, 6, particleCapacity, 0, 0);
        }
    }

    void recordShadowPass(VkCommandBuffer commandBuffer) {
        const float clearColor[4] = {0.0f, 0.0f, 0.0f, 0.0f};
        vk::transitionImage(commandBuffer, shadowImage, VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
                            VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
                            VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT);
        // clearColor == nullptr selects the depth-only clear value path.
        vk::beginRenderPass(commandBuffer, shadowPass, shadowFramebuffer, shadowExtent(), shadowExtent(), nullptr,
                            1.0f);
        vk::setViewport(commandBuffer, shadowExtent(), shadowExtent(), false);
        vkCmdBindPipeline(commandBuffer, VK_PIPELINE_BIND_POINT_GRAPHICS, shadowPipeline.pipeline);
        vkCmdBindDescriptorSets(commandBuffer, VK_PIPELINE_BIND_POINT_GRAPHICS, shadowPipeline.layout, 0, 1,
                                &shadowSet, 0, nullptr);
        recordSceneDraws(commandBuffer, false);
        vkCmdEndRenderPass(commandBuffer);
        // The scene pass samples it next.
        vk::transitionImage(commandBuffer, shadowImage, VK_IMAGE_LAYOUT_DEPTH_STENCIL_READ_ONLY_OPTIMAL,
                            VK_PIPELINE_STAGE_LATE_FRAGMENT_TESTS_BIT,
                            VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT);
        (void)clearColor;
    }

    void recordScenePass(VkCommandBuffer commandBuffer, vk::Image& target, VkFramebuffer framebuffer) {
        const float clearColor[4] = {0.05f, 0.06f, 0.09f, 1.0f};
        const uint32_t width = target.width;
        const uint32_t height = target.height;
        vk::transitionImage(commandBuffer, target, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,
                            VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
                            VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT);
        vk::beginRenderPass(commandBuffer, scenePass, framebuffer, width, height, clearColor, 1.0f);
        vk::setViewport(commandBuffer, width, height, true);   // +y up, see v4k_math.h

        // Sky first: it fills every pixel and writes no depth.
        vkCmdBindPipeline(commandBuffer, VK_PIPELINE_BIND_POINT_GRAPHICS, skyPipeline.pipeline);
        vk::SkyPush sky{};
        const Vec3 sun = sunDirectionForTime(time);
        sky.sunDirection[0] = sun.x;
        sky.sunDirection[1] = sun.y;
        sky.sunDirection[2] = sun.z;
        sky.exposure = 1.0f;
        sky.horizonColor[0] = scene.fogColor.x;
        sky.horizonColor[1] = scene.fogColor.y;
        sky.horizonColor[2] = scene.fogColor.z;
        sky.hazeStrength = 0.45f;
        sky.zenithColor[0] = 0.16f;
        sky.zenithColor[1] = 0.26f;
        sky.zenithColor[2] = 0.48f;
        sky.time = static_cast<float>(time);
        vkCmdPushConstants(commandBuffer, skyPipeline.layout, VK_SHADER_STAGE_FRAGMENT_BIT, 0, sizeof(sky), &sky);
        vkCmdDraw(commandBuffer, vk::kFullscreenTriangleVertices, 1, 0, 0);

        vkCmdBindPipeline(commandBuffer, VK_PIPELINE_BIND_POINT_GRAPHICS, scenePipeline.pipeline);
        vkCmdBindDescriptorSets(commandBuffer, VK_PIPELINE_BIND_POINT_GRAPHICS, scenePipeline.layout, 0, 1,
                                &sceneSet, 0, nullptr);
        recordSceneDraws(commandBuffer, true);
        vkCmdEndRenderPass(commandBuffer);
    }

    void recordParticleSim(VkCommandBuffer commandBuffer, float deltaSeconds) {
        if (!particleSim.valid() || particleCapacity == 0) return;
        vk::ParticleSimPush push{};
        push.deltaTime = deltaSeconds;
        push.time = static_cast<float>(time);
        push.particleCount = particleCapacity;
        push.emitterSeed = config.seed;
        push.emitterPosition[0] = scene.emitter.x;
        push.emitterPosition[1] = scene.emitter.y;
        push.emitterPosition[2] = scene.emitter.z;
        push.gravity = kParticleGravity;
        vk::recordDispatch(commandBuffer, particleSim, simSet, (particleCapacity + 63) / 64, 1, 1, &push,
                           sizeof(push));
        vk::recordStorageToVertexBarrier(commandBuffer);
    }

    // -----------------------------------------------------------------------
    // Engine session
    // -----------------------------------------------------------------------
    // Brings the session in line with the current plan. Called once at the top of
    // a frame, *before* the command buffer is recorded, because what the frame
    // records depends on it: the low-res image is only transitioned into the
    // engine's documented input layout on frames that will actually be upscaled.
    //
    // Nothing in here is fatal. A device without the engine, or without a model
    // installed, still gets a rendered scene and a panel that says what is
    // missing -- refusing to draw would be a worse answer than explaining.
    bool ensureSession(std::string* error) {
        if (plan.neural == false || !plan.upscales) {
            if (sessionActive && engine != nullptr) {
                engine->stopSession();
                sessionActive = false;
                historyValid = false;
            }
            return true;
        }
        if (sessionActive) return true;
        if (engine == nullptr || !engine->initialised()) {
            lastError =
                "the engine is not available in this build, so the AI stage cannot run; the panel "
                "shows the low-resolution render";
            return true;
        }
        // One attempt every two seconds: enough to notice a model installed from
        // the AI Engine screen without retrying a graph this device cannot run
        // sixty times a second.
        const double now = nowMs();
        if (lastSessionAttemptMs != kUnavailable && now - lastSessionAttemptMs < kSessionRetryMs) {
            return true;
        }
        lastSessionAttemptMs = now;

        v4k::DeviceHandles deviceHandles;
        deviceHandles.instance = reinterpret_cast<uint64_t>(context.instance());
        deviceHandles.physicalDevice = reinterpret_cast<uint64_t>(context.physicalDevice());
        deviceHandles.device = reinterpret_cast<uint64_t>(context.device());
        deviceHandles.computeQueueFamily = context.queues().compute;
        deviceHandles.graphicsQueueFamily = context.queues().graphics;
        deviceHandles.computeQueue = reinterpret_cast<uint64_t>(context.computeQueue());
        deviceHandles.graphicsQueue = reinterpret_cast<uint64_t>(context.graphicsQueue());

        SessionDesc desc;
        desc.inputWidth = plan.inputWidth;
        desc.inputHeight = plan.inputHeight;
        desc.outputWidth = plan.outputWidth;
        desc.outputHeight = plan.outputHeight;
        desc.temporal = plan.temporal;
        desc.denoise = plan.denoise;
        desc.antiAliasing = plan.antiAliasing;
        desc.neural = plan.neural;
        desc.sharpening = plan.sharpening;
        desc.noiseReduction = plan.noiseReduction;
        desc.maxWorkingBytes = 0;   // the engine derives it from the device

        std::string startError;
        if (!engine->startSessionOnDevice(deviceHandles, desc, &startError)) {
            lastError = "the AI stage could not start: " + startError +
                        " The scene keeps rendering without it; install a model on the AI Engine "
                        "screen and it will be picked up within a couple of seconds.";
            sessionActive = false;
            return true;
        }
        sessionActive = engine->sessionActive();
        historyValid = false;
        if (sessionActive) lastError.clear();
        (void)error;
        return true;
    }

    bool upscaleFrame(std::string* error) {
        if (!sessionActive) return true;
        FrameHandles frame;
        frame.lowResImage = reinterpret_cast<uint64_t>(renderImage.image);
        frame.lowResView = reinterpret_cast<uint64_t>(renderImage.view);
        frame.outputImage = reinterpret_cast<uint64_t>(enhancedImage.image);
        frame.outputView = reinterpret_cast<uint64_t>(enhancedImage.view);
        frame.deltaSeconds = frameCpuMs == kUnavailable ? 1.0 / 60.0 : frameCpuMs / 1000.0;
        frame.resetHistory = !historyValid;
        frame.historyValid = historyValid;

        const FrameResult result = engine->processFrame(frame);
        if (!result.submitted) {
            if (error != nullptr) *error = result.error.empty() ? "the upscaler did not submit" : result.error;
            return false;
        }
        historyValid = true;
        // The engine leaves both images sampleable; record the layouts it
        // produced so the next frame's barriers start from the truth.
        renderImage.layout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
        enhancedImage.layout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
        return true;
    }
};

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

DemoRenderer::DemoRenderer() : impl_(new Impl()) {}
DemoRenderer::~DemoRenderer() { shutdown(); }

bool DemoRenderer::initialise(Engine* engine, void* nativeWindow, uint32_t width, uint32_t height,
                              std::string* error) {
    Impl& impl = *impl_;
    if (impl.initialised) return true;
    impl.engine = engine;
    impl.window = nativeWindow;
    impl.surfaceWidth = width;
    impl.surfaceHeight = height;

    if (!impl.context.create(false, error)) return false;
    if (!impl.context.queues().hasGraphics()) {
        if (error != nullptr) *error = "the demo needs a queue family that supports graphics";
        return false;
    }
    if (!vk::createSwapchain(impl.context, nativeWindow, impl.swapchain, error)) return false;

    // The scene is built before the buffers that hold it.
    impl.scene = buildDemoScene(impl.config.seed, impl.config.quality);
    impl.sceneStats = sceneStats(impl.scene);
    impl.plan = planSession(impl.config);
    // A new configuration is a new attempt at the session: do not make the user
    // wait out the retry window after changing the ladder or the mode.
    impl.lastSessionAttemptMs = kUnavailable;

    if (!impl.createRenderPasses(error)) return false;
    if (!impl.createPipelines(error)) return false;
    if (!impl.createBuffers(error)) return false;
    if (!impl.rebuildTargets(error)) return false;
    impl.uploadStaticInstances();
    if (!impl.createDescriptors(error)) return false;

    impl.cmd = impl.context.allocatePrimaryCommandBuffer();
    impl.cmdPost = impl.context.allocatePrimaryCommandBuffer();
    impl.frameFence = impl.context.createFence(true);
    impl.imageAvailable = impl.context.createSemaphore();
    impl.sceneComplete = impl.context.createSemaphore();
    impl.presentReady = impl.context.createSemaphore();
    if (impl.cmd == VK_NULL_HANDLE || impl.cmdPost == VK_NULL_HANDLE || impl.frameFence == VK_NULL_HANDLE ||
        impl.imageAvailable == VK_NULL_HANDLE || impl.sceneComplete == VK_NULL_HANDLE ||
        impl.presentReady == VK_NULL_HANDLE) {
        if (error != nullptr) *error = "could not allocate the demo's command buffer or synchronisation objects";
        return false;
    }

    impl.initialised = true;
    return true;
}

void DemoRenderer::shutdown() {
    Impl& impl = *impl_;
    if (impl.context.device() != VK_NULL_HANDLE) vkDeviceWaitIdle(impl.context.device());
    if (impl.sessionActive && impl.engine != nullptr) {
        impl.engine->stopSession();
        impl.sessionActive = false;
    }
    impl.destroyPipelines();
    impl.destroyTargets();
    if (impl.context.device() != VK_NULL_HANDLE) {
        if (impl.cmd != VK_NULL_HANDLE) vkFreeCommandBuffers(impl.context.device(), impl.context.commandPool(), 1, &impl.cmd);
        if (impl.cmdPost != VK_NULL_HANDLE) {
            vkFreeCommandBuffers(impl.context.device(), impl.context.commandPool(), 1, &impl.cmdPost);
        }
        if (impl.frameFence != VK_NULL_HANDLE) vkDestroyFence(impl.context.device(), impl.frameFence, nullptr);
        if (impl.imageAvailable != VK_NULL_HANDLE) {
            vkDestroySemaphore(impl.context.device(), impl.imageAvailable, nullptr);
        }
        if (impl.sceneComplete != VK_NULL_HANDLE) {
            vkDestroySemaphore(impl.context.device(), impl.sceneComplete, nullptr);
        }
        if (impl.presentReady != VK_NULL_HANDLE) {
            vkDestroySemaphore(impl.context.device(), impl.presentReady, nullptr);
        }
        vk::destroyBuffer(impl.context, impl.terrainVb);
        vk::destroyBuffer(impl.context, impl.terrainIb);
        vk::destroyBuffer(impl.context, impl.boxVb);
        vk::destroyBuffer(impl.context, impl.boxIb);
        vk::destroyBuffer(impl.context, impl.sphereVb);
        vk::destroyBuffer(impl.context, impl.sphereIb);
        vk::destroyBuffer(impl.context, impl.quadVb);
        vk::destroyBuffer(impl.context, impl.terrainInstances);
        vk::destroyBuffer(impl.context, impl.buildingInstances);
        vk::destroyBuffer(impl.context, impl.propInstances);
        vk::destroyBuffer(impl.context, impl.movingInstances);
        vk::destroyBuffer(impl.context, impl.uniformBuffer);
        vk::destroyBuffer(impl.context, impl.particleBuffer);
        if (impl.shadowSampler != VK_NULL_HANDLE) vkDestroySampler(impl.context.device(), impl.shadowSampler, nullptr);
        if (impl.enhancedSampler != VK_NULL_HANDLE) vkDestroySampler(impl.context.device(), impl.enhancedSampler, nullptr);
        if (impl.referenceSampler != VK_NULL_HANDLE) vkDestroySampler(impl.context.device(), impl.referenceSampler, nullptr);
        impl.shadowSampler = impl.enhancedSampler = impl.referenceSampler = VK_NULL_HANDLE;
        impl.cmd = impl.cmdPost = VK_NULL_HANDLE;
        impl.frameFence = VK_NULL_HANDLE;
        impl.imageAvailable = impl.sceneComplete = impl.presentReady = VK_NULL_HANDLE;
    }
    vk::destroySwapchain(impl.context, impl.swapchain);
    impl.context.destroy();
    impl.initialised = false;
    impl.sessionActive = false;
}

bool DemoRenderer::initialised() const { return impl_ != nullptr && impl_->initialised; }

bool DemoRenderer::resize(void* nativeWindow, uint32_t width, uint32_t height, std::string* error) {
    Impl& impl = *impl_;
    if (!impl.initialised) {
        if (error != nullptr) *error = "the renderer is not running";
        return false;
    }
    if (width == 0 || height == 0) {
        if (error != nullptr) *error = "a zero-sized surface cannot be rendered into";
        return false;
    }
    impl.window = nativeWindow;
    impl.surfaceWidth = width;
    impl.surfaceHeight = height;
    vkDeviceWaitIdle(impl.context.device());
    if (!vk::recreateSwapchain(impl.context, nativeWindow, impl.swapchain, error)) return false;
    return true;
}

bool DemoRenderer::setConfig(const DemoConfig& config, std::string* error) {
    Impl& impl = *impl_;
    if (!validateDemoConfig(config, error)) return false;

    const DemoConfig previous = impl.config;
    const bool needsRebuild = config.mode != previous.mode || config.renderIndex != previous.renderIndex ||
                              config.outputIndex != previous.outputIndex ||
                              config.quality != previous.quality || config.seed != previous.seed;
    impl.config = config;
    impl.plan = planSession(config);

    if (needsRebuild && impl.initialised) {
        // The scene change may also change buffer sizes, so a seed or quality
        // change rebuilds the buffers too.
        if (config.seed != previous.seed || config.quality != previous.quality) {
            vkDeviceWaitIdle(impl.context.device());
            vk::destroyBuffer(impl.context, impl.terrainVb);
            vk::destroyBuffer(impl.context, impl.terrainIb);
            vk::destroyBuffer(impl.context, impl.boxVb);
            vk::destroyBuffer(impl.context, impl.boxIb);
            vk::destroyBuffer(impl.context, impl.sphereVb);
            vk::destroyBuffer(impl.context, impl.sphereIb);
            vk::destroyBuffer(impl.context, impl.terrainInstances);
            vk::destroyBuffer(impl.context, impl.buildingInstances);
            vk::destroyBuffer(impl.context, impl.propInstances);
            vk::destroyBuffer(impl.context, impl.movingInstances);
            vk::destroyBuffer(impl.context, impl.particleBuffer);

            impl.scene = buildDemoScene(config.seed, config.quality);
            impl.sceneStats = sceneStats(impl.scene);
            if (!impl.createBuffers(error)) return false;
            impl.uploadStaticInstances();
            // Rebuild the targets (sizes changed) and every descriptor set that
            // points at a new image.
            if (!impl.rebuildTargets(error)) return false;
            if (!impl.createDescriptors(error)) return false;
        } else {
            if (!impl.rebuildTargets(error)) return false;
            if (!impl.createDescriptors(error)) return false;
        }
    }
    return true;
}

const DemoConfig& DemoRenderer::config() const { return impl_->config; }

bool DemoRenderer::renderFrame(double deltaSeconds, double timeSeconds, std::string* error) {
    Impl& impl = *impl_;
    if (!impl.initialised) {
        if (error != nullptr) *error = "the renderer is not running";
        return false;
    }
    if (!(deltaSeconds > 0.0) || deltaSeconds > 0.5) {
        // A hitch (or the first frame) must not teleport the simulation; clamp
        // instead of trusting the clock.
        deltaSeconds = 1.0 / 60.0;
    }
    const double frameStart = nowMs();
    impl.time = timeSeconds;
    impl.frameIndex++;

    vkWaitForFences(impl.context.device(), 1, &impl.frameFence, VK_TRUE, UINT64_MAX);
    vkResetFences(impl.context.device(), 1, &impl.frameFence);

    const vk::AcquiredImage acquired =
        vk::acquireNextImage(impl.context, impl.swapchain, impl.imageAvailable, VK_NULL_HANDLE);
    if (acquired.result == VK_ERROR_OUT_OF_DATE_KHR) {
        impl.swapchainDirty = true;
        return vk::recreateSwapchain(impl.context, impl.window, impl.swapchain, error);
    }
    if (acquired.result != VK_SUCCESS && acquired.result != VK_SUBOPTIMAL_KHR) {
        if (error != nullptr) *error = std::string("vkAcquireNextImageKHR failed: ") + vk::resultToString(acquired.result);
        return false;
    }

    // Before anything is recorded: the frame's pre-transitions depend on whether
    // this frame will be upscaled, and the engine's contract is that the low-res
    // image arrives in SHADER_READ_ONLY and the output in GENERAL.
    impl.ensureSession(error);

    impl.updateUniforms();
    impl.updateMovingInstances();

    // ---- command buffer 1: shadow, particles, scene ----
    VkCommandBufferBeginInfo begin{};
    begin.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    if (vkBeginCommandBuffer(impl.cmd, &begin) != VK_SUCCESS) {
        if (error != nullptr) *error = "vkBeginCommandBuffer failed for the demo";
        return false;
    }
    impl.recordParticleSim(impl.cmd, static_cast<float>(deltaSeconds));
    impl.recordShadowPass(impl.cmd);
    if (impl.wantsNativeTarget()) {
        impl.recordScenePass(impl.cmd, impl.nativeImage, impl.nativeFramebuffer);
    } else {
        impl.recordScenePass(impl.cmd, impl.renderImage, impl.sceneFramebuffer);
    }
    if (impl.sessionActive) {
        // The engine samples the low-res image and writes the output as a storage
        // image: both transitions are its documented contract, and they are
        // recorded only on frames that will be upscaled. Doing them on any other
        // frame would leave the low-res image in a layout the scene pass then has
        // to fight its way out of.
        vk::transitionImage(impl.cmd, impl.renderImage, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                            VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT,
                            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
        vk::transitionImage(impl.cmd, impl.enhancedImage, VK_IMAGE_LAYOUT_GENERAL,
                            VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
                            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
    }
    if (vkEndCommandBuffer(impl.cmd) != VK_SUCCESS) {
        if (error != nullptr) *error = "vkEndCommandBuffer failed for the demo";
        return false;
    }

    VkSubmitInfo submit{};
    submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    VkSemaphore waitSemaphores[1] = {impl.imageAvailable};
    VkPipelineStageFlags waitStages[1] = {VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT |
                                          VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT};
    submit.waitSemaphoreCount = 1;
    submit.pWaitSemaphores = waitSemaphores;
    submit.pWaitDstStageMask = waitStages;
    submit.commandBufferCount = 1;
    submit.pCommandBuffers = &impl.cmd;
    VkSemaphore signalSemaphores[1] = {impl.sceneComplete};
    submit.signalSemaphoreCount = 1;
    submit.pSignalSemaphores = signalSemaphores;
    if (vkQueueSubmit(impl.context.graphicsQueue(), 1, &submit, impl.frameFence) != VK_SUCCESS) {
        if (error != nullptr) *error = "vkQueueSubmit failed for the demo scene pass";
        return false;
    }

    // The upscaler runs after the scene is complete: the engine's own fence
    // makes its result available before the present pass samples it.
    if (impl.sessionActive) {
        if (!impl.upscaleFrame(error)) return false;
    } else if (impl.plan.neural && impl.lastError.empty()) {
        // The plan wanted the neural stage but no session is running (no model
        // installed, or the device has no usable backend). Record the reason for
        // the panel and keep rendering what we have: a demo that refuses to draw
        // is worse than one that explains itself.
        impl.lastError =
            "the AI stage is not running, so the comparison shows the low-resolution render: "
            "install a model (AI Engine screen) and check the compatibility status";
    }

    // ---- command buffer 2: present ----
    impl.updatePresentDescriptors();
    if (vkBeginCommandBuffer(impl.cmdPost, &begin) != VK_SUCCESS) {
        if (error != nullptr) *error = "vkBeginCommandBuffer failed for the present pass";
        return false;
    }
    // The present pass *samples* both images, so neither may still be in
    // COLOR_ATTACHMENT_OPTIMAL -- which is exactly where the scene pass leaves the
    // low-res image on a frame with no session running. transitionImage() reads the
    // layout the image is actually tracked in and does nothing when it is already
    // SHADER_READ_ONLY, so this is correct whether or not the engine ran: after an
    // upscale the engine has already put both of its images in that layout.
    vk::transitionImage(impl.cmdPost, impl.enhancedForPresent(),
                        VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                        VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT | VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT |
                            VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT,
                        VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT);
    // The reference is only sampled by the split view, but a descriptor that
    // points at an image in the wrong layout is a validation error either way.
    if (&impl.enhancedForPresent() != &impl.renderImage) {
        vk::transitionImage(impl.cmdPost, impl.renderImage, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                            VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT |
                                VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT,
                            VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT);
    }
    const float clearColor[4] = {0.0f, 0.0f, 0.0f, 1.0f};
    vk::beginRenderPass(impl.cmdPost, impl.swapchain.renderPass,
                        impl.swapchain.framebuffers[acquired.index], impl.swapchain.extent.width,
                        impl.swapchain.extent.height, clearColor, 1.0f);
    vk::setViewport(impl.cmdPost, impl.swapchain.extent.width, impl.swapchain.extent.height, false);
    vkCmdBindPipeline(impl.cmdPost, VK_PIPELINE_BIND_POINT_GRAPHICS, impl.presentPipeline.pipeline);
    vkCmdBindDescriptorSets(impl.cmdPost, VK_PIPELINE_BIND_POINT_GRAPHICS, impl.presentPipeline.layout, 0, 1,
                            &impl.presentSet, 0, nullptr);
    vk::PresentPush present{};
    present.outputSize[0] = static_cast<float>(impl.swapchain.extent.width);
    present.outputSize[1] = static_cast<float>(impl.swapchain.extent.height);
    present.invOutputSize[0] = 1.0f / present.outputSize[0];
    present.invOutputSize[1] = 1.0f / present.outputSize[1];
    // mode: 0 enhanced only, 1 split, 2 reference only, 3 enhanced + magnifier
    present.mode = impl.config.mode == DemoMode::SplitCompare ? 1u : 0u;
    present.splitPosition = impl.config.splitPosition;
    present.magnifierScale = impl.config.magnifierScale;
    present.magnifierCentre[0] = 0.5f;
    present.magnifierCentre[1] = 0.5f;
    present.exposure = 1.0f;
    present.showGrid = 0u;
    present.reserved = 0u;
    vkCmdPushConstants(impl.cmdPost, impl.presentPipeline.layout, VK_SHADER_STAGE_FRAGMENT_BIT, 0,
                       sizeof(present), &present);
    vkCmdDraw(impl.cmdPost, vk::kFullscreenTriangleVertices, 1, 0, 0);
    vkCmdEndRenderPass(impl.cmdPost);
    if (vkEndCommandBuffer(impl.cmdPost) != VK_SUCCESS) {
        if (error != nullptr) *error = "vkEndCommandBuffer failed for the present pass";
        return false;
    }

    // Second submission: wait for the scene pass, signal the presentation engine.
    VkSubmitInfo presentSubmit{};
    presentSubmit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    VkSemaphore presentWait[1] = {impl.sceneComplete};
    VkPipelineStageFlags presentWaitStages[1] = {VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT};
    presentSubmit.waitSemaphoreCount = 1;
    presentSubmit.pWaitSemaphores = presentWait;
    presentSubmit.pWaitDstStageMask = presentWaitStages;
    presentSubmit.commandBufferCount = 1;
    presentSubmit.pCommandBuffers = &impl.cmdPost;
    VkSemaphore presentSignal[1] = {impl.presentReady};
    presentSubmit.signalSemaphoreCount = 1;
    presentSubmit.pSignalSemaphores = presentSignal;
    if (vkQueueSubmit(impl.context.graphicsQueue(), 1, &presentSubmit, VK_NULL_HANDLE) != VK_SUCCESS) {
        if (error != nullptr) *error = "vkQueueSubmit failed for the present pass";
        return false;
    }

    const VkResult presentResult =
        vk::presentImage(impl.context, impl.swapchain, acquired.index, impl.presentReady);
    if (presentResult == VK_ERROR_OUT_OF_DATE_KHR) {
        impl.swapchainDirty = true;
        return vk::recreateSwapchain(impl.context, impl.window, impl.swapchain, error);
    }
    if (presentResult != VK_SUCCESS && presentResult != VK_SUBOPTIMAL_KHR) {
        if (error != nullptr) *error = std::string("vkQueuePresentKHR failed: ") + vk::resultToString(presentResult);
        return false;
    }

    // Wait for the present pass to finish before the caller can rebuild
    // anything; the frame is one in flight by design.
    vkQueueWaitIdle(impl.context.graphicsQueue());

    impl.frameCpuMs = nowMs() - frameStart;
    impl.frameStats.record(impl.frameCpuMs);
    impl.lastPresentMs = impl.frameCpuMs;
    if (impl.comparison.active()) {
        double aiStageMs = kUnavailable;
        if (impl.engine != nullptr && impl.sessionActive) {
            const StageMs& stages = impl.engine->lastStageTimings();
            if (stages.available) aiStageMs = stages.totalMs();
        }
        impl.comparison.recordFrame(impl.frameCpuMs, aiStageMs);
    }
    if (impl.engine != nullptr) {
        // Feed the engine's monitor the frame times this renderer actually
        // measured, so the Monitor screen and the demo report the same reality.
        impl.engine->addFrameSample(impl.frameCpuMs, static_cast<int64_t>(nowMs()), kUnavailable);
    }
    return true;
}

std::string DemoRenderer::statusJson() const {
    const Impl& impl = *impl_;
    const Resolution* rungs = demoResolutions();
    std::string out = "{";
    out += "\"active\":" + std::string(impl.initialised ? "true" : "false");
    out += ",\"mode\":" + quote(demoModeName(impl.config.mode));
    out += ",\"renderResolution\":" + quote(rungs[impl.config.renderIndex].name);
    out += ",\"outputResolution\":" + quote(rungs[impl.config.outputIndex].name);
    out += ",\"renderWidth\":" + std::to_string(rungs[impl.config.renderIndex].width);
    out += ",\"renderHeight\":" + std::to_string(rungs[impl.config.renderIndex].height);
    out += ",\"outputWidth\":" + std::to_string(rungs[impl.config.outputIndex].width);
    out += ",\"outputHeight\":" + std::to_string(rungs[impl.config.outputIndex].height);
    out += ",\"scenePassWidth\":" + std::to_string(impl.sceneWidth());
    out += ",\"scenePassHeight\":" + std::to_string(impl.sceneHeight());
    out += ",\"sessionActive\":" + std::string(impl.sessionActive ? "true" : "false");
    out += ",\"neuralRequested\":" + std::string(impl.plan.neural ? "true" : "false");
    out += ",\"temporalRequested\":" + std::string(impl.plan.temporal ? "true" : "false");
    out += ",\"frames\":" + std::to_string(impl.frameStats.count());
    out += ",\"frameStats\":" + impl.frameStats.toJson();
    out += ",\"magnifierScale\":" + numberOrNull(impl.config.magnifierScale, 2);
    out += ",\"splitPosition\":" + numberOrNull(impl.config.splitPosition, 2);
    out += ",\"particles\":" + std::to_string(impl.particleCapacity);
    out += ",\"shadowMap\":" + std::to_string(impl.shadowExtent());
    out += ",\"scene\":" + impl.sceneStats.toJson();

    if (impl.engine != nullptr) {
        const StageMs& stages = impl.engine->lastStageTimings();
        out += ",\"gpuStages\":{";
        out += "\"available\":" + std::string(stages.available ? "true" : "false");
        out += ",\"preprocessMs\":" + numberOrNull(stages.preprocessMs, 3);
        out += ",\"neuralMs\":" + numberOrNull(stages.neuralMs, 3);
        out += ",\"temporalMs\":" + numberOrNull(stages.temporalMs, 3);
        out += ",\"aaMs\":" + numberOrNull(stages.aaMs, 3);
        out += ",\"sharpenMs\":" + numberOrNull(stages.sharpenMs, 3);
        out += ",\"totalMs\":" + numberOrNull(stages.totalMs(), 3);
        out += "}";
        const SessionStats& session = impl.engine->session();
        out += ",\"session\":{\"active\":" + std::string(session.active ? "true" : "false");
        out += ",\"layers\":" + std::to_string(session.layerCount);
        out += ",\"workingSetBytes\":" + std::to_string(session.workingSetBytes);
        out += ",\"weightBytes\":" + std::to_string(session.weightBytes);
        out += ",\"mode\":" + quote(toString(session.mode));
        if (!session.lastError.empty()) out += ",\"lastError\":" + quote(session.lastError);
        out += "}";
    } else {
        out += ",\"gpuStages\":null";
        out += ",\"session\":null";
    }
    out += ",\"benchmark\":" + benchmarkJson();
    if (!impl.lastError.empty()) out += ",\"lastError\":" + quote(impl.lastError);
    out += ",\"note\":";
    out += quote("every value here was measured on this device; null means it was not available");
    out += "}";
    return out;
}

bool DemoRenderer::beginBenchmark(DemoMode mode, std::string* error) {
    Impl& impl = *impl_;
    if (!impl.initialised) {
        if (error != nullptr) *error = "the renderer is not running";
        return false;
    }
    // The benchmark switches the render path, so the mode has to be applied to
    // the configuration too -- that is what makes the two runs comparable.
    DemoConfig config = impl.config;
    config.mode = mode;
    if (!setConfig(config, error)) return false;
    impl.comparison.beginMode(mode, impl.plan);
    return true;
}

void DemoRenderer::endBenchmark() { impl_->comparison.endMode(); }

std::string DemoRenderer::benchmarkJson() const { return impl_->comparison.toJson(); }

std::string DemoRenderer::sceneJson() const { return impl_->sceneStats.toJson(); }

const char* DemoRenderer::lastError() const { return impl_->lastError.c_str(); }

bool DemoRenderer::sessionActive() const { return impl_->sessionActive; }

DemoMode DemoRenderer::mode() const { return impl_->config.mode; }

}  // namespace demo
}  // namespace v4k

#endif  // V4K_ENABLE_VULKAN
