// Export a .v4kmodel container.
//
// This is the supported way to produce a model file. It builds the graph in C++
// and hands it to `v4k::writeModel()`, the same writer the engine reads with, so
// the container can never drift from the loader.
//
// ## What it does *not* do
//
// It does not train anything and it ships no learned weights.
//
// What it produces are **calibration models**: graphs whose output is known
// analytically, so they can prove that container, loader, planner, interpreter
// and (once the GPU executor lands) the Vulkan kernels all perform the same
// arithmetic on a real device. Two graphs are available:
//
//   --arch subpixel   sub-pixel convolution (ESPCN shape) whose phase kernels are
//                     exactly the bilinear filters, so the output must equal
//                     `resizeBilinear()` of the input. Exercises Conv2d,
//                     PixelShuffle and the LR-from-sub-pixel path.
//
//   --arch residual   a global-residual graph whose network is deliberately
//                     zero: output = bicubic(input) + 0. Exercises the
//                     kModelFlagGlobalResidual path, the internal pre-upsample
//                     and the Add stage.
//
// Both are *linear*: their image quality is bilinear / bicubic quality, not "AI"
// quality. Every screen that displays them must say so. There is no way to get a
// better-looking output out of this tool — a real model comes from a training
// pipeline, and the container it has to be written into is the one this tool
// writes (see tools/model/README.md).
//
// `--init untrained` swaps the calibration kernels for a deterministic He-scaled
// pseudo-random draw. That is useful for shaking out the GPU kernels with values
// far from saturation, and useless for anything else: its output is noise.
//
// Usage:
//   export_v4kmodel --out reference_sr_x2.v4kmodel [--arch subpixel|residual]
//                   [--tier lite|balanced|quality] [--scale 2|4]
//                   [--init bilinear|untrained] [--seed N] [--fp16] [--verify]
//                   [--plan-check 1280x720] [--device-memory-mib 2048]
//
// `--verify` loads the file back, runs the CPU reference interpreter and checks
// the result against the analytic reference: it exits non-zero when the
// calibration model does not reproduce its reference to float precision.
//
// `--plan-check WxH` additionally runs the real GPU planner (`buildGpuPlan()`,
// the same call the Vulkan pipeline makes on device, on the same budgets) and
// fails if the graph is not schedulable at that resolution. A model that is
// numerically correct but does not fit the activation budget would otherwise
// only fail on a phone; this catches it in CI.

#include "ai/v4k_cpu_infer.h"
#include "ai/v4k_gpu_plan.h"
#include "ai/v4k_model.h"
#include "core/v4k_image.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

namespace {

struct Options {
    std::string output = "reference_sr_x2.v4kmodel";
    std::string arch = "subpixel";
    std::string tier = "lite";
    uint32_t scale = 2;
    std::string init = "bilinear";
    uint32_t seed = 20261006u;
    bool fp16 = false;
    bool verify = false;
    // Resolutions the GPU planner must be able to schedule, as "1280x720".
    std::vector<std::string> planChecks = {"1280x720"};
    // Device memory the session would report, in MiB. The planner budget is
    // derived from it with the same policy the engine uses.
    uint64_t deviceMemoryMiB = 2048;
};

/** Tolerance for "reproduces the analytic reference", in [0,1] units. */
constexpr double kCalibrationTolerance = 1e-4;

uint32_t channelsForTier(const std::string& tier) {
    if (tier == "lite") return 16;
    if (tier == "balanced") return 32;
    if (tier == "quality") return 48;
    std::fprintf(stderr, "unknown tier '%s' (lite|balanced|quality)\n", tier.c_str());
    std::exit(2);
}

uint32_t qualityForTier(const std::string& tier) {
    // Matches AiQuality in core/v4k_common.h: LOW=1, MEDIUM=2, HIGH=3, ULTRA=4.
    if (tier == "lite") return 1;
    if (tier == "balanced") return 2;
    return 3;
}

// Deterministic PRNG: a model file must be byte-identical for a given seed, or
// a checksum in a build script would be meaningless.
class Lcg {
public:
    explicit Lcg(uint32_t seed) : state_(seed ? seed : 1u) {}

