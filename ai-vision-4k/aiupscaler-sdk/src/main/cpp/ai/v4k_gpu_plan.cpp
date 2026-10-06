#include "v4k_gpu_plan.h"

#include "../core/v4k_log.h"

#include <algorithm>
#include <cstdio>
#include <cstring>

namespace v4k {
namespace {

std::string formatShape(const TensorShape& shape) {
    char buffer[64];
    std::snprintf(buffer, sizeof(buffer), "%ux%ux%u", shape.width, shape.height, shape.channels);
    return buffer;
}

std::string formatBytes(uint64_t bytes) {
    char buffer[48];
    if (bytes >= (1ull << 20)) {
        std::snprintf(buffer, sizeof(buffer), "%.1f MB", static_cast<double>(bytes) / (1024.0 * 1024.0));
    } else if (bytes >= 1024) {
        std::snprintf(buffer, sizeof(buffer), "%.1f KB", static_cast<double>(bytes) / 1024.0);
    } else {
        std::snprintf(buffer, sizeof(buffer), "%llu B", static_cast<unsigned long long>(bytes));
    }
    return buffer;
}

// A slot is reusable once nothing can touch it again.
struct SlotUse {
    uint32_t remaining = 0;
    uint32_t firstWrite = UINT32_MAX;
    uint32_t lastRead = 0;
    bool live = false;
};

}  // namespace

std::string TensorShape::describe() const { return formatShape(*this); }

const char* modelOpTypeName(ModelOpType type) {
    switch (type) {
        case ModelOpType::Conv2d: return "Conv2d";
        case ModelOpType::DepthwiseConv2d: return "DepthwiseConv2d";
        case ModelOpType::PixelShuffle: return "PixelShuffle";
        case ModelOpType::Add: return "Add";
        case ModelOpType::PReLU: return "PReLU";
        case ModelOpType::ConcatInput: return "ConcatInput";
    }
    return "Unknown";
}

bool buildGpuPlan(const Model& model, uint32_t inputWidth, uint32_t inputHeight,
                  uint64_t maxWorkingBytes, GpuPlan& out, std::string* error) {
    out = GpuPlan{};
    out.inputWidth = inputWidth;
    out.inputHeight = inputHeight;

    const auto fail = [&](const std::string& message) {
        out.feasible = false;
        out.reason = message;
        if (error != nullptr) *error = message;
        return false;
    };

    if (model.ops.empty()) return fail("model has no layers");
    if (inputWidth == 0 || inputHeight == 0) return fail("frame size is zero");
    if (model.inputChannels == 0) return fail("model declares zero input channels");
    if (model.scaleFactor != 2 && model.scaleFactor != 4) {
        return fail("model declares an unsupported scale factor");
    }

    /// --- pass 1: resolve shapes and reference counts ------------------------
    const size_t opCount = model.ops.size();
    std::vector<TensorShape> shapes(opCount + 1);      // index 0 == network input
    std::vector<int32_t> producerSlot(opCount + 1, -1); // op index -> slot, filled in pass 2
    shapes[0] = TensorShape{inputWidth, inputHeight, model.inputChannels};

    const TensorShape residualShape{inputWidth * model.scaleFactor,
                                    inputHeight * model.scaleFactor, model.inputChannels};

    // Reads per tensor, indexed the same way as `shapes`: 0 is the network
    // input, i+1 is the output of layer i. A tensor is dead once every read has
    // happened, which is what lets the working set stay small.
    std::vector<uint32_t> reads(opCount + 1, 0);
    reads[0] = 1;                                   // layer 0 consumes the input
    for (size_t i = 0; i + 1 < opCount; ++i) reads[i + 1] += 1;   // chain: layer i+1 reads it

    std::vector<ModelOpType> opTypes(opCount);
    for (size_t i = 0; i < opCount; ++i) {
        const ModelOp& op = model.ops[i];
        opTypes[i] = op.type;
        const TensorShape& in = shapes[i];
        TensorShape shape;
        std::string problem;

        switch (op.type) {
            case ModelOpType::Conv2d:
            case ModelOpType::DepthwiseConv2d: {
                const uint32_t k = op.kernelSize;
                const uint32_t stride = op.stride == 0 ? 1 : op.stride;
                if (k != 1 && k != 3) {
                    problem = "kernel size " + std::to_string(k) + " is not supported (1 or 3)";
                    break;
                }
                if (stride != 1 && stride != 2) {
                    problem = "stride " + std::to_string(stride) + " is not supported (1 or 2)";
                    break;
                }
                if (op.outputChannels == 0) {
                    problem = "layer declares zero output channels";
                    break;
                }
                const int64_t padded = static_cast<int64_t>(in.width) + 2 * op.padding;
                if (padded < static_cast<int64_t>(k)) {
                    problem = "input " + formatShape(in) + " is smaller than the " +
                              std::to_string(k) + "x" + std::to_string(k) + " kernel";
                    break;
                }
                shape.channels = op.outputChannels;
                shape.width = static_cast<uint32_t>((padded - k) / stride + 1);
                shape.height = static_cast<uint32_t>(
                    (static_cast<int64_t>(in.height) + 2 * op.padding - k) / stride + 1);

                // Same arithmetic the CPU interpreter checks before running: a
                // weight blob that does not match the geometry would read past
                // the end of the buffer on the GPU.
                const uint64_t expected =
                    (op.type == ModelOpType::DepthwiseConv2d)
                        ? static_cast<uint64_t>(op.outputChannels) * k * k
                        : static_cast<uint64_t>(op.outputChannels) * in.channels * k * k;
                if (op.weights.size() < expected) {
                    problem = std::string(modelOpTypeName(op.type)) + " layer has " +
                              std::to_string(op.weights.size()) + " weights, geometry needs " +
                              std::to_string(expected) + " (" + formatShape(in) + " -> " +
                              formatShape(shape) + ")";
                }
                if (op.bias.size() < op.outputChannels) {
                    problem = std::string(modelOpTypeName(op.type)) + " layer needs " +
                              std::to_string(op.outputChannels) + " bias values, has " +
                              std::to_string(op.bias.size());
                }
                if (op.activation == ModelActivation::PReLU &&
                    op.bias.size() < 2ull * op.outputChannels) {
                    // Conv layers with an inline PReLU keep their slopes after
                    // the biases in the same block (see sr_conv.comp). Running
                    // the layer without them would silently change the result.
                    problem = std::string(modelOpTypeName(op.type)) +
                              " layer uses an inline PReLU but its bias block holds " +
                              std::to_string(op.bias.size()) + " values for " +
                              std::to_string(op.outputChannels) + " channels; expected [" +
                              std::to_string(op.outputChannels) + " biases][slopes]";
                }
                break;
            }
            case ModelOpType::PixelShuffle: {
                const uint32_t r = 2;   // one shuffle stage doubles the resolution
                if (in.channels % (r * r) != 0) {
                    problem = "pixel shuffle needs a channel count divisible by 4, got " +
                              std::to_string(in.channels);
                    break;
                }
                shape.channels = in.channels / (r * r);
                shape.width = in.width * r;
                shape.height = in.height * r;
                break;
            }
            case ModelOpType::Add: {
                // The second operand follows the CPU interpreter's rules.
                shape = in;
                break;
            }
            case ModelOpType::PReLU: {
                shape = in;
                if (op.weights.size() < in.channels && op.weights.size() != 1) {
                    problem = "PReLU has " + std::to_string(op.weights.size()) +
                              " slopes for " + std::to_string(in.channels) + " channels";
                }
                break;
            }
            case ModelOpType::ConcatInput: {
                // Mirrors the CPU interpreter: the concatenated operand is the
                // upsampled network input, or the running tensor itself when the
                // model has no global residual (channels are then doubled).
                const TensorShape& other = model.globalResidual() ? residualShape : in;
                if (other.width != in.width || other.height != in.height) {
                    problem = "ConcatInput operand " + formatShape(other) +
                              " does not match the running tensor " + formatShape(in);
                    break;
                }
                shape.channels = in.channels + other.channels;
                shape.width = in.width;
                shape.height = in.height;
                break;
            }
        }

        if (!problem.empty()) {
            return fail("layer " + std::to_string(i) + " (" + modelOpTypeName(op.type) + "): " +
                        problem);
        }
        if (!shape.valid()) {
            return fail("layer " + std::to_string(i) + " (" + modelOpTypeName(op.type) +
                        ") produced an empty tensor");
        }
        shapes[i + 1] = shape;

        if (op.type == ModelOpType::Add || op.type == ModelOpType::ConcatInput) {
            int32_t otherIndex = op.input2Index;
            if (op.type == ModelOpType::Add) {
                if (otherIndex < 0) {
                    if (!model.globalResidual()) {
                        return fail("layer " + std::to_string(i) +
                                    " adds the model input without a global residual flag");
                    }
                    out.appliesGlobalResidual = true;
                } else {
                    if (static_cast<size_t>(otherIndex) > i) {
                        return fail("layer " + std::to_string(i) +
                                    " references a tensor that does not exist yet");
                    }
                    const TensorShape& other = shapes[static_cast<size_t>(otherIndex) + 1];
                    if (!other.sameAs(in)) {
                        return fail("layer " + std::to_string(i) + " adds " + formatShape(other) +
                                    " to " + formatShape(in) + ": shapes differ");
                    }
                    reads[static_cast<size_t>(otherIndex) + 1] += 1;
                }
            } else if (model.globalResidual()) {
                out.appliesGlobalResidual = true;
            }
        }
    }

    const TensorShape output = shapes[opCount];
    out.output = output;
    if (output.width != inputWidth * model.scaleFactor ||
        output.height != inputHeight * model.scaleFactor) {
        out.warnings.push_back(
            "network output " + formatShape(output) + " is not the declared " +
            std::to_string(model.scaleFactor) + "x of the " +
            std::to_string(inputWidth) + "x" + std::to_string(inputHeight) + " input");
    }
    if (model.globalResidual() && !output.sameAs(residualShape)) {
        return fail("global residual needs the network output to be " +
                    formatShape(residualShape) + ", but the graph produces " + formatShape(output));
    }
    out.appliesGlobalResidual = out.appliesGlobalResidual || model.globalResidual();

    /// --- pass 2: slot assignment with liveness based reuse ------------------
    // Every tensor lives in a slot; a slot is handed back to the pool once the
    // last reader has consumed it. On a 1080p frame the working set is what
    // decides whether a model fits in a phone's memory budget, so the assignment
    // is explicit rather than "one buffer per layer".
    std::vector<SlotUse> uses;
    const auto newSlot = [&](const TensorShape& shape, uint32_t readCount, uint32_t step) {
        out.slots.push_back(shape);
        SlotUse use;
        use.remaining = readCount;
        use.firstWrite = step;
        use.lastRead = step;
        use.live = readCount > 0;
        uses.push_back(use);
        return static_cast<int32_t>(out.slots.size() - 1);
    };

    int32_t inputSlot = newSlot(shapes[0], reads[0], 0);
    int32_t residualSlot = -1;
    if (out.appliesGlobalResidual) {
        // Written before the first layer (bicubic_residual.comp) and consumed by
        // the trailing skip add.
        residualSlot = newSlot(residualShape, 1, 0);
    }
    out.residualSlot = residualSlot;

    std::vector<int32_t> slotOfOp(opCount, -1);
    const auto takeFreeSlot = [&]() {
        for (int32_t slot = static_cast<int32_t>(out.slots.size()) - 1; slot > 0; --slot) {
            const SlotUse& use = uses[static_cast<size_t>(slot)];
            if (use.firstWrite != UINT32_MAX && !use.live && use.remaining == 0) return slot;
        }
        return -1;
    };
    const auto release = [&](int32_t slot, uint32_t step) {
        if (slot < 0) return;
        SlotUse& use = uses[static_cast<size_t>(slot)];
        if (use.remaining > 0) use.remaining -= 1;
        use.lastRead = std::max(use.lastRead, step);
        use.live = use.remaining > 0;
    };

    int32_t currentSlot = inputSlot;
    for (size_t i = 0; i < opCount; ++i) {
        const ModelOp& op = model.ops[i];
        const uint32_t step = static_cast<uint32_t>(i + 1);

        int32_t in2Slot = -1;
        if (op.type == ModelOpType::Add) {
            if (op.input2Index < 0) {
                in2Slot = residualSlot;
            } else if (static_cast<size_t>(op.input2Index) >= i) {
                in2Slot = currentSlot;   // CPU semantics: "current"
            } else {
                in2Slot = slotOfOp[static_cast<size_t>(op.input2Index)];
            }
        } else if (op.type == ModelOpType::ConcatInput) {
            in2Slot = (out.appliesGlobalResidual && model.globalResidual()) ? residualSlot
                                                                           : currentSlot;
        } else if (op.type == ModelOpType::PReLU) {
            in2Slot = -1;   // slopes come from the weight buffer, not a tensor
        }

        int32_t outSlot = takeFreeSlot();
        if (outSlot < 0) {
            outSlot = newSlot(shapes[i + 1], reads[i + 1], step);
        } else {
            out.slots[static_cast<size_t>(outSlot)] = shapes[i + 1];
            SlotUse& use = uses[static_cast<size_t>(outSlot)];
            use.remaining = reads[i + 1];
            use.firstWrite = step;
            use.lastRead = step;
            use.live = use.remaining > 0;
        }

        LayerPlan layer;
        layer.type = op.type;
        layer.inputIndex = op.inputIndex;
        layer.input2Index = op.input2Index;
        layer.inputSlot = currentSlot;
        layer.input2Slot = in2Slot;
        layer.outputSlot = outSlot;
        layer.input = shapes[i];
        layer.output = shapes[i + 1];
        layer.kernel = op.kernelSize;
        layer.stride = op.stride == 0 ? 1 : op.stride;
        layer.padding = op.padding;
        layer.activation = op.activation;
        layer.weightsCount = op.weights.size();
        layer.biasCount = op.bias.size();
        layer.flags = op.flags;
        layer.writesResource = op.type != ModelOpType::Conv2d &&
                               op.type != ModelOpType::DepthwiseConv2d;
        out.layers.push_back(layer);

        // Consume both operands *after* the layer records them.
        if (in2Slot >= 0 && in2Slot != currentSlot) release(in2Slot, step);
        release(currentSlot, step);
        if (in2Slot == currentSlot && in2Slot >= 0) {
            // Self referencing Add: one extra read of the same slot.
            release(currentSlot, step);
        }

        slotOfOp[i] = outSlot;
        currentSlot = outSlot;
    }

    if (residualSlot >= 0) release(residualSlot, static_cast<uint32_t>(opCount + 1));

    /// --- statistics ---------------------------------------------------------
    out.stats.slotCount = static_cast<uint32_t>(out.slots.size());
    out.stats.layerCount = static_cast<uint32_t>(out.layers.size());
    for (const TensorShape& shape : out.slots) {
        out.stats.featureBytes += shape.bytes();
    }
    for (const ModelOp& op : model.ops) {
        out.stats.weightBytes += (op.weights.size() + op.bias.size()) * sizeof(float);
    }

    // Peak simultaneity: sweep the layer sequence and track which slots are
    // live, which is what the driver actually has to hold at one instant.
    uint64_t peak = 0;
    for (size_t i = 0; i < out.slots.size(); ++i) {
        const SlotUse& use = uses[i];
        if (use.firstWrite == UINT32_MAX) continue;
        uint64_t simultaneous = out.slots[i].bytes();
        for (size_t j = 0; j < out.slots.size(); ++j) {
            if (j == i) continue;
            const SlotUse& other = uses[j];
            if (other.firstWrite == UINT32_MAX) continue;
            // Both live at the same step when their [firstWrite, lastRead]
            // intervals overlap.
            if (other.firstWrite <= use.lastRead && other.lastRead >= use.firstWrite) {
                simultaneous += out.slots[j].bytes();
            }
        }
        peak = std::max(peak, simultaneous);
    }
    out.stats.activationBytes = peak;

    if (maxWorkingBytes > 0 && out.stats.featureBytes + out.stats.weightBytes > maxWorkingBytes) {
        return fail("the model needs " + formatBytes(out.stats.featureBytes + out.stats.weightBytes) +
                    " of GPU memory at this resolution but only " +
                    formatBytes(maxWorkingBytes) + " is budgeted");
    }

    out.feasible = true;
    if (error != nullptr) error->clear();

    V4K_LOGV("gpu plan: %u layers, %u slots, %s activations + %s weights, %ux%u -> %ux%u", out.stats.layerCount,
             out.stats.slotCount, formatBytes(out.stats.activationBytes).c_str(),
             formatBytes(out.stats.weightBytes).c_str(), inputWidth, inputHeight, out.output.width,
             out.output.height);
    for (const std::string& warning : out.warnings) {
        V4K_LOGV("gpu plan warning: %s", warning.c_str());
        // The macro is empty in a release build, so mark the loop variable used
        // rather than letting -Wunused-variable fire in that configuration.
        (void)warning;
    }
    return true;
}

uint64_t estimateWorkingSetBytes(const Model& model, uint32_t inputWidth, uint32_t inputHeight) {
    GpuPlan plan;
    if (!buildGpuPlan(model, inputWidth, inputHeight, 0, plan, nullptr)) {
        return 0;
    }
    return plan.stats.featureBytes + plan.stats.weightBytes;
}

}  // namespace v4k
