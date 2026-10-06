// Schedules a .v4kmodel graph onto GPU buffers.
//
// This header is deliberately platform independent (no Vulkan types): it turns a
// parsed model plus a frame size into an explicit list of layers with concrete
// tensor shapes, and it answers the questions the engine must answer *before*
// touching the driver:
//
//   * how much memory does this model need at this resolution?
//   * is the geometry executable at all (channel counts, shuffle divisibility)?
//   * which tensor slots are live at the same time (so they can be reused)?
//
// Because it is pure data it is unit tested on the host
// (tests/test_gpu_plan.cpp) and cross-checked against the CPU interpreter's
// per-layer validation, which is what keeps the two backends from drifting.
#pragma once

#include "../core/v4k_common.h"
#include "v4k_model.h"

#include <cstdint>
#include <string>
#include <vector>

namespace v4k {

struct TensorShape {
    uint32_t width = 0;
    uint32_t height = 0;
    uint32_t channels = 0;

    uint64_t planeElements() const {
        return static_cast<uint64_t>(width) * static_cast<uint64_t>(height);
    }
    uint64_t elements() const { return planeElements() * channels; }
    uint64_t bytes() const { return elements() * sizeof(float); }
    bool valid() const { return width > 0 && height > 0 && channels > 0; }
    bool sameAs(const TensorShape& other) const {
        return width == other.width && height == other.height && channels == other.channels;
    }
    std::string describe() const;
};

// One executable layer with everything the dispatcher needs.
struct LayerPlan {
    ModelOpType type = ModelOpType::Conv2d;
    int32_t inputIndex = -1;    // -1 == network input
    int32_t input2Index = -1;
    int32_t inputSlot = 0;      // tensor slot holding the first operand
    int32_t input2Slot = 0;
    int32_t outputSlot = 0;
    TensorShape input;
    TensorShape output;
    uint32_t kernel = 1;
    uint32_t stride = 1;
    uint32_t padding = 0;
    ModelActivation activation = ModelActivation::None;
    // Element counts of the op's own weight/bias arrays. The Vulkan executor
    // uploads one storage buffer per layer (weightBuffers_[i] / biasBuffers_[i]),
    // so no absolute blob offset is carried here: an offset into a packed blob
    // would have to match the uploader exactly and silently reads the wrong
    // weights when it does not. Counts are what the uploader and the push
    // constants actually need.
    uint64_t weightsCount = 0;
    uint64_t biasCount = 0;
    uint32_t flags = 0;
    bool writesResource = false;   // PixelShuffle/Add/PReLU do not need the conv pipeline
};

struct GpuPlanStats {
    uint64_t featureBytes = 0;   // sum of the live tensor working set
    uint64_t weightBytes = 0;    // float32 weights + biases uploaded to the GPU
    uint64_t activationBytes = 0;  // peak simultaneous activation memory
    uint32_t slotCount = 0;
    uint32_t layerCount = 0;
};

struct GpuPlan {
    uint32_t inputWidth = 0;
    uint32_t inputHeight = 0;
    // Tensor slots. Slot 0 stays bound to the network input for the whole
    // frame (the bicubic-residual and ConcatInput passes read it again after the
    // last layer), so only slots >= 1 are recycled -- a layer never writes into
    // slot 0.
    std::vector<TensorShape> slots;
    std::vector<LayerPlan> layers;
    TensorShape output;
    GpuPlanStats stats;

    // Global residual (kModelFlagGlobalResidual): output = bicubic(input) + net.
    // The executor implements it as two extra dispatches, so the plan only
    // carries where the skip tensor lives.
    bool appliesGlobalResidual = false;
    int32_t residualSlot = -1;

    bool feasible = false;
    std::string reason;             // human readable when feasible == false
    std::vector<std::string> warnings;  // non fatal, shown in the AI Engine panel

    const LayerPlan* finalLayer() const {
        return layers.empty() ? nullptr : &layers.back();
    }
};

// Builds the plan for `model` at the given frame size. `maxWorkingBytes` is the
// budget the caller is willing to spend on activations (0 == unlimited); when
// the plan would exceed it the plan is returned with feasible == false and a
// reason the UI can show verbatim.
bool buildGpuPlan(const Model& model, uint32_t inputWidth, uint32_t inputHeight,
                  uint64_t maxWorkingBytes, GpuPlan& out, std::string* error);

// Memory a plan needs for a given resolution without building the full plan;
// used by the compatibility engine before a model is even downloaded.
uint64_t estimateWorkingSetBytes(const Model& model, uint32_t inputWidth, uint32_t inputHeight);

const char* modelOpTypeName(ModelOpType type);

}  // namespace v4k
