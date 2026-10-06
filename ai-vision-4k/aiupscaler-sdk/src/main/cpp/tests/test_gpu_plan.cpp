// Tests for the GPU execution plan (ai/v4k_gpu_plan.*).
//
// buildGpuPlan() is the contract between the model format and the Vulkan
// executor: it resolves every tensor shape, decides whether the geometry can
// run at all, and assigns the tensor slots that the dispatcher binds. Getting a
// shape or a slot wrong only shows up as a wrong image on a phone, so the
// interesting cases are pinned here instead: slot reuse on a long chain, the
// global-residual skip tensor, second-operand resolution for Add/ConcatInput,
// and every rejection path the UI can surface verbatim.
#include <cmath>
#include <string>
#include <vector>

#include "ai/v4k_gpu_plan.h"
#include "ai/v4k_model.h"
#include "v4k_test.h"

using namespace v4k;

namespace {

// Weight index for Conv2d, layout [outChannels][inChannels][k][k].
size_t convWeightIndex(uint32_t outChannel, uint32_t inChannel, uint32_t inChannels, uint32_t k,
                       uint32_t ky, uint32_t kx) {
    return ((static_cast<size_t>(outChannel) * inChannels + inChannel) * k + ky) * k + kx;
}

// A full convolution. When inChannels == outChannels and k == 3 the centre tap
// of every channel is 1, i.e. an identity layer: useful because the plan's shape
// arithmetic can then be read straight off the layer list.
ModelOp convOp(uint32_t inChannels, uint32_t outChannels, uint32_t kernel = 3, uint32_t stride = 1,
               uint32_t padding = 1, ModelActivation activation = ModelActivation::None) {
    ModelOp op;
    op.type = ModelOpType::Conv2d;
    op.inputIndex = -1;
    op.inputChannels = inChannels;
    op.outputChannels = outChannels;
    op.kernelSize = kernel;
    op.stride = stride;
    op.padding = padding;
    op.activation = activation;
    op.weights.assign(static_cast<size_t>(outChannels) * inChannels * kernel * kernel, 0.0f);
    if (kernel == 3 && inChannels == outChannels) {
        for (uint32_t c = 0; c < outChannels; ++c) {
            op.weights[convWeightIndex(c, c, inChannels, kernel, 1, 1)] = 1.0f;
        }
    }
    op.bias.assign(outChannels, 0.0f);
    return op;
}

ModelOp depthwiseOp(uint32_t channels, uint32_t kernel = 3, uint32_t stride = 1,
                    uint32_t padding = 1) {
    ModelOp op;
    op.type = ModelOpType::DepthwiseConv2d;
    op.inputIndex = -1;
    op.inputChannels = channels;
    op.outputChannels = channels;
    op.kernelSize = kernel;
    op.stride = stride;
    op.padding = padding;
    op.weights.assign(static_cast<size_t>(channels) * kernel * kernel, 0.0f);
    for (uint32_t c = 0; c < channels; ++c) {
        op.weights[(static_cast<size_t>(c) * kernel + kernel / 2) * kernel + kernel / 2] = 1.0f;
    }
    op.bias.assign(channels, 0.0f);
    return op;
}

ModelOp pixelShuffleOp(int32_t inputIndex) {
    ModelOp op;
    op.type = ModelOpType::PixelShuffle;
    op.inputIndex = inputIndex;
    return op;
}

// conv 3x3 (identity centre, 1 -> 4 channels) + pixel shuffle: an exact 2x
// nearest-neighbour upscale, so the graph is trivially valid.
Model nearestNeighbourModel(uint32_t inputChannels = 1) {
    Model model;
    model.inputChannels = inputChannels;
    model.scaleFactor = 2;
    model.weightFormat = ModelWeightFormat::Fp32;
    model.ops.push_back(convOp(inputChannels, 4));
    model.ops.push_back(pixelShuffleOp(0));
    return model;
}

// Two forms so a test can assert the helper's error string *and* that the
// nullptr error pointer is accepted.
bool build(const Model& model, uint32_t width, uint32_t height, uint64_t budget, GpuPlan& plan) {
    return buildGpuPlan(model, width, height, budget, plan, nullptr);
}

bool build(const Model& model, uint32_t width, uint32_t height, uint64_t budget, GpuPlan& plan,
           std::string& error) {
    return buildGpuPlan(model, width, height, budget, plan, &error);
}

}  // namespace