    float next() {
        state_ = state_ * 1664525u + 1013904223u;
        const uint32_t bits = (state_ >> 8) & 0x00FFFFFFu;
        return static_cast<float>(bits) / static_cast<float>(0x00800000u) * 2.0f - 1.0f;
    }

private:
    uint32_t state_;
};

/** Weight index for a conv laid out [outputChannels][inputChannels][3][3]. */
size_t weightIndex(uint32_t inputChannels, uint32_t oc, uint32_t ic, uint32_t ky, uint32_t kx) {
    return (static_cast<size_t>(oc) * inputChannels + ic) * 9 + ky * 3 + kx;
}

v4k::ModelOp convOp(uint32_t inputChannels,
                    uint32_t outputChannels,
                    v4k::ModelActivation activation,
                    const Options& options,
                    Lcg& rng) {
    v4k::ModelOp op;
    op.type = v4k::ModelOpType::Conv2d;
    op.inputChannels = inputChannels;
    op.outputChannels = outputChannels;
    op.kernelSize = 3;
    op.stride = 1;
    op.padding = 1;
    op.activation = activation;
    op.weights.assign(static_cast<size_t>(outputChannels) * inputChannels * 9, 0.0f);
    if (options.init == "untrained") {
        const float limit = std::sqrt(2.0f / static_cast<float>(inputChannels * 9));
        for (float& value : op.weights) value = rng.next() * limit;
    }
    // A bias of zero is not laziness: a non-zero bias would push the output away
    // from the reference's range and make the calibration check meaningless.
    op.bias.assign(outputChannels, 0.0f);
    return op;
}

v4k::ModelOp shuffleOp(uint32_t channels) {
    v4k::ModelOp op;
    op.type = v4k::ModelOpType::PixelShuffle;
    op.inputChannels = channels;
    op.outputChannels = channels / 4;
    op.kernelSize = 1;
    op.stride = 1;
    op.padding = 0;
    return op;
}

/** Identity 3x3 conv: passes channel `ic` through to channel `oc == ic`. */
v4k::ModelOp identityOp(uint32_t channels, const Options& options, Lcg& rng) {
    v4k::ModelOp op = convOp(channels, channels, v4k::ModelActivation::None, options, rng);
    if (options.init == "bilinear") {
        for (uint32_t c = 0; c < channels; ++c) {
            op.weights[weightIndex(channels, c, c, 1, 1)] = 1.0f;
        }
    }
    return op;
}

/**
 * The bilinear phase filter for one axis at scale 2, in 3x3-kernel tap space.
 *
 * `resizeBilinear()` maps output pixel `2n` to `n - 0.25` and `2n+1` to `n +
 * 0.25`, clamping at the edge. A 3x3 kernel centred on input row `n` reads taps
 * {0: row n-1, 1: row n, 2: row n+1}, so:
 *
 *   even output (offset -0.25): 0.75 * row n + 0.25 * row n-1
 *   odd  output (offset +0.25): 0.75 * row n + 0.25 * row n+1
 *
 * Both phases put 0.75 on the centre tap. A wrong table shows up immediately as
 * a sub-pixel shift in the verification below.
 */
float phaseWeight(uint32_t phase, uint32_t tap) {
    if (tap == 1) return 0.75f;
    if (phase == 0) return tap == 0 ? 0.25f : 0.0f;
    return tap == 2 ? 0.25f : 0.0f;
}

/**
 * Sub-pixel head: 3 input channels -> 3 * 4 output channels holding the bilinear
 * phase filters, laid out so PixelShuffle(2) interleaves them into output pixels.
 *
 * Channel index into the head output is `c * 4 + vertical * 2 + horizontal`,
 * matching the rearrange in `runPixelShuffle()`.
 */
v4k::ModelOp headOp(uint32_t inputChannels, const Options& options, Lcg& rng) {
    v4k::ModelOp op = convOp(inputChannels, 3 * 4, v4k::ModelActivation::None, options, rng);
    if (options.init == "bilinear") {
        for (uint32_t c = 0; c < 3 && c < inputChannels; ++c) {
            for (uint32_t vertical = 0; vertical < 2; ++vertical) {
                for (uint32_t horizontal = 0; horizontal < 2; ++horizontal) {
                    const uint32_t oc = c * 4 + vertical * 2 + horizontal;
                    for (uint32_t ky = 0; ky < 3; ++ky) {
                        for (uint32_t kx = 0; kx < 3; ++kx) {
                            const float weight = phaseWeight(vertical, ky) * phaseWeight(horizontal, kx);
                            op.weights[weightIndex(inputChannels, oc, c, ky, kx)] = weight;
                        }
                    }
                }
            }
        }
    }
    return op;
}

v4k::Model buildSubpixelModel(const Options& options) {
    const uint32_t body = channelsForTier(options.tier);
    const uint32_t rgb = 3;
    Lcg rng(options.seed);

    v4k::Model model;
    model.inputChannels = rgb;
    model.scaleFactor = options.scale;
    model.flags = 0;
    model.weightFormat = options.fp16 ? v4k::ModelWeightFormat::Fp16 : v4k::ModelWeightFormat::Fp32;
    model.qualityTier = qualityForTier(options.tier);
    model.version = 1;
    model.displayName = "Reference SR x" + std::to_string(options.scale) + " (sub-pixel)";

    // One stage per factor of two, ESPCN style: the network runs at the *input*
    // resolution and PixelShuffle does the 2x.
    auto appendStage = [&](uint32_t inputChannels) {
        if (options.init == "bilinear") {
            // Linear throughout: any non-linearity would stop the graph from
            // reproducing bilinear interpolation, which is the point.
            model.ops.push_back(identityOp(inputChannels, options, rng));
            model.ops.push_back(identityOp(inputChannels, options, rng));
            model.ops.push_back(headOp(inputChannels, options, rng));
        } else {
            model.ops.push_back(convOp(inputChannels, body, v4k::ModelActivation::Relu, options, rng));
            model.ops.push_back(convOp(body, body, v4k::ModelActivation::Relu, options, rng));
            model.ops.push_back(convOp(body, rgb * 4u, v4k::ModelActivation::None, options, rng));
        }
        model.ops.push_back(shuffleOp(rgb * 4u));
    };

    if (options.scale == 2) {
        appendStage(rgb);
    } else if (options.scale == 4) {
        // Two chained 2x stages run at input and then 2x resolution.
        appendStage(rgb);
        appendStage(rgb);
    } else {
        std::fprintf(stderr, "--scale must be 2 or 4\n");
        std::exit(2);
    }
    return model;
}

/**
 * Bicubic-plus-residual graph.
 *
 * The interpreter upsamples the input bicubically to the output resolution and
 * adds the network's output to it, so the network must itself produce a tensor
 * at output resolution. `conv(3 -> 3*4) -> PixelShuffle` does that. With the
 * conv weights left at zero the network contributes nothing and the file must
 * reproduce `resizeBicubic()` exactly — a check of the residual path that does
 * not depend on any learned value.
 */
v4k::Model buildResidualModel(const Options& options) {
    const uint32_t rgb = 3;
    Lcg rng(options.seed);

    v4k::Model model;
    model.inputChannels = rgb;
    model.scaleFactor = options.scale;
    model.flags = v4k::kModelFlagGlobalResidual;
    model.weightFormat = options.fp16 ? v4k::ModelWeightFormat::Fp16 : v4k::ModelWeightFormat::Fp32;
    model.qualityTier = qualityForTier(options.tier);
    model.version = 1;
    model.displayName = "Reference SR x" + std::to_string(options.scale) + " (bicubic + residual)";

    if (options.scale != 2) {
        // The single shuffle stage is a fixed 2x; a 4x residual model needs a
        // second stage and a matching reference, which is not wired up here.
        std::fprintf(stderr, "--arch residual currently supports --scale 2 only\n");
        std::exit(2);
    }
    v4k::ModelOp head = convOp(rgb, rgb * 4u, v4k::ModelActivation::None, options, rng);
    if (options.init == "untrained") {
        // Keep the residual small so the untrained output stays recognisable.
        for (float& value : head.weights) value *= 0.05f;
    }
    model.ops.push_back(head);
    model.ops.push_back(shuffleOp(rgb * 4u));
    return model;
}

v4k::Model buildModel(const Options& options) {
    v4k::Model model = options.arch == "residual" ? buildResidualModel(options)
                                                  : buildSubpixelModel(options);
    // Every op consumes the previous one's output; -1 means "the network input".
    for (size_t i = 0; i < model.ops.size(); ++i) {
        model.ops[i].inputIndex = i == 0 ? -1 : static_cast<int32_t>(i - 1);
    }
    model.opCount = static_cast<uint32_t>(model.ops.size());
    return model;
}

std::vector<uint8_t> readFile(const std::string& path, std::string* error) {
    std::ifstream stream(path, std::ios::binary);
    if (!stream) {
        *error = "cannot open " + path;
        return {};
    }
    return std::vector<uint8_t>((std::istreambuf_iterator<char>(stream)), std::istreambuf_iterator<char>());
}

/** A deterministic test pattern: smooth gradients plus a hard edge and a circle. */
v4k::Image testPattern(int width, int height) {
    v4k::Image image(width, height, 3);
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            const float u = static_cast<float>(x) / static_cast<float>(width - 1);
            const float v = static_cast<float>(y) / static_cast<float>(height - 1);
            const float edge = x > width / 2 ? 0.15f : 0.0f;
            const float dx = u - 0.35f;
            const float dy = v - 0.6f;
            const float circle = (dx * dx + dy * dy) < 0.02f ? 0.3f : 0.0f;
            float* pixel = image.pixel(x, y);
            pixel[0] = std::fmin(1.0f, 0.2f + 0.6f * u + edge + circle);
            pixel[1] = std::fmin(1.0f, 0.1f + 0.7f * v + circle);
            pixel[2] = std::fmin(1.0f, 0.25f + 0.5f * (1.0f - u) + edge);
        }
    }
    return image;
}

