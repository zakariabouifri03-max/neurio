// CPU reference interpreter for .v4kmodel graphs.
//
// This is the *reference* implementation. It runs the exact same graph the
// Vulkan backend executes and is used to
//   * validate a freshly exported/quantised model (numeric sanity check),
//   * run tiny test resolutions,
//   * provide a fallback when no GPU backend can be created.
//
// It is single threaded unless enabled otherwise, and it is honest about being
// far too slow for real-time use on a mobile CPU at 1080p.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "v4k_model.h"

namespace v4k {

struct InferenceStats {
    double lastTotalUs = 0.0;
    double lastConvUs = 0.0;
    double emaTotalUs = 0.0;
    uint64_t framesProcessed = 0;
    uint64_t macsPerFrame = 0;
    std::string backendNote;
};

class CpuInference {
public:
    CpuInference() = default;

    // Validates shapes and prepares the plan. Returns false with a reason.
    bool prepare(const Model& model, std::string* error);
    bool ready() const { return ready_; }

    // Planar CHW float input in [0,1], `inputChannels` planes; output is
    // planar RGB (3 planes) or single plane for luma models, at
    // (inW*scale) x (inH*scale).
    bool run(const float* input, uint32_t inWidth, uint32_t inHeight, float* output);

    const InferenceStats& stats() const { return stats_; }
    uint32_t outputWidth(uint32_t inWidth) const { return inWidth * scaleFactor_; }
    uint32_t outputHeight(uint32_t inHeight) const { return inHeight * scaleFactor_; }

    // Row-parallel convolution. 1 == fully deterministic single thread (used by
    // the unit tests); >1 uses std::thread row partitioning.
    void setThreadCount(int threads) { threadCount_ = threads < 1 ? 1 : threads; }

private:
    struct Tensor {
        uint32_t channels = 0;
        uint32_t width = 0;
        uint32_t height = 0;
        std::vector<float> data;

        void allocate(uint32_t c, uint32_t w, uint32_t h, float fill = 0.0f) {
            channels = c;
            width = w;
            height = h;
            data.assign(static_cast<size_t>(c) * w * h, fill);
        }
        size_t plane() const { return static_cast<size_t>(width) * height; }
        float* at(uint32_t c, uint32_t x, uint32_t y) {
            return data.data() + static_cast<size_t>(c) * plane() + static_cast<size_t>(y) * width + x;
        }
        const float* at(uint32_t c, uint32_t x, uint32_t y) const {
            return data.data() + static_cast<size_t>(c) * plane() + static_cast<size_t>(y) * width + x;
        }
        float getClamped(uint32_t c, int x, int y) const {
            const int cx = x < 0 ? 0 : (x >= static_cast<int>(width) ? static_cast<int>(width) - 1 : x);
            const int cy = y < 0 ? 0 : (y >= static_cast<int>(height) ? static_cast<int>(height) - 1 : y);
            return *at(c, static_cast<uint32_t>(cx), static_cast<uint32_t>(cy));
        }
    };

    bool runConv(const ModelOp& op, const Tensor& in, Tensor& out);
    bool runDepthwise(const ModelOp& op, const Tensor& in, Tensor& out);
    bool runPixelShuffle(const ModelOp& op, const Tensor& in, Tensor& out);
    bool runAdd(const Tensor& a, const Tensor& b, Tensor& out);
    bool runPrelu(const ModelOp& op, const Tensor& in, Tensor& out);
    bool applyActivation(ModelActivation activation, const ModelOp& op, Tensor& t);
    bool upsampleInput(const Tensor& input, Tensor& out);

    Model model_;
    bool ready_ = false;
    uint32_t scaleFactor_ = 2;
    uint32_t inputChannels_ = 3;
    int threadCount_ = 1;
    InferenceStats stats_;
    std::vector<Tensor> intermediates_;
};

}  // namespace v4k