V4K_TEST(gpu_plan_tensor_shape_math) {
    const TensorShape shape{16, 8, 4};
    CHECK_EQ_INT(shape.planeElements(), 128);
    CHECK_EQ_INT(shape.elements(), 512);
    CHECK_EQ_INT(shape.bytes(), 2048);
    CHECK(shape.valid());
    CHECK(shape.sameAs(TensorShape{16, 8, 4}));
    CHECK(!shape.sameAs(TensorShape{16, 8, 3}));
    CHECK_EQ_STR(shape.describe(), "16x8x4");

    const TensorShape empty;
    CHECK(!empty.valid());
    CHECK_EQ_INT(empty.elements(), 0);
    CHECK(!empty.sameAs(TensorShape{1, 1, 1}));
}

V4K_TEST(gpu_plan_names_every_op_type) {
    CHECK_EQ_STR(modelOpTypeName(ModelOpType::Conv2d), "Conv2d");
    CHECK_EQ_STR(modelOpTypeName(ModelOpType::DepthwiseConv2d), "DepthwiseConv2d");
    CHECK_EQ_STR(modelOpTypeName(ModelOpType::PixelShuffle), "PixelShuffle");
    CHECK_EQ_STR(modelOpTypeName(ModelOpType::Add), "Add");
    CHECK_EQ_STR(modelOpTypeName(ModelOpType::PReLU), "PReLU");
    CHECK_EQ_STR(modelOpTypeName(ModelOpType::ConcatInput), "ConcatInput");
    CHECK_EQ_STR(modelOpTypeName(static_cast<ModelOpType>(99)), "Unknown");
}

V4K_TEST(gpu_plan_nearest_neighbour_graph_is_executable) {
    const Model model = nearestNeighbourModel(1);
    GpuPlan plan;
    std::string error = "not cleared";
    CHECK(build(model, 16, 16, 0, plan, error));
    CHECK(plan.feasible);
    CHECK(plan.reason.empty());
    CHECK(plan.warnings.empty());
    CHECK_EQ_INT(plan.stats.layerCount, 2);
    CHECK_EQ_INT(plan.stats.slotCount, 3);
    CHECK_EQ_INT(plan.inputWidth, 16);
    CHECK_EQ_INT(plan.inputHeight, 16);

    // conv 16x16x1 -> 16x16x4, shuffle -> 32x32x1.
    CHECK(!plan.layers.empty());
    CHECK_EQ_STR(plan.layers[0].input.describe(), "16x16x1");
    CHECK_EQ_STR(plan.layers[0].output.describe(), "16x16x4");
    CHECK_EQ_STR(plan.layers[1].output.describe(), "32x32x1");
    CHECK(plan.output.sameAs(TensorShape{32, 32, 1}));
    CHECK(plan.layers[0].output.sameAs(plan.layers[1].input));

    // Slot 0 is pinned to the network input (the residual/concat passes read it
    // after the last layer), and the 4-channel feature tensor in slot 1 is
    // released and recycled by the shuffle -- so three buffers, not one per
    // layer.
    CHECK_EQ_INT(plan.layers[0].inputSlot, 0);
    CHECK_EQ_INT(plan.layers[0].outputSlot, 1);
    CHECK_EQ_INT(plan.layers[1].inputSlot, plan.layers[0].outputSlot);
    CHECK_EQ_INT(plan.layers[1].outputSlot, 2);
    CHECK_EQ_INT(plan.layers[0].input2Slot, -1);
    CHECK_EQ_STR(plan.slots[0].describe(), "16x16x1");
    CHECK_EQ_STR(plan.slots[1].describe(), "16x16x4");
    CHECK_EQ_STR(plan.slots[2].describe(), "32x32x1");

    // A conv runs on the convolution pipeline; a shuffle does not.
    CHECK(!plan.layers[0].writesResource);
    CHECK(plan.layers[1].writesResource);
    CHECK_EQ_INT(plan.layers[0].weightsCount, 36);
    CHECK_EQ_INT(plan.layers[0].biasCount, 4);
    CHECK(!plan.appliesGlobalResidual);
    CHECK_EQ_INT(plan.residualSlot, -1);
    CHECK(plan.finalLayer() == &plan.layers[1]);

    // Three live buffers: input 16x16x1, features 16x16x4, output 32x32x1.
    CHECK_EQ_INT(plan.stats.featureBytes, 1024 + 4096 + 4096);
    // activationBytes is a conservative interval-overlap bound, so it may exceed
    // the true instantaneous peak; it must never exceed the sum of the slots.
    CHECK_EQ_INT(plan.stats.activationBytes, 1024 + 4096 + 4096);
    CHECK_EQ_INT(plan.stats.weightBytes, 40 * sizeof(float));
    CHECK_EQ_INT(estimateWorkingSetBytes(model, 16, 16),
                 plan.stats.featureBytes + plan.stats.weightBytes);
    CHECK(error.empty());
}