double worstDifference(const v4k::Image& a, const v4k::Image& b) {
    if (a.width != b.width || a.height != b.height || a.channels != b.channels) return 1.0;
    double worst = 0.0;
    for (size_t i = 0; i < a.data.size(); ++i) {
        worst = std::fmax(worst, std::fabs(static_cast<double>(a.data[i]) - static_cast<double>(b.data[i])));
    }
    return worst;
}

int verify(const std::string& path, const Options& options) {
    std::string error;
    const std::vector<uint8_t> bytes = readFile(path, &error);
    if (bytes.empty()) {
        std::fprintf(stderr, "verify: %s\n", error.c_str());
        return 1;
    }

    v4k::Model loaded;
    if (!v4k::loadModel(bytes, loaded, &error)) {
        std::fprintf(stderr, "verify: loadModel rejected the file we just wrote: %s\n", error.c_str());
        return 1;
    }

    v4k::CpuInference inference;
    if (!inference.prepare(loaded, &error)) {
        std::fprintf(stderr, "verify: graph rejected: %s\n", error.c_str());
        return 1;
    }
    inference.setThreadCount(1);   // deterministic numbers in the report

    const int width = 64;
    const int height = 36;
    const v4k::Image input = testPattern(width, height);

    const uint32_t outWidth = inference.outputWidth(static_cast<uint32_t>(width));
    const uint32_t outHeight = inference.outputHeight(static_cast<uint32_t>(height));
    const int outChannels = 3;

    // The interpreter reads planar CHW; Image is interleaved HWC. This
    // conversion is not optional -- see the note in core/v4k_image.h.
    const std::vector<float> planarInput = v4k::imageToPlanar(input);
    std::vector<float> planarOutput(static_cast<size_t>(outWidth) * outHeight * outChannels, 0.0f);

    const auto start = std::chrono::steady_clock::now();
    const bool ok = inference.run(planarInput.data(), static_cast<uint32_t>(width),
                                  static_cast<uint32_t>(height), planarOutput.data());
    const auto stop = std::chrono::steady_clock::now();
    if (!ok) {
        std::fprintf(stderr, "verify: the interpreter refused to run the graph\n");
        return 1;
    }
    const double elapsedMs = std::chrono::duration<double, std::milli>(stop - start).count();

    const v4k::Image produced =
        v4k::imageFromPlanar(planarOutput.data(), static_cast<int>(outWidth), static_cast<int>(outHeight), outChannels);
    const std::string targetName = options.arch == "residual" ? "bicubic" : "bilinear";
    const v4k::Image reference =
        options.arch == "residual"
            ? v4k::resizeBicubic(input, static_cast<int>(outWidth), static_cast<int>(outHeight))
            : v4k::resizeBilinear(input, static_cast<int>(outWidth), static_cast<int>(outHeight));

    const double psnrDb = v4k::psnr(reference, produced);
    const double worst = worstDifference(reference, produced);

    double sum = 0.0;
    double minimum = 1.0;
    double maximum = 0.0;
    for (float value : produced.data) {
        sum += value;
        minimum = std::fmin(minimum, value);
        maximum = std::fmax(maximum, value);
    }
    const double mean = produced.data.empty() ? 0.0 : sum / static_cast<double>(produced.data.size());

    std::printf("\n-- calibration check (CPU reference interpreter, single thread) --\n");
    std::printf("  file                 %s\n", path.c_str());
    std::printf("  bytes                %zu\n", bytes.size());
    std::printf("  ops                  %u\n", loaded.opCount);
    std::printf("  scale                x%u\n", loaded.scaleFactor);
    std::printf("  weight format        %s\n",
                loaded.weightFormat == v4k::ModelWeightFormat::Fp16 ? "fp16" : "fp32");
    std::printf("  input                %dx%d -> %ux%u, %d channels\n", width, height, outWidth, outHeight,
                outChannels);
    std::printf("  output range         [%.4f .. %.4f] mean %.4f\n", minimum, maximum, mean);
    std::printf("  inference            %.2f ms for one frame (%s, not a device figure)\n", elapsedMs,
                inference.stats().backendNote.c_str());
    std::printf("  analytic reference   %s of the same input\n", targetName.c_str());
    std::printf("  PSNR vs reference    %.2f dB\n", psnrDb);
    std::printf("  max abs difference   %.8f\n", worst);

    // GPU planner pre-flight at the resolutions the app actually runs.
    bool planOk = true;
    for (const std::string& spec : options.planChecks) {
        const size_t x = spec.find('x');
        if (x == std::string::npos) {
            std::fprintf(stderr, "verify: --plan-check needs WxH, got '%s'\n", spec.c_str());
            return 2;
        }
        const uint32_t checkWidth = static_cast<uint32_t>(std::stoul(spec.substr(0, x)));
        const uint32_t checkHeight = static_cast<uint32_t>(std::stoul(spec.substr(x + 1)));
        v4k::GpuPlan plan;
        std::string planError;
        const uint64_t budget = v4k::defaultWorkingSetBudget(0, options.deviceMemoryMiB * 1024ull * 1024ull);
        const bool feasible =
            v4k::buildGpuPlan(loaded, checkWidth, checkHeight, budget, plan, &planError);
        if (!feasible) {
            std::printf("  plan %-10s  NOT SCHEDULABLE: %s\n", spec.c_str(), planError.c_str());
            planOk = false;
            continue;
        }
        std::printf("  plan %-10s  %u layers, %u slots, %.1f MiB of %llu MiB budget%s\n", spec.c_str(),
                    plan.stats.layerCount, plan.stats.slotCount,
                    static_cast<double>(plan.stats.featureBytes + plan.stats.weightBytes) / (1024.0 * 1024.0),
                    static_cast<unsigned long long>(budget / (1024ull * 1024ull)),
                    plan.warnings.empty() ? "" : " (with warnings)");
        for (const std::string& warning : plan.warnings) {
            std::printf("      warning: %s\n", warning.c_str());
        }
    }

    if (options.init == "untrained") {
        std::printf("\n  NOTE: untrained weights. The output is noise, the comparison above is\n"
                    "  meaningless, and nothing about it may be presented as a quality result.\n");
        return planOk ? 0 : 1;
    }
    if (worst <= kCalibrationTolerance) {
        std::printf("\n  PASS: the graph reproduces %s to float precision, so container, op table,\n"
                    "  weights, PixelShuffle ordering and the interpreter all agree.\n"
                    "  This says nothing about image quality: the model is linear on purpose.\n",
                    targetName.c_str());
        return planOk ? 0 : 1;
    }
    std::printf("\n  FAIL: worst difference %.6f exceeds the %.0e tolerance.\n"
                "  Check the interleaved/planar conversion at the boundary first, then the\n"
                "  sub-pixel phase table (a half-pixel shift lands around 13 dB).\n",
                worst, kCalibrationTolerance);
    return 1;
}

}  // namespace

