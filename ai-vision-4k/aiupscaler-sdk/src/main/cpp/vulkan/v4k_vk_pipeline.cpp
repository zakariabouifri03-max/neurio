#include "v4k_vk_pipeline.h"

#if defined(V4K_ENABLE_VULKAN)

#include <algorithm>
#include <cstring>

#include "../core/v4k_log.h"
#include "v4k_shader_registry.h"
#include "v4k_vk_push.h"

namespace v4k {
namespace vk {
namespace {

// Local sizes, kept in sync with the `layout(local_size_...)` lines of the
// shaders. tools/checks/dump-spirv-interface.py prints the emitted values, and
// test_shader_interface.cpp compares them against these constants.
constexpr uint32_t kGroup8 = 8;
constexpr uint32_t kGroup16 = 16;

std::vector<DescriptorBinding> imageBindings(uint32_t count) {
    std::vector<DescriptorBinding> bindings;
    for (uint32_t i = 0; i < count; ++i) {
        bindings.push_back(DescriptorBinding{i, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1,
                                             VK_SHADER_STAGE_COMPUTE_BIT});
    }
    return bindings;
}

void addBinding(std::vector<DescriptorBinding>& bindings, uint32_t binding, VkDescriptorType type) {
    bindings.push_back(DescriptorBinding{binding, type, 1, VK_SHADER_STAGE_COMPUTE_BIT});
}

void addStorageBuffers(std::vector<DescriptorBinding>& bindings, uint32_t first, uint32_t count) {
    for (uint32_t i = 0; i < count; ++i) {
        addBinding(bindings, first + i, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER);
    }
}

// A compute -> compute dependency. Every pass in the chain reads what the
// previous one wrote, so a single full memory barrier between dispatches is both
// correct and cheap (it is a pipeline barrier, not a queue stall).
void computeBarrier(VkCommandBuffer cmd) {
    VkMemoryBarrier barrier{};
    barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_TRANSFER_WRITE_BIT;
    barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &barrier, 0, nullptr, 0,
                         nullptr);
}

uint32_t halfUp(uint32_t value) { return value == 0 ? 1 : (value + 1) / 2; }

}  // namespace

const char* reconstructionModeName(ReconstructionMode mode) {
    switch (mode) {
        case ReconstructionMode::None: return "Idle";
        case ReconstructionMode::Analytical: return "Analytical upscale";
        case ReconstructionMode::Neural: return "AI upscaling";
        case ReconstructionMode::NeuralTemporal: return "AI upscaling + temporal";
        case ReconstructionMode::AnalyticalTemporal: return "Analytical + temporal";
    }
    return "Unknown";
}

double PassTimings::measuredTotalMs() const {
    if (!valid) return kUnavailable;
    double total = 0.0;
    bool any = false;
    const double values[] = {preprocessMs, neuralMs, denoiseMs, temporalMs, aaMs, sharpenMs};
    for (double value : values) {
        if (value >= 0.0) {
            total += value;
            any = true;
        }
    }
    return any ? total : kUnavailable;
}

bool PipelineDesc::operator==(const PipelineDesc& other) const {
    return inputWidth == other.inputWidth && inputHeight == other.inputHeight &&
           outputWidth == other.outputWidth && outputHeight == other.outputHeight &&
           neural == other.neural && temporal == other.temporal && denoise == other.denoise &&
           antiAliasing == other.antiAliasing && sharpening == other.sharpening &&
           denoiseStrength == other.denoiseStrength && aaStrength == other.aaStrength &&
           edgeStrength == other.edgeStrength && detailRecovery == other.detailRecovery &&
           historyWeight == other.historyWeight && clampSigma == other.clampSigma &&
           motionSearchRadius == other.motionSearchRadius &&
           motionMaxVectorLength == other.motionMaxVectorLength &&
           maxWorkingBytes == other.maxWorkingBytes;
}

UpscalePipelineVk::UpscalePipelineVk() = default;
UpscalePipelineVk::~UpscalePipelineVk() { shutdown(); }

// ---------------------------------------------------------------------------
// Lifetime
// ---------------------------------------------------------------------------
bool UpscalePipelineVk::createPass(Pass& pass, const char* shaderName,
                                   const std::vector<DescriptorBinding>& bindings,
                                   uint32_t pushBytes, uint32_t groupSizeX, uint32_t groupSizeY,
                                   std::string* error) {
    const shaders::ShaderBlob blob = shaders::loadShader(shaderName);
    if (!blob.valid()) {
        if (error != nullptr) *error = std::string("shader '") + shaderName + "' is missing";
        return false;
    }
    if (!createComputePipeline(*context_, bindings, pushBytes, blob.words, blob.wordCount,
                               shaderName, pass.pipeline, error)) {
        return false;
    }
    pass.groupSizeX = groupSizeX;
    pass.groupSizeY = groupSizeY;
    pass.pool = createDescriptorPool(*context_, bindings, 1);
    if (pass.pool == VK_NULL_HANDLE) {
        if (error != nullptr) *error = std::string("descriptor pool for ") + shaderName + " failed";
        destroyComputePipeline(*context_, pass.pipeline);
        return false;
    }
    pass.set = allocateDescriptorSet(*context_, pass.pool, pass.pipeline.descriptorSetLayout);
    if (pass.set == VK_NULL_HANDLE) {
        if (error != nullptr) *error = std::string("descriptor set for ") + shaderName + " failed";
        destroyPass(pass);
        return false;
    }
    pass.sampler = createLinearSampler(*context_, true);
    pass.ready = pass.sampler != VK_NULL_HANDLE;
    if (!pass.ready && error != nullptr) {
        *error = std::string("sampler for ") + shaderName + " failed";
    }
    return pass.ready;
}

void UpscalePipelineVk::destroyPass(Pass& pass) {
    if (context_ == nullptr || !context_->valid()) return;
    if (pass.sampler != VK_NULL_HANDLE) {
        vkDestroySampler(context_->device(), pass.sampler, nullptr);
        pass.sampler = VK_NULL_HANDLE;
    }
    if (pass.pool != VK_NULL_HANDLE) {
        vkDestroyDescriptorPool(context_->device(), pass.pool, nullptr);
        pass.pool = VK_NULL_HANDLE;
        pass.set = VK_NULL_HANDLE;
    }
    destroyComputePipeline(*context_, pass.pipeline);
    pass.ready = false;
}

bool UpscalePipelineVk::createImages(std::string* error) {
    const uint32_t inW = desc_.inputWidth;
    const uint32_t inH = desc_.inputHeight;
    const uint32_t outW = desc_.outputWidth;
    const uint32_t outH = desc_.outputHeight;
    const VkImageUsageFlags sampledStorage =
        VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_SAMPLED_BIT;

    const auto fail = [&](const char* what) {
        if (error != nullptr) {
            *error = std::string("could not create the ") + what + " image at " +
                     std::to_string(outW) + "x" + std::to_string(outH);
        }
        return false;
    };

    if (!createImage(*context_, inW, inH, VK_FORMAT_R16G16B16A16_SFLOAT, sampledStorage, colorIn_, error)) {
        return fail("preprocessed colour");
    }
    if (!createImage(*context_, inW, inH, VK_FORMAT_R8G8B8A8_UNORM,
                     sampledStorage | VK_IMAGE_USAGE_TRANSFER_DST_BIT, lumaCurrent_, error)) {
        return fail("luma");
    }
    if (!createImage(*context_, inW, inH, VK_FORMAT_R8G8B8A8_UNORM,
                     sampledStorage | VK_IMAGE_USAGE_TRANSFER_DST_BIT, lumaPrevious_, error)) {
        return fail("previous luma");
    }
    if (!createImage(*context_, halfUp(inW), halfUp(inH), VK_FORMAT_R8G8B8A8_UNORM, sampledStorage,
                     lumaHalfCurrent_, error)) {
        return fail("half resolution luma");
    }
    if (!createImage(*context_, halfUp(inW), halfUp(inH), VK_FORMAT_R8G8B8A8_UNORM, sampledStorage,
                     lumaHalfPrevious_, error)) {
        return fail("half resolution previous luma");
    }
    if (!createImage(*context_, halfUp(inW), halfUp(inH), VK_FORMAT_R16G16B16A16_SFLOAT, sampledStorage, motion_,
                     error)) {
        return fail("motion vector");
    }
    if (!createImage(*context_, outW, outH, VK_FORMAT_R16G16B16A16_SFLOAT, sampledStorage, historyA_, error)) {
        return fail("history");
    }
    if (!createImage(*context_, outW, outH, VK_FORMAT_R16G16B16A16_SFLOAT, sampledStorage, historyB_, error)) {
        return fail("history (second buffer)");
    }
    if (!createImage(*context_, outW, outH, VK_FORMAT_R16G16B16A16_SFLOAT, sampledStorage, highA_, error)) {
        return fail("reconstruction target");
    }
    if (!createImage(*context_, outW, outH, VK_FORMAT_R16G16B16A16_SFLOAT, sampledStorage, highB_, error)) {
        return fail("reconstruction target (second buffer)");
    }
    return true;
}

void UpscalePipelineVk::destroyImages() {
    destroyImage(*context_, colorIn_);
    destroyImage(*context_, lumaCurrent_);
    destroyImage(*context_, lumaPrevious_);
    destroyImage(*context_, lumaHalfCurrent_);
    destroyImage(*context_, lumaHalfPrevious_);
    destroyImage(*context_, motion_);
    destroyImage(*context_, historyA_);
    destroyImage(*context_, historyB_);
    destroyImage(*context_, highA_);
    destroyImage(*context_, highB_);
}

bool UpscalePipelineVk::init(Context& context, const PipelineDesc& desc, std::string* error) {
    shutdown();
    context_ = &context;
    desc_ = desc;
    error_.clear();

    if (!context.valid()) {
        error_ = "the Vulkan device is not ready";
        if (error != nullptr) *error = error_;
        return false;
    }
    if (desc_.inputWidth == 0 || desc_.inputHeight == 0 || desc_.outputWidth == 0 ||
        desc_.outputHeight == 0) {
        error_ = "invalid frame geometry";
        if (error != nullptr) *error = error_;
        return false;
    }

    if (!createImages(error)) {
        error_ = error != nullptr ? *error : "image creation failed";
        shutdown();
        return false;
    }

    std::vector<DescriptorBinding> bindings;

    // preprocess_luma.comp: sampler + rgba8 luma out + rgba16f colour out
    bindings.clear();
    addBinding(bindings, 0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER);
    addBinding(bindings, 1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE);
    addBinding(bindings, 2, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE);
    if (!createPass(preprocess_, "preprocess_luma.comp", bindings, sizeof(PreprocessPush), kGroup8,
                    kGroup8, error)) {
        error_ = error != nullptr ? *error : "preprocess pipeline failed";
        shutdown();
        return false;
    }

    // downsample.comp: sampler + rgba8 storage
    bindings.clear();
    addBinding(bindings, 0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER);
    addBinding(bindings, 1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE);
    if (!createPass(downsample_, "downsample.comp", bindings, sizeof(DownsamplePush), kGroup8,
                    kGroup8, error)) {
        error_ = error != nullptr ? *error : "downsample pipeline failed";
        shutdown();
        return false;
    }

    // motion_estimate.comp: two samplers + one storage image
    bindings.clear();
    addBinding(bindings, 0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER);
    addBinding(bindings, 1, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER);
    addBinding(bindings, 2, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE);
    if (!createPass(motionEstimate_, "motion_estimate.comp", bindings, sizeof(MotionEstimatePush),
                    kGroup16, kGroup16, error)) {
        error_ = error != nullptr ? *error : "motion estimation pipeline failed";
        shutdown();
        return false;
    }

    // edge_reconstruct.comp (analytical fallback)
    bindings.clear();
    addBinding(bindings, 0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER);
    addBinding(bindings, 1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE);
    if (!createPass(edgeReconstruct_, "edge_reconstruct.comp", bindings, sizeof(EdgeReconstructPush),
                    kGroup8, kGroup8, error)) {
        error_ = error != nullptr ? *error : "edge reconstruction pipeline failed";
        shutdown();
        return false;
    }

    // temporal_accum.comp: four samplers + two storage images
    bindings.clear();
    for (uint32_t i = 0; i < 4; ++i) {
        addBinding(bindings, i, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER);
    }
    addBinding(bindings, 4, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE);
    addBinding(bindings, 5, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE);
    if (!createPass(temporalAccum_, "temporal_accum.comp", bindings, sizeof(TemporalAccumPush),
                    kGroup8, kGroup8, error)) {
        error_ = error != nullptr ? *error : "temporal reconstruction pipeline failed";
        shutdown();
        return false;
    }

    // aa_resolve.comp / sharpen.comp / denoise.comp: sampler + storage image
    const auto createFilterPass = [&](Pass& pass, const char* name, uint32_t pushBytes) {
        std::vector<DescriptorBinding> local;
        addBinding(local, 0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER);
        addBinding(local, 1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE);
        return createPass(pass, name, local, pushBytes, kGroup8, kGroup8, error);
    };
    if (!createFilterPass(aaResolve_, "aa_resolve.comp", sizeof(AaResolvePush))) {
        error_ = error != nullptr ? *error : "anti-aliasing pipeline failed";
        shutdown();
        return false;
    }
    if (!createFilterPass(sharpen_, "sharpen.comp", sizeof(SharpenPush))) {
        error_ = error != nullptr ? *error : "sharpening pipeline failed";
        shutdown();
        return false;
    }
    if (!createFilterPass(denoise_, "denoise.comp", sizeof(DenoisePush))) {
        error_ = error != nullptr ? *error : "denoise pipeline failed";
        shutdown();
        return false;
    }

    // Neural boundary + layer passes.
    bindings.clear();
    addBinding(bindings, 0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER);
    addStorageBuffers(bindings, 1, 1);
    if (!createPass(imageToPlanar_, "image_to_planar.comp", bindings, sizeof(ImageToPlanarPush),
                    kGroup8, kGroup8, error)) {
        error_ = error != nullptr ? *error : "tensor conversion pipeline failed";
        shutdown();
        return false;
    }

    bindings.clear();
    addStorageBuffers(bindings, 0, 1);
    addBinding(bindings, 1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE);
    if (!createPass(planarToImage_, "planar_to_image.comp", bindings, sizeof(PlanarToImagePush),
                    kGroup8, kGroup8, error)) {
        error_ = error != nullptr ? *error : "tensor output pipeline failed";
        shutdown();
        return false;
    }

    bindings.clear();
    addBinding(bindings, 0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER);
    addStorageBuffers(bindings, 1, 1);
    if (!createPass(bicubicResidual_, "bicubic_residual.comp", bindings,
                    sizeof(BicubicResidualPush), kGroup8, kGroup8, error)) {
        error_ = error != nullptr ? *error : "residual pipeline failed";
        shutdown();
        return false;
    }

    bindings.clear();
    addStorageBuffers(bindings, 0, 4);
    if (!createPass(neuralConv_, "sr_conv.comp", bindings, sizeof(SrConvPush), kGroup8, kGroup8,
                    error)) {
        error_ = error != nullptr ? *error : "convolution pipeline failed";
        shutdown();
        return false;
    }

    bindings.clear();
    addStorageBuffers(bindings, 0, 3);
    if (!createPass(neuralShuffle_, "pixel_shuffle.comp", bindings, sizeof(PixelShufflePush),
                    kGroup8, kGroup8, error)) {
        error_ = error != nullptr ? *error : "pixel shuffle pipeline failed";
        shutdown();
        return false;
    }

    bindings.clear();
    addStorageBuffers(bindings, 0, 3);
    if (!createPass(neuralElementwise_, "elementwise.comp", bindings, sizeof(ElementwisePush),
                    kGroup8, kGroup8, error)) {
        error_ = error != nullptr ? *error : "element-wise pipeline failed";
        shutdown();
        return false;
    }

    bindings.clear();
    addStorageBuffers(bindings, 0, 3);
    if (!createPass(neuralPrelu_, "prelu.comp", bindings, sizeof(PreluPush), kGroup8, kGroup8,
                    error)) {
        error_ = error != nullptr ? *error : "PReLU pipeline failed";
        shutdown();
        return false;
    }

    timestamps_.init(context, kTimingCount, nullptr);

    initialised_ = true;
    V4K_LOGI("pipeline ready: %ux%u -> %ux%u, %s", desc_.inputWidth, desc_.inputHeight,
             desc_.outputWidth, desc_.outputHeight,
             desc_.temporal ? "temporal reconstruction on" : "temporal reconstruction off");
    if (error != nullptr) error->clear();
    return true;
}

void UpscalePipelineVk::shutdown() {
    if (context_ != nullptr && context_->valid()) {
        vkDeviceWaitIdle(context_->device());
        timestamps_.destroy(*context_);
        destroyNeuralResources();
        destroyPass(preprocess_);
        destroyPass(downsample_);
        destroyPass(motionEstimate_);
        destroyPass(edgeReconstruct_);
        destroyPass(temporalAccum_);
        destroyPass(aaResolve_);
        destroyPass(sharpen_);
        destroyPass(denoise_);
        destroyPass(imageToPlanar_);
        destroyPass(planarToImage_);
        destroyPass(bicubicResidual_);
        destroyPass(neuralConv_);
        destroyPass(neuralShuffle_);
        destroyPass(neuralElementwise_);
        destroyPass(neuralPrelu_);
        destroyImages();
    }
    context_ = nullptr;
    initialised_ = false;
    neuralReady_ = false;
    mode_ = ReconstructionMode::None;
}

// ---------------------------------------------------------------------------
// Neural resources
// ---------------------------------------------------------------------------
void UpscalePipelineVk::destroyNeuralResources() {
    if (context_ == nullptr || !context_->valid()) return;
    vkDeviceWaitIdle(context_->device());
    for (Buffer& buffer : tensorBuffers_) destroyBuffer(*context_, buffer);
    tensorBuffers_.clear();
    for (Buffer& buffer : weightBuffers_) destroyBuffer(*context_, buffer);
    weightBuffers_.clear();
    for (Buffer& buffer : biasBuffers_) destroyBuffer(*context_, buffer);
    biasBuffers_.clear();
    destroyBuffer(*context_, skipOutput_);
    if (neuralPool_ != VK_NULL_HANDLE) {
        vkDestroyDescriptorPool(context_->device(), neuralPool_, nullptr);
        neuralPool_ = VK_NULL_HANDLE;
    }
    layerSets_.clear();
    if (pointSampler_ != VK_NULL_HANDLE) {
        vkDestroySampler(context_->device(), pointSampler_, nullptr);
        pointSampler_ = VK_NULL_HANDLE;
    }
    neuralReady_ = false;
    plan_ = GpuPlan{};
}

bool UpscalePipelineVk::buildNeuralResources(const Model& model, std::string* error) {
    destroyNeuralResources();

    if (!buildGpuPlan(model, desc_.inputWidth, desc_.inputHeight, desc_.maxWorkingBytes, plan_,
                      error)) {
        error_ = error != nullptr ? *error : "the model does not fit this resolution";
        return false;
    }
    for (const std::string& warning : plan_.warnings) {
        V4K_LOGW("model plan: %s", warning.c_str());
    }

    pointSampler_ = createNearestSampler(*context_);
    if (pointSampler_ == VK_NULL_HANDLE) {
        error_ = "could not create the tensor sampler";
        if (error != nullptr) *error = error_;
        return false;
    }

    // One storage buffer per tensor slot.
    tensorBuffers_.resize(plan_.slots.size());
    for (size_t i = 0; i < plan_.slots.size(); ++i) {
        const TensorShape& shape = plan_.slots[i];
        if (!createBuffer(*context_, shape.bytes(),
                          VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
                          VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, tensorBuffers_[i], error)) {
            error_ = error != nullptr ? *error : "tensor buffer allocation failed";
            destroyNeuralResources();
            return false;
        }
    }

    if (plan_.appliesGlobalResidual) {
        if (!createBuffer(*context_, plan_.output.bytes(),
                          VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
                          VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, skipOutput_, error)) {
            error_ = error != nullptr ? *error : "residual buffer allocation failed";
            destroyNeuralResources();
            return false;
        }
    }

    // Weights and biases: mapped, host coherent buffers. A model is a few
    // hundred kilobytes, so the extra memory type is not worth a staging pass.
    weightBuffers_.resize(plan_.layers.size());
    biasBuffers_.resize(plan_.layers.size());
    for (size_t i = 0; i < plan_.layers.size(); ++i) {
        const LayerPlan& layer = plan_.layers[i];
        const ModelOp& op = model.ops[i];
        if (!op.weights.empty()) {
            const VkDeviceSize bytes = op.weights.size() * sizeof(float);
            if (!createBuffer(*context_, bytes, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT,
                              VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                                  VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                              weightBuffers_[i], error) ||
                !uploadToBuffer(*context_, weightBuffers_[i], op.weights.data(), bytes)) {
                error_ = "could not upload the weights of layer " + std::to_string(i);
                if (error != nullptr) *error = error_;
                destroyNeuralResources();
                return false;
            }
        }
        if (layer.biasCount > 0) {
            const VkDeviceSize bytes = op.bias.size() * sizeof(float);
            if (!createBuffer(*context_, bytes, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT,
                              VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                                  VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                              biasBuffers_[i], error) ||
                !uploadToBuffer(*context_, biasBuffers_[i], op.bias.data(), bytes)) {
                error_ = "could not upload the biases of layer " + std::to_string(i);
                if (error != nullptr) *error = error_;
                destroyNeuralResources();
                return false;
            }
        }
    }

    // Descriptor sets: four storage buffers for a convolution, three for the
    // other layer types.
    VkDescriptorPoolSize sizes[1];
    sizes[0].type = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    sizes[0].descriptorCount = static_cast<uint32_t>(plan_.layers.size() * 4 + 4);
    VkDescriptorPoolCreateInfo poolInfo{};
    poolInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    poolInfo.maxSets = static_cast<uint32_t>(plan_.layers.size() + 4);
    poolInfo.poolSizeCount = 1;
    poolInfo.pPoolSizes = sizes;
    if (vkCreateDescriptorPool(context_->device(), &poolInfo, nullptr, &neuralPool_) !=
        VK_SUCCESS) {
        error_ = "could not create the model descriptor pool";
        if (error != nullptr) *error = error_;
        destroyNeuralResources();
        return false;
    }

    layerSets_.resize(plan_.layers.size(), VK_NULL_HANDLE);
    for (size_t i = 0; i < plan_.layers.size(); ++i) {
        const LayerPlan& layer = plan_.layers[i];
        const ComputePipeline* pipeline = nullptr;
        switch (layer.type) {
            case ModelOpType::Conv2d:
            case ModelOpType::DepthwiseConv2d: pipeline = &neuralConv_.pipeline; break;
            case ModelOpType::PixelShuffle: pipeline = &neuralShuffle_.pipeline; break;
            case ModelOpType::Add:
            case ModelOpType::ConcatInput: pipeline = &neuralElementwise_.pipeline; break;
            case ModelOpType::PReLU: pipeline = &neuralPrelu_.pipeline; break;
        }
        if (pipeline == nullptr) {
            error_ = "layer " + std::to_string(i) + " has no pipeline";
            if (error != nullptr) *error = error_;
            destroyNeuralResources();
            return false;
        }
        layerSets_[i] = allocateDescriptorSet(*context_, neuralPool_, pipeline->descriptorSetLayout);
        if (layerSets_[i] == VK_NULL_HANDLE) {
            error_ = "could not allocate the descriptor set of layer " + std::to_string(i);
            if (error != nullptr) *error = error_;
            destroyNeuralResources();
            return false;
        }
        const VkDevice device = context_->device();
        const VkBuffer inputBuffer = tensorBuffers_[static_cast<size_t>(layer.inputSlot)].buffer;
        const VkBuffer outputBuffer = tensorBuffers_[static_cast<size_t>(layer.outputSlot)].buffer;
        const VkDeviceSize inputBytes = plan_.slots[static_cast<size_t>(layer.inputSlot)].bytes();
        const VkDeviceSize outputBytes = plan_.slots[static_cast<size_t>(layer.outputSlot)].bytes();

        switch (layer.type) {
            case ModelOpType::Conv2d:
            case ModelOpType::DepthwiseConv2d: {
                writeStorageBuffer(device, layerSets_[i], 0, weightBuffers_[i].buffer,
                                   weightBuffers_[i].size);
                // The bias binding must exist even for a bias-less layer; point
                // it at the weight buffer in that case (never read).
                const VkBuffer biasBuffer = biasBuffers_[i].valid() ? biasBuffers_[i].buffer
                                                                    : weightBuffers_[i].buffer;
                const VkDeviceSize biasBytes =
                    biasBuffers_[i].valid() ? biasBuffers_[i].size : weightBuffers_[i].size;
                writeStorageBuffer(device, layerSets_[i], 1, biasBuffer, biasBytes);
                writeStorageBuffer(device, layerSets_[i], 2, inputBuffer, inputBytes);
                writeStorageBuffer(device, layerSets_[i], 3, outputBuffer, outputBytes);
                break;
            }
            case ModelOpType::PixelShuffle: {
                const VkBuffer residual = plan_.residualSlot >= 0
                    ? tensorBuffers_[static_cast<size_t>(plan_.residualSlot)].buffer
                    : outputBuffer;
                writeStorageBuffer(device, layerSets_[i], 0, inputBuffer, inputBytes);
                writeStorageBuffer(device, layerSets_[i], 1, outputBuffer, outputBytes);
                writeStorageBuffer(device, layerSets_[i], 2, residual,
                                   plan_.residualSlot >= 0
                                       ? plan_.slots[static_cast<size_t>(plan_.residualSlot)].bytes()
                                       : outputBytes);
                break;
            }
            case ModelOpType::PReLU: {
                writeStorageBuffer(device, layerSets_[i], 0, inputBuffer, inputBytes);
                writeStorageBuffer(device, layerSets_[i], 1, weightBuffers_[i].buffer,
                                   weightBuffers_[i].size);
                writeStorageBuffer(device, layerSets_[i], 2, outputBuffer, outputBytes);
                break;
            }
            case ModelOpType::Add:
            case ModelOpType::ConcatInput: {
                const int32_t secondSlot = layer.input2Slot >= 0 ? layer.input2Slot
                                                                 : layer.inputSlot;
                writeStorageBuffer(device, layerSets_[i], 0, inputBuffer, inputBytes);
                writeStorageBuffer(device, layerSets_[i], 1,
                                   tensorBuffers_[static_cast<size_t>(secondSlot)].buffer,
                                   plan_.slots[static_cast<size_t>(secondSlot)].bytes());
                writeStorageBuffer(device, layerSets_[i], 2, outputBuffer, outputBytes);
                break;
            }
        }
    }

    neuralReady_ = true;
    V4K_LOGI("model ready: %u layers, working set %.1f MB, weights %.1f KB", plan_.stats.layerCount,
             static_cast<double>(plan_.stats.featureBytes) / (1024.0 * 1024.0),
             static_cast<double>(plan_.stats.weightBytes) / 1024.0);
    if (error != nullptr) error->clear();
    return true;
}

bool UpscalePipelineVk::setModel(const Model* model, std::string* error) {
    if (!initialised_) {
        error_ = "the pipeline is not initialised";
        if (error != nullptr) *error = error_;
        return false;
    }
    if (model == nullptr || model->ops.empty()) {
        desc_.neural = false;
        destroyNeuralResources();
        if (error != nullptr) error->clear();
        return true;
    }
    if (!buildNeuralResources(*model, error)) {
        // Fall back to the analytical path: an installed model that cannot run
        // at this resolution must not stop the user from playing.
        desc_.neural = false;
        V4K_LOGW("falling back to analytical upscaling: %s", error_.c_str());
        return false;
    }
    desc_.neural = true;
    return true;
}

bool UpscalePipelineVk::setDescriptor(const PipelineDesc& desc, std::string* error) {
    const bool geometryChanged = desc.inputWidth != desc_.inputWidth ||
                                 desc.inputHeight != desc_.inputHeight ||
                                 desc.outputWidth != desc_.outputWidth ||
                                 desc.outputHeight != desc_.outputHeight;
    const bool budgetChanged = desc.maxWorkingBytes != desc_.maxWorkingBytes;
    const bool filtersChanged = desc.temporal != desc_.temporal || desc.denoise != desc_.denoise ||
                                desc.antiAliasing != desc_.antiAliasing ||
                                desc.sharpening != desc_.sharpening ||
                                desc.edgeStrength != desc_.edgeStrength ||
                                desc.motionSearchRadius != desc_.motionSearchRadius;

    if (!geometryChanged && !budgetChanged && !filtersChanged) {
        const bool wasNeural = desc_.neural;
        desc_ = desc;               // keep caller supplied flags (e.g. neural on/off)
        desc_.neural = wasNeural && desc.neural;
        if (error != nullptr) error->clear();
        return true;
    }

    // Geometry changes need new images; the model has to be re-planned because
    // every activation tensor changes size. The caller re-installs the model.
    Context* context = context_;
    Model keepModel;
    const bool hadModel = neuralReady_;
    if (hadModel) {
        // We only keep the *plan*, not the graph: the caller is expected to call
        // setModel() again after a geometry change. Keep the descriptor but drop
        // the neural resources so nothing is silently stale.
        destroyNeuralResources();
    }
    PipelineDesc next = desc;
    next.neural = false;
    shutdown();
    const bool ok = init(*context, next, error);
    desc_ = next;
    if (!ok) return false;
    if (hadModel) {
        V4K_LOGW("the frame geometry changed: reinstall the AI model to re-enable neural upscaling");
    }
    return true;
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------
void UpscalePipelineVk::beginTiming(VkCommandBuffer cmd, uint32_t index) {
    if (timestamps_.available()) timestamps_.writeStart(cmd, index);
}

void UpscalePipelineVk::endTiming(VkCommandBuffer cmd, uint32_t index) {
    if (timestamps_.available()) timestamps_.writeEnd(cmd, index);
}

bool UpscalePipelineVk::recordNeural(VkCommandBuffer cmd, Image* target) {
    if (!neuralReady_ || target == nullptr) return false;

    // 1. low-res image -> planar float tensor
    ImageToPlanarPush toTensor{};
    toTensor.width = plan_.inputWidth;
    toTensor.height = plan_.inputHeight;
    toTensor.channels = plan_.slots[0].channels;
    toTensor.flags = plan_.slots[0].channels == 1 ? 1u : 0u;
    toTensor.inputSize[0] = static_cast<float>(plan_.inputWidth);
    toTensor.inputSize[1] = static_cast<float>(plan_.inputHeight);
    toTensor.scale = 1.0f;
    {
        const VkDevice device = context_->device();
        writeCombinedSampler(device, imageToPlanar_.set, 0, colorIn_.view, imageToPlanar_.sampler);
        writeStorageBuffer(device, imageToPlanar_.set, 1, tensorBuffers_[0].buffer,
                           tensorBuffers_[0].size);
        uint32_t gx = 0, gy = 0;
        computeGroupCount(plan_.inputWidth, plan_.inputHeight, imageToPlanar_.groupSizeX,
                          imageToPlanar_.groupSizeY, gx, gy);
        recordDispatch(cmd, imageToPlanar_.pipeline, imageToPlanar_.set, gx, gy, 1, &toTensor,
                       sizeof(toTensor));
    }
    computeBarrier(cmd);

    // 2. the graph itself
    for (size_t i = 0; i < plan_.layers.size(); ++i) {
        const LayerPlan& layer = plan_.layers[i];
        switch (layer.type) {
            case ModelOpType::Conv2d:
            case ModelOpType::DepthwiseConv2d: {
                SrConvPush push{};
                push.inW = layer.input.width;
                push.inH = layer.input.height;
                push.outW = layer.output.width;
                push.outH = layer.output.height;
                push.inC = layer.input.channels;
                push.outC = layer.output.channels;
                push.kernel = layer.kernel;
                push.pad = layer.padding;
                push.stride = layer.stride;
                push.activation = static_cast<uint32_t>(layer.activation);
                push.depthwise = layer.type == ModelOpType::DepthwiseConv2d ? 1u : 0u;
                uint32_t gx = 0, gy = 0;
                computeGroupCount(layer.output.width, layer.output.height, neuralConv_.groupSizeX,
                                  neuralConv_.groupSizeY, gx, gy);
                recordDispatch(cmd, neuralConv_.pipeline, layerSets_[i], gx, gy, 1, &push,
                               sizeof(push));
                break;
            }
            case ModelOpType::PixelShuffle: {
                PixelShufflePush push{};
                push.inW = layer.input.width;
                push.inH = layer.input.height;
                push.channels = layer.output.channels;
                push.scale = layer.output.width / std::max(1u, layer.input.width);
                push.addResidual = 0;
                uint32_t gx = 0, gy = 0;
                computeGroupCount(layer.output.width, layer.output.height, neuralShuffle_.groupSizeX,
                                  neuralShuffle_.groupSizeY, gx, gy);
                recordDispatch(cmd, neuralShuffle_.pipeline, layerSets_[i], gx, gy, 1, &push,
                               sizeof(push));
                break;
            }
            case ModelOpType::Add: {
                ElementwisePush push{};
                push.width = layer.output.width;
                push.height = layer.output.height;
                push.channels = layer.output.channels;
                push.bChannels = layer.output.channels;
                push.mode = 0;   // add
                uint32_t gx = 0, gy = 0;
                computeGroupCount(layer.output.width, layer.output.height,
                                  neuralElementwise_.groupSizeX, neuralElementwise_.groupSizeY, gx,
                                  gy);
                recordDispatch(cmd, neuralElementwise_.pipeline, layerSets_[i], gx, gy, 1, &push,
                               sizeof(push));
                break;
            }
            case ModelOpType::ConcatInput: {
                ElementwisePush push{};
                push.width = layer.output.width;
                push.height = layer.output.height;
                push.channels = layer.output.channels;
                push.aChannels = layer.input.channels;
                push.mode = 4;   // concat
                uint32_t gx = 0, gy = 0;
                computeGroupCount(layer.output.width, layer.output.height,
                                  neuralElementwise_.groupSizeX, neuralElementwise_.groupSizeY, gx,
                                  gy);
                recordDispatch(cmd, neuralElementwise_.pipeline, layerSets_[i], gx, gy, 1, &push,
                               sizeof(push));
                break;
            }
            case ModelOpType::PReLU: {
                PreluPush push{};
                push.width = layer.output.width;
                push.height = layer.output.height;
                push.channels = layer.output.channels;
                push.slopeCount = 1;   // the plan validated the slope buffer size
                uint32_t gx = 0, gy = 0;
                computeGroupCount(layer.output.width, layer.output.height, neuralPrelu_.groupSizeX,
                                  neuralPrelu_.groupSizeY, gx, gy);
                recordDispatch(cmd, neuralPrelu_.pipeline, layerSets_[i], gx, gy, 1, &push,
                               sizeof(push));
                break;
            }
        }
        computeBarrier(cmd);
    }

    // 3. global residual + tensor -> image
    const int32_t lastSlot = plan_.layers.empty() ? 0 : plan_.layers.back().outputSlot;
    VkBuffer finalTensor = tensorBuffers_[static_cast<size_t>(lastSlot)].buffer;
    VkDeviceSize finalBytes = tensorBuffers_[static_cast<size_t>(lastSlot)].size;
    if (plan_.appliesGlobalResidual && plan_.residualSlot >= 0) {
        BicubicResidualPush residual{};
        residual.outW = plan_.output.width;
        residual.outH = plan_.output.height;
        residual.channels = plan_.output.channels;
        residual.flags = 1;   // clamp, same as the CPU interpreter's output contract
        residual.inputSize[0] = static_cast<float>(desc_.inputWidth);
        residual.inputSize[1] = static_cast<float>(desc_.inputHeight);
        const VkDevice device = context_->device();
        writeCombinedSampler(device, bicubicResidual_.set, 0, colorIn_.view,
                             bicubicResidual_.sampler);
        writeStorageBuffer(device, bicubicResidual_.set, 1,
                           tensorBuffers_[static_cast<size_t>(plan_.residualSlot)].buffer,
                           tensorBuffers_[static_cast<size_t>(plan_.residualSlot)].size);
        uint32_t gx = 0, gy = 0;
        computeGroupCount(plan_.output.width, plan_.output.height, bicubicResidual_.groupSizeX,
                          bicubicResidual_.groupSizeY, gx, gy);
        recordDispatch(cmd, bicubicResidual_.pipeline, bicubicResidual_.set, gx, gy, 1, &residual,
                       sizeof(residual));
        computeBarrier(cmd);

        // Skip add: residual + network output.
        ElementwisePush add{};
        add.width = plan_.output.width;
        add.height = plan_.output.height;
        add.channels = plan_.output.channels;
        add.bChannels = plan_.output.channels;
        add.mode = 0;
        // The pool was sized with a few spare sets exactly for this pass.
        VkDescriptorSet skipSet =
            allocateDescriptorSet(*context_, neuralPool_,
                                  neuralElementwise_.pipeline.descriptorSetLayout);
        if (skipSet == VK_NULL_HANDLE) {
            V4K_LOGE("no descriptor set left for the residual skip add");
            return false;
        }
        writeStorageBuffer(device, skipSet, 0,
                           tensorBuffers_[static_cast<size_t>(plan_.residualSlot)].buffer,
                           tensorBuffers_[static_cast<size_t>(plan_.residualSlot)].size);
        writeStorageBuffer(device, skipSet, 1, finalTensor, finalBytes);
        writeStorageBuffer(device, skipSet, 2, skipOutput_.buffer, skipOutput_.size);
        uint32_t sx = 0, sy = 0;
        computeGroupCount(plan_.output.width, plan_.output.height, neuralElementwise_.groupSizeX,
                          neuralElementwise_.groupSizeY, sx, sy);
        recordDispatch(cmd, neuralElementwise_.pipeline, skipSet, sx, sy, 1, &add, sizeof(add));
        computeBarrier(cmd);
        finalTensor = skipOutput_.buffer;
        finalBytes = skipOutput_.size;
    }

    PlanarToImagePush toImage{};
    toImage.width = plan_.output.width;
    toImage.height = plan_.output.height;
    toImage.channels = std::min(3u, plan_.output.channels);
    toImage.writeAlpha = 1;
    toImage.gain = 1.0f;
    toImage.flags = 1;   // clamp to [0,1]
    {
        const VkDevice device = context_->device();
        writeStorageBuffer(device, planarToImage_.set, 0, finalTensor, finalBytes);
        writeStorageImage(device, planarToImage_.set, 1, target->view);
        uint32_t gx = 0, gy = 0;
        computeGroupCount(plan_.output.width, plan_.output.height, planarToImage_.groupSizeX,
                          planarToImage_.groupSizeY, gx, gy);
        recordDispatch(cmd, planarToImage_.pipeline, planarToImage_.set, gx, gy, 1, &toImage,
                       sizeof(toImage));
    }
    return true;
}

bool UpscalePipelineVk::recordAnalytical(VkCommandBuffer cmd, const FrameInputVk& frame, Image* target) {
    (void)frame;
    EdgeReconstructPush push{};
    push.inputSize[0] = static_cast<float>(desc_.inputWidth);
    push.inputSize[1] = static_cast<float>(desc_.inputHeight);
    push.outputSize[0] = static_cast<float>(desc_.outputWidth);
    push.outputSize[1] = static_cast<float>(desc_.outputHeight);
    push.edgeStrength = desc_.edgeStrength;
    push.sharpening = 0.0f;   // sharpening is its own pass, do not do it twice
    push.detailRecovery = desc_.detailRecovery;
    push.flags = 0;

    const VkDevice device = context_->device();
    writeCombinedSampler(device, edgeReconstruct_.set, 0, colorIn_.view, edgeReconstruct_.sampler);
    writeStorageImage(device, edgeReconstruct_.set, 1, target->view);
    uint32_t gx = 0, gy = 0;
    computeGroupCount(desc_.outputWidth, desc_.outputHeight, edgeReconstruct_.groupSizeX,
                      edgeReconstruct_.groupSizeY, gx, gy);
    recordDispatch(cmd, edgeReconstruct_.pipeline, edgeReconstruct_.set, gx, gy, 1, &push,
                   sizeof(push));
    return true;
}

bool UpscalePipelineVk::recordPost(VkCommandBuffer cmd, const FrameInputVk& frame, Image* from,
                                   Image* output, PassTimings* timings) {
    Image* current = from;
    const VkDevice device = context_->device();

    // The list of enabled post passes, so the last one can be aimed straight at
    // the caller's output image (no trailing copy on the critical path).
    struct PostPass {
        int kind;   // 0 denoise, 1 temporal, 2 aa, 3 sharpen
    };
    std::vector<PostPass> passes;
    if (desc_.denoise) passes.push_back({0});
    if (desc_.temporal) passes.push_back({1});
    if (desc_.antiAliasing) passes.push_back({2});
    if (desc_.sharpening > 0.001f) passes.push_back({3});
    if (passes.empty()) return true;

    // The reconstruction pass left its target as a storage image in GENERAL; the
    // first post pass samples it, so the transition below moves it to
    // SHADER_READ_ONLY (transitionImage is a no-op when it already is).
    VkImageLayout srcLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    for (size_t index = 0; index < passes.size(); ++index) {
        const bool last = index + 1 == passes.size();
        // 0 denoise, 1 temporal, 2 aa, 3 sharpen -> timestamp slots 2, 3, 4, 5.
        const uint32_t timingIndex = 2 + static_cast<uint32_t>(passes[index].kind);
        beginTiming(cmd, timingIndex);
        Image* dst = last ? output : (current == &highA_ ? &highB_ : &highA_);
        if (dst == current) dst = (current == &highA_ ? &highB_ : &highA_);

        transitionImage(cmd, *current, srcLayout, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
        transitionImage(cmd, *dst, VK_IMAGE_LAYOUT_GENERAL, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);

        switch (passes[index].kind) {
            case 0: {   // denoise
                DenoisePush push{};
                push.size[0] = static_cast<float>(desc_.outputWidth);
                push.size[1] = static_cast<float>(desc_.outputHeight);
                push.invSize[0] = 1.0f / static_cast<float>(desc_.outputWidth);
                push.invSize[1] = 1.0f / static_cast<float>(desc_.outputHeight);
                push.strength = desc_.denoiseStrength;
                push.lumaSigma = 0.06f;
                push.passIndex = 0;
                writeCombinedSampler(device, denoise_.set, 0, current->view, denoise_.sampler);
                writeStorageImage(device, denoise_.set, 1, dst->view);
                uint32_t gx = 0, gy = 0;
                computeGroupCount(desc_.outputWidth, desc_.outputHeight, denoise_.groupSizeX,
                                  denoise_.groupSizeY, gx, gy);
                recordDispatch(cmd, denoise_.pipeline, denoise_.set, gx, gy, 1, &push, sizeof(push));
                break;
            }
            case 1: {   // temporal reconstruction
                TemporalAccumPush push{};
                push.outputSize[0] = static_cast<float>(desc_.outputWidth);
                push.outputSize[1] = static_cast<float>(desc_.outputHeight);
                push.invOutputSize[0] = 1.0f / static_cast<float>(desc_.outputWidth);
                push.invOutputSize[1] = 1.0f / static_cast<float>(desc_.outputHeight);
                // Motion vectors live in half-resolution luma texels; the shader
                // wants output pixels.
                const float halfWidth = static_cast<float>(halfUp(desc_.inputWidth));
                const float halfHeight = static_cast<float>(halfUp(desc_.inputHeight));
                push.motionScale[0] = static_cast<float>(desc_.outputWidth) / halfWidth;
                push.motionScale[1] = static_cast<float>(desc_.outputHeight) / halfHeight;
                push.historyWeight = desc_.historyWeight;
                push.clampSigma = desc_.clampSigma;
                push.frameIndex = static_cast<uint32_t>(frame.frameIndex & 0xFFFFFFFFu);
                push.resetHistory =
                    (!frame.historyValid || frame.resetHistory || frame.frameIndex == 0) ? 1u : 0u;

                Image* historyRead = &historyA_;
                Image* historyWrite = &historyB_;
                transitionImage(cmd, *historyRead, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
                transitionImage(cmd, *historyWrite, VK_IMAGE_LAYOUT_GENERAL,
                                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
                if (push.resetHistory == 0u && !historyValid_) push.resetHistory = 1u;

                Image* motionSource = frame.motionVectors != nullptr ? frame.motionVectors : &motion_;
                transitionImage(cmd, *motionSource, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);

                writeCombinedSampler(device, temporalAccum_.set, 0, current->view,
                                     temporalAccum_.sampler);
                writeCombinedSampler(device, temporalAccum_.set, 1, historyRead->view,
                                     temporalAccum_.sampler);
                writeCombinedSampler(device, temporalAccum_.set, 2, motionSource->view,
                                     temporalAccum_.sampler);
                writeCombinedSampler(device, temporalAccum_.set, 3, lumaHalfCurrent_.view,
                                     temporalAccum_.sampler);
                writeStorageImage(device, temporalAccum_.set, 4, dst->view);
                writeStorageImage(device, temporalAccum_.set, 5, historyWrite->view);
                uint32_t gx = 0, gy = 0;
                computeGroupCount(desc_.outputWidth, desc_.outputHeight, temporalAccum_.groupSizeX,
                                  temporalAccum_.groupSizeY, gx, gy);
                recordDispatch(cmd, temporalAccum_.pipeline, temporalAccum_.set, gx, gy, 1, &push,
                               sizeof(push));

                // The freshly written history becomes the next frame's read side.
                std::swap(historyA_, historyB_);
                historyValid_ = true;
                break;
            }
            case 2: {   // anti-aliasing / edge resolve
                AaResolvePush push{};
                push.size[0] = static_cast<float>(desc_.outputWidth);
                push.size[1] = static_cast<float>(desc_.outputHeight);
                push.invSize[0] = 1.0f / static_cast<float>(desc_.outputWidth);
                push.invSize[1] = 1.0f / static_cast<float>(desc_.outputHeight);
                push.edgeThreshold = 0.08f;
                push.strength = desc_.aaStrength;
                push.enable = 1;
                writeCombinedSampler(device, aaResolve_.set, 0, current->view, aaResolve_.sampler);
                writeStorageImage(device, aaResolve_.set, 1, dst->view);
                uint32_t gx = 0, gy = 0;
                computeGroupCount(desc_.outputWidth, desc_.outputHeight, aaResolve_.groupSizeX,
                                  aaResolve_.groupSizeY, gx, gy);
                recordDispatch(cmd, aaResolve_.pipeline, aaResolve_.set, gx, gy, 1, &push,
                               sizeof(push));
                break;
            }
            case 3: {   // sharpening
                SharpenPush push{};
                push.size[0] = static_cast<float>(desc_.outputWidth);
                push.size[1] = static_cast<float>(desc_.outputHeight);
                push.invSize[0] = 1.0f / static_cast<float>(desc_.outputWidth);
                push.invSize[1] = 1.0f / static_cast<float>(desc_.outputHeight);
                push.amount = desc_.sharpening;
                push.noiseFloor = 0.012f;
                push.enable = 1;
                writeCombinedSampler(device, sharpen_.set, 0, current->view, sharpen_.sampler);
                writeStorageImage(device, sharpen_.set, 1, dst->view);
                uint32_t gx = 0, gy = 0;
                computeGroupCount(desc_.outputWidth, desc_.outputHeight, sharpen_.groupSizeX,
                                  sharpen_.groupSizeY, gx, gy);
                recordDispatch(cmd, sharpen_.pipeline, sharpen_.set, gx, gy, 1, &push, sizeof(push));
                break;
            }
            default:
                break;
        }

        computeBarrier(cmd);
        endTiming(cmd, timingIndex);
        // The written image is a storage image in GENERAL layout; when the next
        // pass samples it, srcLayout drives the transition.
        current = dst;
        srcLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    }
    return true;
}

bool UpscalePipelineVk::record(VkCommandBuffer cmd, const FrameInputVk& frame, Image* output,
                               PassTimings* timings) {
    if (!initialised_ || frame.lowResColor == nullptr || output == nullptr) {
        V4K_LOGW("record(): pipeline not ready or missing images");
        return false;
    }
    if (timings != nullptr) {
        *timings = PassTimings{};
        timings->valid = true;
        timings->countersAvailable = timestamps_.available();
    }

    const VkDevice device = context_->device();
    mode_ = ReconstructionMode::None;

    // A frame whose geometry does not match the pipeline is a programming error
    // on the caller's side; say so instead of writing out of bounds.
    if (frame.lowResColor->width != desc_.inputWidth ||
        frame.lowResColor->height != desc_.inputHeight) {
        V4K_LOGW("record(): input image is %ux%u but the pipeline expects %ux%u",
                 frame.lowResColor->width, frame.lowResColor->height, desc_.inputWidth,
                 desc_.inputHeight);
        return false;
    }
    if (output->width != desc_.outputWidth || output->height != desc_.outputHeight) {
        V4K_LOGW("record(): output image is %ux%u but the pipeline expects %ux%u", output->width,
                 output->height, desc_.outputWidth, desc_.outputHeight);
        return false;
    }

    if (timestamps_.available()) timestamps_.reset(cmd);

    // ---- preprocess: luma plane + denoised colour --------------------------
    beginTiming(cmd, 0);
    transitionImage(cmd, *frame.lowResColor, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                    VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
    transitionImage(cmd, lumaCurrent_, VK_IMAGE_LAYOUT_GENERAL,
                    VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
    transitionImage(cmd, colorIn_, VK_IMAGE_LAYOUT_GENERAL, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                    VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);

    PreprocessPush preprocess{};
    preprocess.inputSize[0] = static_cast<float>(desc_.inputWidth);
    preprocess.inputSize[1] = static_cast<float>(desc_.inputHeight);
    preprocess.invInputSize[0] = 1.0f / static_cast<float>(desc_.inputWidth);
    preprocess.invInputSize[1] = 1.0f / static_cast<float>(desc_.inputHeight);
    preprocess.denoiseStrength = desc_.denoise ? desc_.denoiseStrength : 0.0f;
    preprocess.lumaSharpen = 0.35f;
    preprocess.flags = 0;
    preprocess.frameIndex = static_cast<uint32_t>(frame.frameIndex & 0xFFFFFFFFu);
    writeCombinedSampler(device, preprocess_.set, 0, frame.lowResColor->view, preprocess_.sampler);
    writeStorageImage(device, preprocess_.set, 1, lumaCurrent_.view);
    writeStorageImage(device, preprocess_.set, 2, colorIn_.view);
    {
        uint32_t gx = 0, gy = 0;
        computeGroupCount(desc_.inputWidth, desc_.inputHeight, preprocess_.groupSizeX,
                          preprocess_.groupSizeY, gx, gy);
        recordDispatch(cmd, preprocess_.pipeline, preprocess_.set, gx, gy, 1, &preprocess,
                       sizeof(preprocess));
    }
    computeBarrier(cmd);
    endTiming(cmd, 0);

    // ---- motion estimation (half resolution) -------------------------------
    // Motion estimation is charged to the preprocess slot: it is part of the
    // same "prepare this frame" cost and never interesting on its own.
    if (desc_.temporal && frame.motionVectors == nullptr) {
        transitionImage(cmd, lumaCurrent_, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
        transitionImage(cmd, lumaHalfCurrent_, VK_IMAGE_LAYOUT_GENERAL,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
        DownsamplePush downsample{};
        downsample.outW = halfUp(desc_.inputWidth);
        downsample.outH = halfUp(desc_.inputHeight);
        downsample.inW = desc_.inputWidth;
        downsample.inH = desc_.inputHeight;
        downsample.flags = 1;   // keep edge energy: helps the block search
        writeCombinedSampler(device, downsample_.set, 0, lumaCurrent_.view, downsample_.sampler);
        writeStorageImage(device, downsample_.set, 1, lumaHalfCurrent_.view);
        {
            uint32_t gx = 0, gy = 0;
            computeGroupCount(downsample.outW, downsample.outH, downsample_.groupSizeX,
                              downsample_.groupSizeY, gx, gy);
            recordDispatch(cmd, downsample_.pipeline, downsample_.set, gx, gy, 1, &downsample,
                           sizeof(downsample));
        }
        computeBarrier(cmd);

        transitionImage(cmd, lumaHalfCurrent_, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
        if (historyValid_) {
            transitionImage(cmd, lumaHalfPrevious_, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
        }
        transitionImage(cmd, motion_, VK_IMAGE_LAYOUT_GENERAL,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);

        MotionEstimatePush motion{};
        motion.lumaSize[0] = static_cast<float>(halfUp(desc_.inputWidth));
        motion.lumaSize[1] = static_cast<float>(halfUp(desc_.inputHeight));
        motion.searchRadius = static_cast<int32_t>(desc_.motionSearchRadius);
        motion.maxVectorLength = desc_.motionMaxVectorLength;
        motion.sadThreshold = 0.06f;
        motion.hasPrevious = historyValid_ ? 1u : 0u;
        writeCombinedSampler(device, motionEstimate_.set, 0, lumaHalfCurrent_.view,
                             motionEstimate_.sampler);
        writeCombinedSampler(device, motionEstimate_.set, 1,
                             historyValid_ ? lumaHalfPrevious_.view : lumaHalfCurrent_.view,
                             motionEstimate_.sampler);
        writeStorageImage(device, motionEstimate_.set, 2, motion_.view);
        {
            uint32_t gx = 0, gy = 0;
            const uint32_t w = static_cast<uint32_t>(motion.lumaSize[0]);
            const uint32_t h = static_cast<uint32_t>(motion.lumaSize[1]);
            computeGroupCount(w, h, motionEstimate_.groupSizeX, motionEstimate_.groupSizeY, gx, gy);
            recordDispatch(cmd, motionEstimate_.pipeline, motionEstimate_.set, gx, gy, 1, &motion,
                           sizeof(motion));
        }
        computeBarrier(cmd);
    } else if (desc_.temporal && frame.motionVectors != nullptr) {
        // Caller supplied vectors (a game with a motion vector pass, or a model
        // that requires them): nothing to estimate, but the temporal pass still
        // needs the luma plane for its neighbourhood statistics.
        transitionImage(cmd, lumaCurrent_, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
        transitionImage(cmd, lumaHalfCurrent_, VK_IMAGE_LAYOUT_GENERAL,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
        DownsamplePush downsample{};
        downsample.outW = halfUp(desc_.inputWidth);
        downsample.outH = halfUp(desc_.inputHeight);
        downsample.inW = desc_.inputWidth;
        downsample.inH = desc_.inputHeight;
        downsample.flags = 1;
        writeCombinedSampler(device, downsample_.set, 0, lumaCurrent_.view, downsample_.sampler);
        writeStorageImage(device, downsample_.set, 1, lumaHalfCurrent_.view);
        uint32_t gx = 0, gy = 0;
        computeGroupCount(downsample.outW, downsample.outH, downsample_.groupSizeX,
                          downsample_.groupSizeY, gx, gy);
        recordDispatch(cmd, downsample_.pipeline, downsample_.set, gx, gy, 1, &downsample,
                       sizeof(downsample));
        computeBarrier(cmd);
    }

    // ---- reconstruction ----------------------------------------------------
    const bool hasPostPasses = desc_.denoise || desc_.temporal || desc_.antiAliasing ||
                               desc_.sharpening > 0.001f;
    Image* reconstructionTarget = hasPostPasses ? &highA_ : output;
    transitionImage(cmd, *reconstructionTarget, VK_IMAGE_LAYOUT_GENERAL,
                    VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
    beginTiming(cmd, 1);
    if (neuralReady_ && desc_.neural) {
        transitionImage(cmd, colorIn_, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
        if (!recordNeural(cmd, reconstructionTarget)) {
            V4K_LOGW("the neural path failed to record; falling back to the analytical path");
            neuralReady_ = false;
            desc_.neural = false;
            if (!recordAnalytical(cmd, frame, reconstructionTarget)) return false;
        } else {
            mode_ = desc_.temporal ? ReconstructionMode::NeuralTemporal : ReconstructionMode::Neural;
        }
    }
    if (mode_ == ReconstructionMode::None) {
        if (!recordAnalytical(cmd, frame, reconstructionTarget)) return false;
        mode_ = desc_.temporal ? ReconstructionMode::AnalyticalTemporal
                               : ReconstructionMode::Analytical;
    }
    computeBarrier(cmd);
    endTiming(cmd, 1);

    // ---- temporal / AA / sharpening ----------------------------------------
    if (hasPostPasses) {
        if (!recordPost(cmd, frame, reconstructionTarget, output, timings)) return false;
    } else {
        transitionImage(cmd, *output, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT);
    }

    // Rotate the half-resolution luma so the next frame has "previous" data.
    if (desc_.temporal) std::swap(lumaHalfCurrent_, lumaHalfPrevious_);

    if (timings != nullptr && timestamps_.available()) {
        std::vector<double> durations;
        if (timestamps_.readDurations(durations, context_->timestampPeriod())) {
            const auto pick = [&](uint32_t index) -> double {
                return index * 2 + 1 < durations.size() ? durations[index] : kUnavailable;
            };
            timings->preprocessMs = pick(0);
            timings->neuralMs = pick(1);
            timings->denoiseMs = pick(2);
            timings->temporalMs = pick(3);
            timings->aaMs = pick(4);
            timings->sharpenMs = pick(5);
        }
    }
    return true;
}

uint64_t UpscalePipelineVk::workingSetBytes() const {
    return neuralReady_ ? plan_.stats.featureBytes + plan_.stats.weightBytes : 0;
}

uint64_t UpscalePipelineVk::weightBytes() const {
    return neuralReady_ ? plan_.stats.weightBytes : 0;
}

uint32_t UpscalePipelineVk::layerCount() const {
    return neuralReady_ ? plan_.stats.layerCount : 0;
}

}  // namespace vk
}  // namespace v4k

#endif  // V4K_ENABLE_VULKAN