V4K_TEST(gpu_plan_reuses_slots_for_a_deep_chain) {
    Model model;
    model.inputChannels = 1;
    model.scaleFactor = 2;
    for (int i = 0; i < 6; ++i) model.ops.push_back(convOp(1, 1));

    GpuPlan plan;
    CHECK(build(model, 8, 8, 0, plan));
    // The graph above is 2x short of its declared scale, which is a warning, not
    // a failure: the plan explains it and stays executable.
    CHECK(plan.feasible);
    CHECK(!plan.warnings.empty());
    CHECK_EQ_INT(plan.stats.layerCount, 6);
    // Two recyclable slots (1 and 2) plus the pinned input slot.
    CHECK_EQ_INT(plan.stats.slotCount, 3);
    for (const LayerPlan& layer : plan.layers) {
        CHECK_EQ_STR(layer.output.describe(), "8x8x1");
        CHECK_EQ_INT(layer.weightsCount, 9);
        CHECK_EQ_INT(layer.biasCount, 1);
    }
    CHECK_LT(plan.stats.slotCount, plan.stats.layerCount);
    CHECK_EQ_INT(plan.stats.featureBytes, 3 * 8 * 8 * sizeof(float));
    // Only two of the three intervals ever overlap at one dispatch.
    CHECK_EQ_INT(plan.stats.activationBytes, 2 * 8 * 8 * sizeof(float));
    CHECK_EQ_INT(plan.layers[0].inputSlot, 0);   // layer 0 reads the network input
    for (size_t i = 0; i < plan.layers.size(); ++i) {
        CHECK(plan.layers[i].outputSlot != 0);   // but nothing overwrites slot 0
        if (i > 0) CHECK_EQ_INT(plan.layers[i].inputSlot, plan.layers[i - 1].outputSlot);
    }
}

V4K_TEST(gpu_plan_depthwise_then_shuffle_matches_the_declared_scale) {
    Model model;
    model.inputChannels = 4;
    model.scaleFactor = 2;
    model.ops.push_back(depthwiseOp(4));
    model.ops.push_back(pixelShuffleOp(0));

    GpuPlan plan;
    CHECK(build(model, 12, 12, 0, plan));
    CHECK(plan.feasible);
    CHECK(plan.warnings.empty());
    CHECK_EQ_STR(plan.layers[0].input.describe(), "12x12x4");
    CHECK_EQ_STR(plan.layers[0].output.describe(), "12x12x4");
    CHECK_EQ_STR(plan.output.describe(), "24x24x1");
    CHECK_EQ_INT(plan.layers[0].weightsCount, 4 * 9);
    CHECK_EQ_INT(plan.layers[0].biasCount, 4);
    CHECK_EQ_STR(modelOpTypeName(plan.layers[0].type), "DepthwiseConv2d");
}

