// C++ mirrors of every GLSL push-constant block in the engine.
//
// Layout rules that matter here:
//   * push constants use std430 packing, so a `vec3` occupies 12 bytes with
//     16-byte alignment -- the float *after* a vec3 lands at offset 12, while
//     the *next* vec3 starts at a 16-byte boundary. That is why the vec3 fields
//     below are written as `alignas(16) float name[3]` instead of a Vec3 struct
//     (a 16-byte Vec3 would shift every following float).
//   * every struct carries a static_assert on its size, and
//     `tools/checks/dump-spirv-interface.py --verify` re-derives the member
//     list straight out of the checked-in .spv files, so a drift between this
//     header and the shaders fails `tools/verify.sh` instead of corrupting
//     frames on a device.
#pragma once

#include <cstdint>

namespace v4k {
namespace vk {

// ---------------------------------------------------------------------------
// preprocess_luma.comp
// ---------------------------------------------------------------------------
// @spirv preprocess_luma.comp
struct PreprocessPush {
    float inputSize[2];
    float invInputSize[2];
    float denoiseStrength;   // 0 disables the bilateral filter
    float lumaSharpen;       // pre-sharpening of the luma plane (0..1)
    uint32_t flags;          // bit0: input texture already holds luma
    uint32_t frameIndex;
};
static_assert(sizeof(PreprocessPush) == 32, "preprocess_luma.comp push constant block");

// ---------------------------------------------------------------------------
// motion_estimate.comp
// ---------------------------------------------------------------------------
// @spirv motion_estimate.comp
struct MotionEstimatePush {
    float lumaSize[2];       // half res dimensions
    int32_t searchRadius;    // 4 typical
    float maxVectorLength;   // clamp for the temporal reprojection
    float sadThreshold;      // above this SAD the vector is marked unreliable
    uint32_t hasPrevious;    // 0 on the first frame
    uint32_t pad0;
    uint32_t pad1;
};
static_assert(sizeof(MotionEstimatePush) == 32, "motion_estimate.comp push constant block");

// ---------------------------------------------------------------------------
// sr_conv.comp -- one dispatch per model convolution
// ---------------------------------------------------------------------------
// @spirv sr_conv.comp
struct SrConvPush {
    uint32_t inW;
    uint32_t inH;
    uint32_t outW;
    uint32_t outH;
    uint32_t inC;
    uint32_t outC;
    uint32_t kernel;     // 1 or 3
    uint32_t pad;        // symmetric padding
    uint32_t stride;     // 1 or 2
    uint32_t activation; // 0 none, 1 relu, 2 prelu, 3 leaky
    uint32_t depthwise;  // 1 == per-channel (inC == outC, no cross channel sum)
    uint32_t reserved;
};
static_assert(sizeof(SrConvPush) == 48, "sr_conv.comp push constant block");

// ---------------------------------------------------------------------------
// pixel_shuffle.comp -- model sub-pixel upsampling stage
// ---------------------------------------------------------------------------
// @spirv pixel_shuffle.comp
struct PixelShufflePush {
    uint32_t inW;
    uint32_t inH;
    uint32_t channels;    // inC / (r * r)
    uint32_t scale;       // r, 2 or 4
    uint32_t addResidual; // 1 == output = shuffled + residual
    uint32_t reserved0;
    uint32_t reserved1;
    uint32_t reserved2;
};
static_assert(sizeof(PixelShufflePush) == 32, "pixel_shuffle.comp push constant block");

// ---------------------------------------------------------------------------
// edge_reconstruct.comp -- analytical fallback path
// ---------------------------------------------------------------------------
// @spirv edge_reconstruct.comp
struct EdgeReconstructPush {
    float inputSize[2];
    float outputSize[2];
    float edgeStrength;   // 0 == pure bicubic, 0.35 typical
    float sharpening;     // applied after reconstruction
    float detailRecovery; // high frequency re-injection from the luma plane
    uint32_t flags;       // bit0: also write the residual used by neural models
};
static_assert(sizeof(EdgeReconstructPush) == 32, "edge_reconstruct.comp push constant block");

// ---------------------------------------------------------------------------
// temporal_accum.comp
// ---------------------------------------------------------------------------
// @spirv temporal_accum.comp
struct TemporalAccumPush {
    float outputSize[2];
    float invOutputSize[2];
    float motionScale[2];  // motion vector texel -> output pixel scale
    float historyWeight;   // base feedback (0.9 typical)
    float clampSigma;      // neighbourhood clamp width in standard deviations
    uint32_t frameIndex;
    uint32_t resetHistory; // 1 == ignore the history entirely this frame
    uint32_t reserved;
};
static_assert(sizeof(TemporalAccumPush) == 44, "temporal_accum.comp push constant block");

// ---------------------------------------------------------------------------
// aa_resolve.comp
// ---------------------------------------------------------------------------
// @spirv aa_resolve.comp
struct AaResolvePush {
    float size[2];
    float invSize[2];
    float edgeThreshold;   // luma difference that counts as an edge
    float strength;        // 0..1
    uint32_t enable;       // 0 disables the pass
    uint32_t reserved;
};
static_assert(sizeof(AaResolvePush) == 32, "aa_resolve.comp push constant block");

// ---------------------------------------------------------------------------
// sharpen.comp
// ---------------------------------------------------------------------------
// @spirv sharpen.comp
struct SharpenPush {
    float size[2];
    float invSize[2];
    float amount;       // 0..1
    float noiseFloor;   // high frequency amplitude treated as noise (0..1)
    uint32_t enable;
    uint32_t reserved;
};
static_assert(sizeof(SharpenPush) == 32, "sharpen.comp push constant block");

// ---------------------------------------------------------------------------
// denoise.comp
// ---------------------------------------------------------------------------
// @spirv denoise.comp
struct DenoisePush {
    float size[2];
    float invSize[2];
    float strength;    // 0..1
    float lumaSigma;   // edge preserving threshold
    uint32_t passIndex;
    uint32_t reserved;
};
static_assert(sizeof(DenoisePush) == 32, "denoise.comp push constant block");

// ---------------------------------------------------------------------------
// quality_metrics.comp -- SSIM partials for the benchmark
// ---------------------------------------------------------------------------
// @spirv quality_metrics.comp
struct QualityMetricsPush {
    float size[2];
    float invSize[2];
    float peak;        // 1.0 for normalised colour
    uint32_t includeAlpha;
    uint32_t reserved0;
    uint32_t reserved1;
};
static_assert(sizeof(QualityMetricsPush) == 32, "quality_metrics.comp push constant block");

// ---------------------------------------------------------------------------
// elementwise.comp -- Add / Sub / Mul between two feature maps
// ---------------------------------------------------------------------------
// @spirv elementwise.comp
struct ElementwisePush {
    uint32_t width;
    uint32_t height;
    uint32_t channels;
    uint32_t bChannels;   // 1 == single channel operand, otherwise == channels
    uint32_t mode;        // 0 add, 1 subtract, 2 multiply, 3 addScaled, 4 concat
    float scalar;
    uint32_t aChannels;   // mode 4: channels taken from A, the rest from B
    uint32_t reserved1;
};
static_assert(sizeof(ElementwisePush) == 32, "elementwise.comp push constant block");

// ---------------------------------------------------------------------------
// prelu.comp -- stand-alone parametric ReLU
// ---------------------------------------------------------------------------
// @spirv prelu.comp
struct PreluPush {
    uint32_t width;
    uint32_t height;
    uint32_t channels;
    uint32_t slopeCount;   // 1 == broadcast slope
    uint32_t reserved0;
    uint32_t reserved1;
    uint32_t reserved2;
    uint32_t reserved3;
};
static_assert(sizeof(PreluPush) == 32, "prelu.comp push constant block");

// ---------------------------------------------------------------------------
// particle_sim.comp -- demo only
// ---------------------------------------------------------------------------
// @spirv particle_sim.comp
struct ParticleSimPush {
    float deltaTime;
    float time;
    uint32_t particleCount;
    uint32_t emitterSeed;
    float emitterPosition[3];
    float gravity;
};
static_assert(sizeof(ParticleSimPush) == 32, "particle_sim.comp push constant block");

// ---------------------------------------------------------------------------
// downsample.comp -- 2x2 box downsample of the luma plane
// ---------------------------------------------------------------------------
// @spirv downsample.comp
struct DownsamplePush {
    uint32_t outW;
    uint32_t outH;
    uint32_t inW;
    uint32_t inH;
    uint32_t flags;      // bit0 keep the maximum (edge preserve)
    uint32_t reserved0;
    uint32_t reserved1;
    uint32_t reserved2;
};
static_assert(sizeof(DownsamplePush) == 32, "downsample.comp push constant block");

// ---------------------------------------------------------------------------
// image_to_planar.comp -- image -> planar tensor (network input)
// ---------------------------------------------------------------------------
// @spirv image_to_planar.comp
struct ImageToPlanarPush {
    uint32_t width;      // tensor width
    uint32_t height;     // tensor height
    uint32_t channels;   // 1 or 3
    uint32_t flags;      // bit0 input is luma, bit1 linearise sRGB
    float inputSize[2];
    float scale;
};
static_assert(sizeof(ImageToPlanarPush) == 28, "image_to_planar.comp push constant block");

// ---------------------------------------------------------------------------
// planar_to_image.comp -- planar tensor -> rgba16f image
// ---------------------------------------------------------------------------
// @spirv planar_to_image.comp
struct PlanarToImagePush {
    uint32_t width;
    uint32_t height;
    uint32_t channels;   // 1 or 3
    uint32_t writeAlpha;
    float gain;
    uint32_t flags;      // bit0: clamp the result to [0,1]
    uint32_t reserved1;
    uint32_t reserved2;
};
static_assert(sizeof(PlanarToImagePush) == 32, "planar_to_image.comp push constant block");

// ---------------------------------------------------------------------------
// bicubic_residual.comp -- global residual skip connection
// ---------------------------------------------------------------------------
// @spirv bicubic_residual.comp
struct BicubicResidualPush {
    uint32_t outW;
    uint32_t outH;
    uint32_t channels;
    uint32_t flags;      // bit0 clamp to [0,1]
    float inputSize[2];
    float reserved[2];
};
static_assert(sizeof(BicubicResidualPush) == 32, "bicubic_residual.comp push constant block");

// ---------------------------------------------------------------------------
// sky.frag -- demo full screen background
// ---------------------------------------------------------------------------
// @spirv sky.frag
struct SkyPush {
    alignas(16) float sunDirection[3];
    float exposure;
    alignas(16) float horizonColor[3];
    float hazeStrength;
    alignas(16) float zenithColor[3];
    float time;
};
static_assert(sizeof(SkyPush) == 48, "sky.frag push constant block");

// ---------------------------------------------------------------------------
// present.frag -- comparison / split screen presentation
// ---------------------------------------------------------------------------
// @spirv present.frag
struct PresentPush {
    float outputSize[2];
    float invOutputSize[2];
    float splitPosition;   // 0 = all reference, 1 = all enhanced
    float magnifierScale;  // 1 disables the inset
    float magnifierCentre[2];
    uint32_t mode;
    float exposure;
    uint32_t showGrid;
    uint32_t reserved;
};
static_assert(sizeof(PresentPush) == 48, "present.frag push constant block");

}  // namespace vk
}  // namespace v4k