int main(int argc, char** argv) {
    Options options;
    std::vector<std::string> suppliedPlanChecks;
    bool planChecksSupplied = false;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        auto next = [&]() -> std::string {
            if (i + 1 >= argc) {
                std::fprintf(stderr, "%s needs a value\n", arg.c_str());
                std::exit(2);
            }
            return argv[++i];
        };
        if (arg == "--out") options.output = next();
        else if (arg == "--arch") options.arch = next();
        else if (arg == "--tier") options.tier = next();
        else if (arg == "--scale") options.scale = static_cast<uint32_t>(std::stoul(next()));
        else if (arg == "--init") options.init = next();
        else if (arg == "--seed") options.seed = static_cast<uint32_t>(std::stoul(next()));
        else if (arg == "--fp16") options.fp16 = true;
        else if (arg == "--verify") options.verify = true;
        else if (arg == "--device-memory-mib") options.deviceMemoryMiB = std::stoull(next());
        else if (arg == "--plan-check") {
            if (!planChecksSupplied) {
                suppliedPlanChecks.clear();
                planChecksSupplied = true;
            }
            suppliedPlanChecks.push_back(next());
        }
        else if (arg == "--help" || arg == "-h") {
            std::printf("usage: %s [--out FILE] [--arch subpixel|residual] [--tier lite|balanced|quality]\n"
                        "          [--scale 2|4] [--init bilinear|untrained] [--seed N] [--fp16] [--verify]\n",
                        argv[0]);
            return 0;
        } else {
            std::fprintf(stderr, "unknown argument '%s' (try --help)\n", arg.c_str());
            return 2;
        }
    }
    if (options.arch != "subpixel" && options.arch != "residual") {
        std::fprintf(stderr, "--arch must be subpixel or residual\n");
        return 2;
    }
    if (options.init != "bilinear" && options.init != "untrained") {
        std::fprintf(stderr, "--init must be bilinear or untrained\n");
        return 2;
    }

    if (planChecksSupplied) options.planChecks = suppliedPlanChecks;

    const v4k::Model model = buildModel(options);
    std::string error;
    const std::vector<uint8_t> bytes = v4k::writeModel(model, &error);
    if (bytes.empty()) {
        std::fprintf(stderr, "writeModel failed: %s\n", error.c_str());
        return 1;
    }
    std::ofstream out(options.output, std::ios::binary | std::ios::trunc);
    if (!out) {
        std::fprintf(stderr, "cannot write %s\n", options.output.c_str());
        return 1;
    }
    out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    out.close();

    std::printf("wrote %s\n", options.output.c_str());
    std::printf("  arch %s, tier %s, scale x%u, %u ops, %s weights, %zu bytes\n", options.arch.c_str(),
                options.tier.c_str(), options.scale, model.opCount, options.fp16 ? "fp16" : "fp32",
                bytes.size());
    std::printf("  init %s, seed %u\n", options.init.c_str(), options.seed);

    return options.verify ? verify(options.output, options) : 0;
}