V4K_TEST(gpu_plan_warns_when_the_output_is_not_the_declared_scale) {
    Model model;
    model.inputChannels = 3;
    model.scaleFactor = 2;
    model.ops.push_back(convOp(3, 16, 3, /*stride=*/2));   // 16x16 -> 8x8
    model.ops.push_back(pixelShuffleOp(0));                // 8x8x16 -> 16x16x4

    GpuPlan plan;
    std::string error;
    CHECK(build(model, 16, 16, 0, plan, error));
    CHECK(plan.feasible);
    CHECK_EQ_STR(plan.output.describe(), "16x16x4");
    CHECK(!plan.warnings.empty());
    CHECK_STR_CONTAINS(plan.warnings[0], "not the declared");
    CHECK_STR_CONTAINS(plan.warnings[0], "16x16");
    CHECK(error.empty());
}

V4K_TEST(gpu_plan_supports_a_4x_two_stage_shuffle) {
    Model model;
    model.inputChannels = 1;
    model.scaleFactor = 4;
    model.ops.push_back(convOp(1, 16));
    model.ops.push_back(pixelShuffleOp(0));   // 8x8x16 -> 16x16x4
    model.ops.push_back(pixelShuffleOp(1));   // 16x16x4 -> 32x32x1

    GpuPlan plan;
    CHECK(build(model, 8, 8, 0, plan));
    CHECK(plan.feasible);
    CHECK(plan.warnings.empty());
    CHECK_EQ_STR(plan.output.describe(), "32x32x1");
    CHECK_EQ_INT(plan.stats.layerCount, 3);
    CHECK_EQ_INT(plan.stats.slotCount, 3);
    CHECK_EQ_STR(plan.layers[1].output.describe(), "16x16x4");
    CHECK_EQ_STR(plan.slots[0].describe(), "8x8x1");   // still the input
}

V4K_TEST(gpu_plan_rejects_a_shuffle_that_is_not_divisible_by_four) {
    Model model;
    model.inputChannels = 1;
    model.scaleFactor = 2;
    model.ops.push_back(convOp(1, 3));
    model.ops.push_back(pixelShuffleOp(0));

    GpuPlan plan;
    std::string error;
    CHECK(!build(model, 16, 16, 0, plan, error));
    CHECK(!plan.feasible);
    CHECK_STR_CONTAINS(plan.reason, "divisible by 4");
    CHECK_EQ_STR(error, plan.reason);
    CHECK(plan.layers.empty());
    CHECK_EQ_INT(estimateWorkingSetBytes(model, 16, 16), 0);
}

V4K_TEST(gpu_plan_rejects_kernels_and_strides_it_cannot_execute) {
    {
        Model model;
        model.inputChannels = 1;
        model.scaleFactor = 2;
        model.ops.push_back(convOp(1, 4, /*kernel=*/5, 1, /*padding=*/2));
        model.ops.push_back(pixelShuffleOp(0));
        GpuPlan plan;
        std::string error;
        CHECK(!build(model, 16, 16, 0, plan, error));
        CHECK_STR_CONTAINS(plan.reason, "kernel size 5");
        CHECK_STR_CONTAINS(error, "layer 0 (Conv2d)");
    }
    {
        Model model;
        model.inputChannels = 1;
        model.scaleFactor = 2;
        model.ops.push_back(convOp(1, 4, 3, /*stride=*/3));
        model.ops.push_back(pixelShuffleOp(0));
        GpuPlan plan;
        CHECK(!build(model, 16, 16, 0, plan));
        CHECK_STR_CONTAINS(plan.reason, "stride 3");
    }
}

