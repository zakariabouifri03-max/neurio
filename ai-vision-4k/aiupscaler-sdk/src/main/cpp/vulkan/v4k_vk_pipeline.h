// The real-time reconstruction chain.
//
// One frame flows through:
//
//   low-res frame ──> preprocess ──> [neural network | edge reconstruction] ──>
//   temporal reconstruction ──> anti-aliasing ──> sharpening ──> output
//
// Every stage is a Vulkan compute dispatch on pre-compiled SPIR-V, and the whole
// chain is recorded into a single command buffer so a frame costs one submit.
// The neural half is optional: when no model is installed (or the model does not
// fit the memory budget at the selected resolution) the analytical half runs
// instead and `modeName()` reports which one was used — the engine never
// pretends a frame went through a network it did not run.
#pragma once

#include "../ai/v4k_gpu_plan.h"
#include "../ai/v4k_model.h"
#include "../core/v4k_common.h"
#include "v4k_vk.h"

#include <string>
#include <vector>

#if !defined(V4K_ENABLE_VULKAN)
// This header declares Vulkan-typed members, so it is only part of a build with
// the backend enabled (CMake excludes the source when the option is off). Fail
// with one actionable message instead of a page of unknown-type errors.
#error "v4k_vk_pipeline.h requires a build with V4K_ENABLE_VULKAN=ON"
#endif


namespace v4k {
namespace vk {

struct PipelineDesc {
    uint32_t inputWidth = 1280;
    uint32_t inputHeight = 720;
    uint32_t outputWidth = 1920;
    uint32_t outputHeight = 1080;

    bool neural = false;              // true once a model has been installed
    bool temporal = true;             // motion estimation + temporal accumulation
    bool denoise = false;
    bool antiAliasing = true;
    float sharpening = 0.2f;          // 0..1, matches GraphicsProfile.sharpening
    float denoiseStrength = 0.25f;
    float aaStrength = 0.5f;
    float edgeStrength = 0.35f;
    float detailRecovery = 0.35f;
    float historyWeight = 0.9f;
    float clampSigma = 2.0f;
    uint32_t motionSearchRadius = 4;
    float motionMaxVectorLength = 16.0f;
    uint64_t maxWorkingBytes = 0;     // 0 == no explicit budget

    bool operator==(const PipelineDesc& other) const;
    bool operator!=(const PipelineDesc& other) const { return !(*this == other); }
};

// Everything the caller has to provide for a frame.
struct FrameInputVk {
    Image* lowResColor = nullptr;    // sampled colour, SHADER_READ_ONLY, input resolution
    Image* motionVectors = nullptr;  // optional caller supplied MVs (NEURAL temporal models)
    uint64_t frameIndex = 0;
    float deltaSeconds = 0.0f;
    bool resetHistory = false;       // scene cut, resolution change, first frame
    bool historyValid = false;
};

struct PassTimings {
    bool valid = false;
    bool countersAvailable = false;   // false when the GPU exposes no timestamps
    double preprocessMs = kUnavailable;   // includes motion estimation
    double neuralMs = kUnavailable;       // reconstruction (network or analytical)
    double denoiseMs = kUnavailable;
    double temporalMs = kUnavailable;
    double aaMs = kUnavailable;
    double sharpenMs = kUnavailable;

    double measuredTotalMs() const;
};

// ReconstructionMode lives in core/v4k_common.h (the JNI status JSON reports it
// even in a build without Vulkan). The UI wants a sentence rather than a code,
// so the friendly name stays here next to the pipeline that produces it.
const char* reconstructionModeName(ReconstructionMode mode);

class UpscalePipelineVk {
public:
    UpscalePipelineVk();
    ~UpscalePipelineVk();

    UpscalePipelineVk(const UpscalePipelineVk&) = delete;
    UpscalePipelineVk& operator=(const UpscalePipelineVk&) = delete;

    bool init(Context& context, const PipelineDesc& desc, std::string* error);
    void shutdown();

    // Swaps the model (nullptr == analytical path). Rebuilds only the layers that
    // depend on the graph, not the whole chain.
    bool setModel(const Model* model, std::string* error);
    bool setDescriptor(const PipelineDesc& desc, std::string* error);

