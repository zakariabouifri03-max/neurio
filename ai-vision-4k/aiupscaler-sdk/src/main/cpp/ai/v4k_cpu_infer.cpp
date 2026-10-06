#include "v4k_cpu_infer.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <functional>
#include <cstring>
#include <thread>

#include "../core/v4k_image.h"
#include "../core/v4k_log.h"

namespace v4k {
namespace {

double nowUs() {
    using clock = std::chrono::steady_clock;
    return std::chrono::duration<double, std::micro>(clock::now().time_since_epoch()).count();
}

void parallelRows(uint32_t rows, int threads, const std::function<void(uint32_t, uint32_t)>& body) {
    if (threads <= 1 || rows == 0) {
        body(0, rows);
        return;
    }
    const uint32_t chunks = static_cast<uint32_t>(threads);
    std::vector<std::thread> pool;
    pool.reserve(chunks);
    for (uint32_t c = 0; c < chunks; ++c) {
        const uint32_t begin = rows * c / chunks;
        const uint32_t end = rows * (c + 1) / chunks;
        if (begin >= end) continue;
        pool.emplace_back([&body, begin, end]() { body(begin, end); });
    }
    for (auto& t : pool) t.join();
}

}  // namespace

bool CpuInference::prepare(const Model& model, std::string* error) {
    model_ = model;
    scaleFactor_ = model.scaleFactor;
    inputChannels_ = model.inputChannels;
    intermediates_.clear();
    ready_ = false;

    if (model.ops.empty()) {
        if (error != nullptr) *error = "model contains no ops";
        return false;
    }
    // Depth-first sanity check of channel counts and weight sizes.
    for (size_t i = 0; i < model.ops.size(); ++i) {
        const ModelOp& op = model.ops[i];
        switch (op.type) {
            case ModelOpType::Conv2d: {
                const uint64_t expected = static_cast<uint64_t>(op.outputChannels) *
                                          op.inputChannels * op.kernelSize * op.kernelSize;
                if (op.weights.size() != expected) {
                    if (error != nullptr) {
                        *error = "op " + std::to_string(i) + " (conv): expected " +
                                 std::to_string(expected) + " weights, found " +
                                 std::to_string(op.weights.size());
                    }
                    return false;
                }
                if (!op.bias.empty() && op.bias.size() != op.outputChannels) {
                    if (error != nullptr) *error = "op " + std::to_string(i) + " (conv): bad bias size";
                    return false;
                }
                break;
            }
            case ModelOpType::DepthwiseConv2d: {
                const uint64_t expected = static_cast<uint64_t>(op.outputChannels) *
                                          op.kernelSize * op.kernelSize;
                if (op.weights.size() != expected) {
                    if (error != nullptr) {
                        *error = "op " + std::to_string(i) + " (depthwise): expected " +
                                 std::to_string(expected) + " weights, found " +
                                 std::to_string(op.weights.size());
                    }
                    return false;
                }
                break;
            }
            case ModelOpType::PReLU: {
                if (op.weights.size() != op.outputChannels && !op.weights.empty()) {
                    if (error != nullptr) *error = "op " + std::to_string(i) + " (prelu): bad slope count";
                    return false;
                }
                break;
            }
            case ModelOpType::PixelShuffle:
            case ModelOpType::Add:
            case ModelOpType::ConcatInput:
                break;
        }
    }

    stats_.macsPerFrame = model.estimateMacs(1280, 720);
    stats_.backendNote = "CPU reference interpreter";
    ready_ = true;
    return true;
}

bool CpuInference::runConv(const ModelOp& op, const Tensor& in, Tensor& out) {
    const uint32_t k = op.kernelSize;
    const uint32_t pad = op.padding;
    const uint32_t stride = op.stride == 0 ? 1 : op.stride;

    const uint32_t outW = (in.width + 2 * pad - k) / stride + 1;
    const uint32_t outH = (in.height + 2 * pad - k) / stride + 1;
    out.allocate(op.outputChannels, outW, outH);

    parallelRows(outH, threadCount_, [&](uint32_t rowBegin, uint32_t rowEnd) {
        for (uint32_t oy = rowBegin; oy < rowEnd; ++oy) {
            const int iy0 = static_cast<int>(oy * stride) - static_cast<int>(pad);
            for (uint32_t ox = 0; ox < outW; ++ox) {
                const int ix0 = static_cast<int>(ox * stride) - static_cast<int>(pad);
                for (uint32_t oc = 0; oc < op.outputChannels; ++oc) {
                    float acc = op.bias.empty() ? 0.0f : op.bias[oc];
                    const float* weights =
                        op.weights.data() + static_cast<size_t>(oc) * op.inputChannels * k * k;
                    for (uint32_t ic = 0; ic < op.inputChannels; ++ic) {
                        for (uint32_t ky = 0; ky < k; ++ky) {
                            const int sy = iy0 + static_cast<int>(ky);
                            for (uint32_t kx = 0; kx < k; ++kx) {
                                const int sx = ix0 + static_cast<int>(kx);
                                const float v = in.getClamped(ic, sx, sy);
                                if (v == 0.0f) continue;
                                acc += v * weights[(static_cast<size_t>(ic) * k + ky) * k + kx];
                            }
                        }
                    }
                    *out.at(oc, ox, oy) = acc;
                }
            }
        }
    });
    return true;
}

bool CpuInference::runDepthwise(const ModelOp& op, const Tensor& in, Tensor& out) {
    const uint32_t k = op.kernelSize;
    const uint32_t pad = op.padding;
    const uint32_t stride = op.stride == 0 ? 1 : op.stride;
    const uint32_t outW = (in.width + 2 * pad - k) / stride + 1;
    const uint32_t outH = (in.height + 2 * pad - k) / stride + 1;
    out.allocate(op.outputChannels, outW, outH);

    parallelRows(outH, threadCount_, [&](uint32_t rowBegin, uint32_t rowEnd) {
        for (uint32_t oy = rowBegin; oy < rowEnd; ++oy) {
            const int iy0 = static_cast<int>(oy * stride) - static_cast<int>(pad);
            for (uint32_t ox = 0; ox < outW; ++ox) {
                const int ix0 = static_cast<int>(ox * stride) - static_cast<int>(pad);
                for (uint32_t c = 0; c < op.outputChannels; ++c) {
                    float acc = op.bias.empty() ? 0.0f : op.bias[c];
                    const float* weights = op.weights.data() + static_cast<size_t>(c) * k * k;
                    for (uint32_t ky = 0; ky < k; ++ky) {
                        for (uint32_t kx = 0; kx < k; ++kx) {
                            const float v = in.getClamped(c, ix0 + static_cast<int>(kx),
                                                          iy0 + static_cast<int>(ky));
                            if (v == 0.0f) continue;
                            acc += v * weights[ky * k + kx];
                        }
                    }
                    *out.at(c, ox, oy) = acc;
                }
            }
        }
    });
    return true;
}

bool CpuInference::runPixelShuffle(const ModelOp& op, const Tensor& in, Tensor& out) {
    // ESPCN sub-pixel convolution: [C*r*r][H][W] -> [C][H*r][W*r]
    const uint32_t r = 2;  // scale 2 per shuffle stage; scale 4 models chain two
    if (in.channels % (r * r) != 0) return false;
    const uint32_t outC = in.channels / (r * r);
    const uint32_t outW = in.width * r;
    const uint32_t outH = in.height * r;
    out.allocate(outC, outW, outH);

    for (uint32_t c = 0; c < outC; ++c) {
        for (uint32_t sy = 0; sy < r; ++sy) {
            for (uint32_t sx = 0; sx < r; ++sx) {
                const uint32_t srcC = c * r * r + sy * r + sx;
                for (uint32_t y = 0; y < in.height; ++y) {
                    for (uint32_t x = 0; x < in.width; ++x) {
                        *out.at(c, x * r + sx, y * r + sy) = *in.at(srcC, x, y);
                    }
                }
            }
        }
    }
    (void)op;
    return true;
}

bool CpuInference::runAdd(const Tensor& a, const Tensor& b, Tensor& out) {
    if (a.channels != b.channels || a.width != b.width || a.height != b.height) return false;
    out.allocate(a.channels, a.width, a.height);
    for (size_t i = 0; i < a.data.size(); ++i) out.data[i] = a.data[i] + b.data[i];
    return true;
}

bool CpuInference::runPrelu(const ModelOp& op, const Tensor& in, Tensor& out) {
    out.allocate(in.channels, in.width, in.height);
    for (uint32_t c = 0; c < in.channels; ++c) {
        const float slope = op.weights.empty() ? 0.0f : op.weights[c % op.weights.size()];
        const float* src = in.at(c, 0, 0);
        float* dst = out.at(c, 0, 0);
        for (size_t i = 0; i < in.plane(); ++i) {
            dst[i] = src[i] >= 0.0f ? src[i] : src[i] * slope;
        }
    }
    return true;
}

bool CpuInference::applyActivation(ModelActivation activation, const ModelOp& op, Tensor& t) {
    switch (activation) {
        case ModelActivation::None:
            return true;
        case ModelActivation::Relu:
            for (float& v : t.data) v = v > 0.0f ? v : 0.0f;
            return true;
        case ModelActivation::LeakyRelu:
            for (float& v : t.data) v = v > 0.0f ? v : v * 0.1f;
            return true;
        case ModelActivation::PReLU: {
            Tensor activated;
            if (!runPrelu(op, t, activated)) return false;
            t = std::move(activated);
            return true;
        }
    }
    return false;
}

bool CpuInference::upsampleInput(const Tensor& input, Tensor& out) {
    // `input` is planar CHW and Image is interleaved HWC: convert rather than
    // reinterpreting the buffer. Assigning a planar tensor to Image::data does
    // not fail, it scrambles the channels -- which is exactly what happened here
    // until the model exporter's global-residual calibration check caught the
    // resulting 0.65 maximum error.
    const Image planar = imageFromPlanar(input.data.data(), static_cast<int>(input.width),
                                        static_cast<int>(input.height), static_cast<int>(input.channels));
    // Only colour inputs (1 or 3 channels) are supported by the reference path.
    const Image up = resizeBicubic(planar, input.width * scaleFactor_, input.height * scaleFactor_);
    out.allocate(up.channels, up.width, up.height);
    out.data = imageToPlanar(up);
    return true;
}

bool CpuInference::run(const float* input, uint32_t inWidth, uint32_t inHeight, float* output) {
    if (!ready_ || input == nullptr || output == nullptr) return false;
    if (inWidth == 0 || inHeight == 0) return false;

    const double startUs = nowUs();
    intermediates_.clear();

    Tensor current;
    current.allocate(inputChannels_, inWidth, inHeight);
    std::memcpy(current.data.data(), input,
                static_cast<size_t>(inputChannels_) * inWidth * inHeight * sizeof(float));

    // For the residual trick the network operates on the upsampled input.
    Tensor residual;
    const bool needResidual = model_.globalResidual();
    if (needResidual) {
        upsampleInput(current, residual);
        if (model_.inputChannels != residual.channels) {
            // Luma model: expand the reference to the model's channel count.
            Tensor expanded;
            expanded.allocate(model_.inputChannels, residual.width, residual.height);
            for (uint32_t c = 0; c < model_.inputChannels; ++c) {
                const float* src = residual.at(c % residual.channels, 0, 0);
                std::memcpy(expanded.at(c, 0, 0), src, residual.plane() * sizeof(float));
            }
            residual = std::move(expanded);
        }
    }

    Tensor next;
    for (size_t i = 0; i < model_.ops.size(); ++i) {
        const ModelOp& op = model_.ops[i];
        next = Tensor{};
        switch (op.type) {
            case ModelOpType::Conv2d:
                if (!runConv(op, current, next)) return false;
                break;
            case ModelOpType::DepthwiseConv2d:
                if (!runDepthwise(op, current, next)) return false;
                break;
            case ModelOpType::PixelShuffle:
                if (!runPixelShuffle(op, current, next)) return false;
                break;
            case ModelOpType::PReLU:
                if (!runPrelu(op, current, next)) return false;
                break;
            case ModelOpType::Add: {
                const int otherIndex = op.input2Index;
                const Tensor& other = (otherIndex < 0) ? residual
                                       : (otherIndex >= static_cast<int>(i))
                                           ? current
                                           : intermediates_[static_cast<size_t>(otherIndex)];
                if (!runAdd(current, other, next)) return false;
                break;
            }
            case ModelOpType::ConcatInput: {
                // Concatenate the (upsampled) network input to the current
                // features. Spatial sizes must already match.
                const Tensor& inputRef = needResidual ? residual : current;
                if (inputRef.width != current.width || inputRef.height != current.height) return false;
                next.allocate(current.channels + inputRef.channels, current.width, current.height);
                std::memcpy(next.at(0, 0, 0), current.data.data(),
                            current.data.size() * sizeof(float));
                std::memcpy(next.at(current.channels, 0, 0), inputRef.data.data(),
                            inputRef.data.size() * sizeof(float));
                break;
            }
        }
        if (op.type != ModelOpType::Add && op.type != ModelOpType::PixelShuffle &&
            op.type != ModelOpType::ConcatInput) {
            if (!applyActivation(op.activation, op, next)) return false;
        }
        intermediates_.push_back(next);
        current = std::move(next);
    }

    // Global residual add: output = bicubic(input) + network(input).
    if (needResidual) {
        if (current.channels != residual.channels || current.width != residual.width ||
            current.height != residual.height) {
            V4K_LOGW("cpu_infer: residual shape mismatch, skipping the skip connection");
        } else {
            for (size_t k = 0; k < current.data.size(); ++k) current.data[k] += residual.data[k];
        }
    }

    // Clamp to [0,1] and copy out in planar RGB order.
    const uint32_t outChannels = std::min<uint32_t>(3, std::max<uint32_t>(1, current.channels));
    if (current.channels < outChannels) return false;
    for (uint32_t c = 0; c < outChannels; ++c) {
        const float* src = current.at(c, 0, 0);
        float* dst = output + static_cast<size_t>(c) * current.width * current.height;
        for (size_t k = 0; k < current.plane(); ++k) {
            dst[k] = std::min(1.0f, std::max(0.0f, src[k]));
        }
    }

    const double totalUs = nowUs() - startUs;
    stats_.lastTotalUs = totalUs;
    stats_.emaTotalUs = stats_.framesProcessed == 0 ? totalUs
                                                    : 0.15 * totalUs + 0.85 * stats_.emaTotalUs;
    ++stats_.framesProcessed;
    return true;
}

}  // namespace v4k