V4K_TEST(gpu_plan_accepts_a_1x1_convolution) {
    Model model;
    model.inputChannels = 1;
    model.scaleFactor = 2;
    model.ops.push_back(convOp(1, 4, /*kernel=*/1, 1, /*padding=*/0));
    model.ops.push_back(pixelShuffleOp(0));

    GpuPlan plan;
    CHECK(build(model, 16, 16, 0, plan));
    CHECK(plan.feasible);
    CHECK_EQ_STR(plan.layers[0].output.describe(), "16x16x4");
    CHECK_EQ_INT(plan.layers[0].weightsCount, 4);
}

V4K_TEST(gpu_plan_rejects_geometry_that_cannot_be_covered_by_the_kernel) {
    Model model;
    model.inputChannels = 1;
    model.scaleFactor = 2;
    model.ops.push_back(convOp(1, 4, /*kernel=*/3, 1, /*padding=*/0));
    model.ops.push_back(pixelShuffleOp(0));

    GpuPlan plan;
    CHECK(!build(model, 2, 2, 0, plan));
    CHECK_STR_CONTAINS(plan.reason, "smaller than the 3x3 kernel");
}

V4K_TEST(gpu_plan_rejects_weight_and_bias_count_mismatches) {
    {
        Model model = nearestNeighbourModel();
        model.ops[0].weights.resize(20);
        GpuPlan plan;
        CHECK(!build(model, 16, 16, 0, plan));
        CHECK_STR_CONTAINS(plan.reason, "geometry needs 36");
    }
    {
        Model model = nearestNeighbourModel();
        model.ops[0].bias.resize(3);
        GpuPlan plan;
        CHECK(!build(model, 16, 16, 0, plan));
        CHECK_STR_CONTAINS(plan.reason, "needs 4 bias values, has 3");
    }
    {
        // Inline PReLU keeps its slopes after the biases in the same block, so a
        // bias array that is too short would run the layer with wrong slopes.
        Model model = nearestNeighbourModel();
        model.ops[0].activation = ModelActivation::PReLU;
        GpuPlan plan;
        CHECK(!build(model, 16, 16, 0, plan));
        CHECK_STR_CONTAINS(plan.reason, "inline PReLU");
    }
    {
        Model model = nearestNeighbourModel();
        model.ops[0].activation = ModelActivation::PReLU;
        model.ops[0].bias.resize(8, 0.0f);   // [biases][slopes]
        GpuPlan plan;
        CHECK(build(model, 16, 16, 0, plan));
        CHECK(plan.feasible);
        CHECK(plan.layers[0].activation == ModelActivation::PReLU);
        CHECK_EQ_INT(plan.layers[0].biasCount, 8);
    }
}

V4K_TEST(gpu_plan_rejects_empty_and_nonsensical_models) {
    {
        Model model;
        model.inputChannels = 1;
        GpuPlan plan;
        CHECK(!build(model, 16, 16, 0, plan));
        CHECK_STR_CONTAINS(plan.reason, "no layers");
    }
    {
        Model model = nearestNeighbourModel();
        GpuPlan plan;
        CHECK(!build(model, 0, 16, 0, plan));
        CHECK_STR_CONTAINS(plan.reason, "frame size is zero");
    }
    {
        Model model = nearestNeighbourModel();
        model.inputChannels = 0;
        GpuPlan plan;
        CHECK(!build(model, 16, 16, 0, plan));
        CHECK_STR_CONTAINS(plan.reason, "zero input channels");
    }
    {
        Model model = nearestNeighbourModel();
        model.scaleFactor = 3;
        GpuPlan plan;
        CHECK(!build(model, 16, 16, 0, plan));
        CHECK_STR_CONTAINS(plan.reason, "unsupported scale factor");
    }
    {
        // A zero output-channel layer would produce an empty tensor.
        Model model = nearestNeighbourModel();
        model.ops[0].outputChannels = 0;
        GpuPlan plan;
        CHECK(!build(model, 16, 16, 0, plan));
        CHECK(!plan.feasible);
        CHECK(!plan.reason.empty());
    }
}