    bool valid() const { return initialised_ && error_.empty(); }
    bool neuralReady() const { return neuralReady_; }
    const std::string& lastError() const { return error_; }
    const GpuPlan& plan() const { return plan_; }
    ReconstructionMode mode() const { return mode_; }

    // Records the frame. `output` must be an rgba16f image at the output
    // resolution; it is left in SHADER_READ_ONLY layout.
    bool record(VkCommandBuffer cmd, const FrameInputVk& frame, Image* output, PassTimings* timings);

    // Statistics for the AI Engine panel.
    uint64_t workingSetBytes() const;
    uint64_t weightBytes() const;
    uint32_t layerCount() const;

private:
    struct Pass {
        ComputePipeline pipeline;
        VkDescriptorPool pool = VK_NULL_HANDLE;
        VkDescriptorSet set = VK_NULL_HANDLE;
        VkSampler sampler = VK_NULL_HANDLE;
        uint32_t groupSizeX = 8;
        uint32_t groupSizeY = 8;
        bool ready = false;
    };

    bool createPass(Pass& pass, const char* shaderName, const std::vector<DescriptorBinding>& bindings,
                    uint32_t pushBytes, uint32_t groupSizeX, uint32_t groupSizeY, std::string* error);
    void destroyPass(Pass& pass);
    bool createImages(std::string* error);
    void destroyImages();
    bool buildNeuralResources(const Model& model, std::string* error);
    void destroyNeuralResources();
    bool recordNeural(VkCommandBuffer cmd, Image* target);
    bool recordAnalytical(VkCommandBuffer cmd, const FrameInputVk& frame, Image* target);
    bool recordPost(VkCommandBuffer cmd, const FrameInputVk& frame, Image* from, Image* output,
                    PassTimings* timings);
    void beginTiming(VkCommandBuffer cmd, uint32_t index);
    void endTiming(VkCommandBuffer cmd, uint32_t index);

    Context* context_ = nullptr;
    PipelineDesc desc_{};
    GpuPlan plan_{};
    std::string error_;
    bool initialised_ = false;
    bool neuralReady_ = false;
    ReconstructionMode mode_ = ReconstructionMode::None;

    // Images
    Image colorIn_;      // preprocessed low-res colour, rgba16f
    Image lumaCurrent_;    // rgba8, r = luma of the current frame (input resolution)
    Image lumaPrevious_;   // rgba8, luma of the previous frame
    Image lumaHalfCurrent_;  // rgba8, half resolution (motion estimation domain)
    Image lumaHalfPrevious_;
    Image motion_;       // rgba16f, xy = motion vector, z = confidence
    Image historyA_;     // rgba16f, output resolution
    Image historyB_;
    Image highA_;        // rgba16f, output resolution (ping-pong with highB_)
    Image highB_;

    Pass preprocess_;
    Pass downsample_;
    Pass motionEstimate_;
    Pass neuralConv_;
    Pass neuralShuffle_;
    Pass neuralElementwise_;
    Pass neuralPrelu_;
    Pass imageToPlanar_;
    Pass planarToImage_;
    Pass bicubicResidual_;
    Pass edgeReconstruct_;
    Pass temporalAccum_;
    Pass aaResolve_;
    Pass sharpen_;
    Pass denoise_;

    // Neural resources (buffers)
    std::vector<Buffer> tensorBuffers_;   // parallel to plan_.slots
    std::vector<Buffer> weightBuffers_;   // one per layer with weights
    std::vector<Buffer> biasBuffers_;
    Buffer skipOutput_;                   // global residual result
    VkDescriptorPool neuralPool_ = VK_NULL_HANDLE;
    std::vector<VkDescriptorSet> layerSets_;
    VkSampler pointSampler_ = VK_NULL_HANDLE;

    bool historyValid_ = false;
    TimestampQueries timestamps_;
    // 0 preprocess (+motion), 1 reconstruction, 2 denoise, 3 temporal, 4 AA, 5 sharpen.
    static constexpr uint32_t kTimingCount = 6;
};

}  // namespace vk
}  // namespace v4k