V4K_TEST(gpu_plan_global_residual_allocates_and_frees_a_skip_tensor) {
    Model model = nearestNeighbourModel();
    model.flags |= kModelFlagGlobalResidual;

    GpuPlan plan;
    CHECK(build(model, 16, 16, 0, plan));
    CHECK(plan.feasible);
    CHECK(plan.appliesGlobalResidual);
    CHECK(plan.residualSlot >= 0);
    CHECK(plan.residualSlot < static_cast<int32_t>(plan.slots.size()));
    CHECK(plan.slots[static_cast<size_t>(plan.residualSlot)].sameAs(plan.output));
    CHECK_EQ_STR(plan.slots[static_cast<size_t>(plan.residualSlot)].describe(), "32x32x1");
    CHECK_EQ_INT(plan.stats.slotCount, 4);   // input + residual + two feature slots
    CHECK_EQ_INT(plan.layers[1].input2Slot, -1);   // the skip is added at the end
}

V4K_TEST(gpu_plan_global_residual_requires_a_matching_output_shape) {
    Model model;
    model.inputChannels = 1;
    model.scaleFactor = 2;
    model.flags |= kModelFlagGlobalResidual;
    model.ops.push_back(convOp(1, 1));   // stays 16x16, the skip is 32x32

    GpuPlan plan;
    CHECK(!build(model, 16, 16, 0, plan));
    CHECK_STR_CONTAINS(plan.reason, "global residual needs");
}

V4K_TEST(gpu_plan_add_can_consume_the_global_residual) {
    Model model;
    model.inputChannels = 1;
    model.scaleFactor = 2;
    model.flags |= kModelFlagGlobalResidual;
    model.ops.push_back(convOp(1, 4));
    model.ops.push_back(pixelShuffleOp(0));
    ModelOp add;
    add.type = ModelOpType::Add;
    add.inputIndex = 1;
    add.input2Index = -1;   // -1 == the upsampled network input
    model.ops.push_back(add);

    GpuPlan plan;
    CHECK(build(model, 16, 16, 0, plan));
    CHECK(plan.feasible);
    CHECK(plan.appliesGlobalResidual);
    CHECK_EQ_STR(plan.output.describe(), "32x32x1");
    const LayerPlan& layer = plan.layers[2];
    CHECK_EQ_INT(layer.input2Slot, plan.residualSlot);
    CHECK(layer.input2Slot != layer.inputSlot);
    CHECK(plan.layers[2].writesResource);
}

V4K_TEST(gpu_plan_add_without_the_residual_flag_is_rejected) {
    Model model;
    model.inputChannels = 1;
    model.scaleFactor = 2;
    model.ops.push_back(convOp(1, 4));
    model.ops.push_back(pixelShuffleOp(0));
    ModelOp add;
    add.type = ModelOpType::Add;
    add.inputIndex = 1;
    add.input2Index = -1;
    model.ops.push_back(add);

    GpuPlan plan;
    CHECK(!build(model, 16, 16, 0, plan));
    CHECK_STR_CONTAINS(plan.reason, "without a global residual flag");
}

V4K_TEST(gpu_plan_add_between_two_tensors_resolves_the_producer_slot) {
    Model model;
    model.inputChannels = 1;
    model.scaleFactor = 2;
    model.ops.push_back(convOp(1, 1));            // tensor 1
    model.ops.push_back(convOp(1, 1));            // tensor 2
    ModelOp add;
    add.type = ModelOpType::Add;
    add.inputIndex = 1;
    add.input2Index = 0;                          // tensor 1 == layer 0's output
    model.ops.push_back(add);

    GpuPlan plan;
    CHECK(build(model, 16, 16, 0, plan));
    CHECK(plan.feasible);
    CHECK_EQ_INT(plan.layers[2].input2Slot, plan.layers[0].outputSlot);
    CHECK(plan.layers[2].input2Slot != plan.layers[2].inputSlot);
    CHECK_EQ_STR(plan.layers[2].output.describe(), "16x16x1");
}

V4K_TEST(gpu_plan_add_can_reference_the_running_tensor) {
    Model model;
    model.inputChannels = 1;
    model.scaleFactor = 2;
    model.ops.push_back(convOp(1, 1));
    ModelOp add;
    add.type = ModelOpType::Add;
    add.inputIndex = 0;
    add.input2Index = 1;   // >= the layer index: CPU semantics say "current"
    model.ops.push_back(add);

    GpuPlan plan;
    CHECK(build(model, 16, 16, 0, plan));
    CHECK(plan.feasible);
    CHECK_EQ_INT(plan.layers[1].input2Slot, plan.layers[1].inputSlot);
}

V4K_TEST(gpu_plan_rejects_a_forward_add_operand) {
    {
        Model model;
        model.inputChannels = 1;
        model.scaleFactor = 2;
        ModelOp add;
        add.type = ModelOpType::Add;
        add.inputIndex = -1;
        add.input2Index = 5;
        model.ops.push_back(add);
        GpuPlan plan;
        CHECK(!build(model, 16, 16, 0, plan));
        CHECK_STR_CONTAINS(plan.reason, "does not exist yet");
    }
}

V4K_TEST(gpu_plan_rejects_add_with_differing_shapes) {
    Model model;
    model.inputChannels = 1;
    model.scaleFactor = 2;
    model.ops.push_back(convOp(1, 4));       // tensor 1: 16x16x4
    model.ops.push_back(pixelShuffleOp(0));  // tensor 2: 32x32x1
    ModelOp add;
    add.type = ModelOpType::Add;
    add.inputIndex = 1;
    add.input2Index = 0;                     // tensor 1 is 16x16x4, not 32x32x1
    model.ops.push_back(add);

    GpuPlan plan;
    CHECK(!build(model, 16, 16, 0, plan));
    CHECK_STR_CONTAINS(plan.reason, "shapes differ");
}

V4K_TEST(gpu_plan_concat_input_doubles_the_running_tensor) {
    Model model;
    model.inputChannels = 1;
    model.scaleFactor = 2;
    model.ops.push_back(convOp(1, 4));
    ModelOp concat;
    concat.type = ModelOpType::ConcatInput;
    concat.inputIndex = 0;
    model.ops.push_back(concat);
    model.ops.push_back(convOp(8, 1));   // fold the concatenated channels back down

    GpuPlan plan;
    CHECK(build(model, 16, 16, 0, plan));
    CHECK(plan.feasible);
    CHECK_EQ_STR(plan.layers[1].output.describe(), "16x16x8");
    CHECK_EQ_INT(plan.layers[1].input2Slot, plan.layers[1].inputSlot);
    CHECK(!plan.appliesGlobalResidual);
}

V4K_TEST(gpu_plan_concat_input_uses_the_residual_when_the_flag_is_set) {
    Model model;
    model.inputChannels = 1;
    model.scaleFactor = 2;
    model.flags |= kModelFlagGlobalResidual;
    model.ops.push_back(convOp(1, 4));
    model.ops.push_back(pixelShuffleOp(0));   // 32x32x1 == the skip tensor
    ModelOp concat;
    concat.type = ModelOpType::ConcatInput;
    concat.inputIndex = 1;
    model.ops.push_back(concat);              // 32x32x2
    model.ops.push_back(convOp(2, 1));        // back to 32x32x1

    GpuPlan plan;
    CHECK(build(model, 16, 16, 0, plan));
    CHECK(plan.feasible);
    CHECK(plan.appliesGlobalResidual);
    CHECK(plan.residualSlot >= 0);
    CHECK_EQ_STR(plan.layers[2].output.describe(), "32x32x2");
    CHECK_EQ_INT(plan.layers[2].input2Slot, plan.residualSlot);
    CHECK_EQ_STR(plan.output.describe(), "32x32x1");
}

V4K_TEST(gpu_plan_rejects_a_concat_operand_of_the_wrong_size) {
    Model model;
    model.inputChannels = 1;
    model.scaleFactor = 2;
    model.flags |= kModelFlagGlobalResidual;
    model.ops.push_back(convOp(1, 4));   // 16x16x4 -- the skip is 32x32x1
    ModelOp concat;
    concat.type = ModelOpType::ConcatInput;
    concat.inputIndex = 0;
    model.ops.push_back(concat);

    GpuPlan plan;
    CHECK(!build(model, 16, 16, 0, plan));
    CHECK_STR_CONTAINS(plan.reason, "does not match the running tensor");
}

V4K_TEST(gpu_plan_prelu_reads_its_slopes_from_the_weight_buffer) {
    Model model;
    model.inputChannels = 1;
    model.scaleFactor = 2;
    model.ops.push_back(convOp(1, 4));
    ModelOp prelu;
    prelu.type = ModelOpType::PReLU;
    prelu.inputIndex = 0;
    prelu.weights.assign(4, 0.1f);
    model.ops.push_back(prelu);
    model.ops.push_back(pixelShuffleOp(1));

    GpuPlan plan;
    CHECK(build(model, 16, 16, 0, plan));
    CHECK(plan.feasible);
    CHECK_EQ_INT(plan.layers[1].input2Slot, -1);
    CHECK_EQ_INT(plan.layers[1].weightsCount, 4);
    CHECK_EQ_STR(plan.layers[1].output.describe(), "16x16x4");
}

V4K_TEST(gpu_plan_rejects_prelu_with_a_short_slope_table) {
    Model model;
    model.inputChannels = 1;
    model.scaleFactor = 2;
    model.ops.push_back(convOp(1, 4));
    ModelOp prelu;
    prelu.type = ModelOpType::PReLU;
    prelu.inputIndex = 0;
    prelu.weights.assign(2, 0.1f);   // 4 channels need 4 slopes (or a single shared one)
    model.ops.push_back(prelu);
    model.ops.push_back(pixelShuffleOp(1));

    GpuPlan plan;
    CHECK(!build(model, 16, 16, 0, plan));
    CHECK_STR_CONTAINS(plan.reason, "PReLU has 2 slopes for 4 channels");
}

V4K_TEST(gpu_plan_enforces_the_activation_memory_budget) {
    const Model model = nearestNeighbourModel();
    GpuPlan probe;
    CHECK(build(model, 64, 64, 0, probe));
    const uint64_t needed = probe.stats.featureBytes + probe.stats.weightBytes;
    CHECK_GT(needed, probe.stats.featureBytes);   // the model does carry weights

    GpuPlan exact;
    CHECK(build(model, 64, 64, needed, exact));
    CHECK(exact.feasible);
    CHECK_EQ_INT(exact.stats.featureBytes, probe.stats.featureBytes);

    GpuPlan tight;
    std::string error;
    CHECK(!build(model, 64, 64, needed - 1, tight, error));
    CHECK(!tight.feasible);
    CHECK_STR_CONTAINS(tight.reason, "budgeted");
    CHECK_EQ_STR(error, tight.reason);
    // An over-budget plan is still fully described: the executor never touches
    // it (buildNeuralResources() returns before allocating) and the AI Engine
    // panel uses the stats to say how much memory the resolution would need.
    CHECK_EQ_INT(tight.stats.layerCount, 2);
    CHECK_EQ_INT(tight.stats.featureBytes, probe.stats.featureBytes);

    // Bigger frames need more memory, which is what the compatibility engine
    // uses to warn before a model is ever downloaded.
    CHECK_GT(estimateWorkingSetBytes(model, 128, 128), estimateWorkingSetBytes(model, 64, 64));
    CHECK_EQ_INT(estimateWorkingSetBytes(model, 64, 64), needed);
}

V4K_TEST(gpu_plan_propagates_layer_flags) {
    Model model = nearestNeighbourModel();
    model.ops[0].flags = 0x5u;

    GpuPlan plan;
    CHECK(build(model, 16, 16, 0, plan));
    CHECK(plan.feasible);
    CHECK_EQ_INT(plan.layers[0].flags, 0x5u);
    CHECK_EQ_INT(plan.layers[1].flags, 0u);
}
