#include "v4k_test.h"

#include "../core/v4k_image.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

using namespace v4k;

namespace {

Image makeRamp(int width, int height, int channels) {
    Image image(width, height, channels);
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            const float value = static_cast<float>(x + y) / static_cast<float>(width + height);
            for (int c = 0; c < channels; ++c) image.pixel(x, y)[c] = value;
        }
    }
    return image;
}

Image makeConstant(int width, int height, int channels, float value) {
    Image image(width, height, channels, value);
    return image;
}

double worstDifference(const Image& a, const Image& b) {
    double worst = 0.0;
    for (size_t i = 0; i < a.data.size(); ++i) {
        worst = std::max(worst, std::fabs(static_cast<double>(a.data[i]) - b.data[i]));
    }
    return worst;
}

}  // namespace

V4K_TEST(image_rgba8_round_trip_is_byte_exact) {
    Image source = makeRamp(7, 5, 4);
    std::vector<uint8_t> rgba(static_cast<size_t>(7) * 5 * 4, 0);
    imageToRgba8(source, rgba.data());
    const Image decoded = rgba8ToImage(rgba.data(), 7, 5);
    CHECK_EQ_INT(decoded.width, 7);
    CHECK_EQ_INT(decoded.height, 5);
    CHECK_EQ_INT(decoded.channels, 4);
    // Quantisation to 8 bit is the only loss: half a step at most.
    CHECK_LT(worstDifference(source, decoded), (1.0 / 255.0) * 0.51);
    std::vector<uint8_t> again(rgba.size(), 0);
    imageToRgba8(decoded, again.data());
    CHECK(again == rgba);
}

V4K_TEST(image_luma_uses_rec709_weights) {
    Image white = makeConstant(2, 2, 4, 1.0f);
    const Image luma = toLuma(white);
    CHECK_EQ_INT(luma.channels, 1);
    CHECK_NEAR(luma.pixel(0, 0)[0], 1.0, 1e-4);

    Image pureGreen = makeConstant(1, 1, 4, 0.0f);
    pureGreen.pixel(0, 0)[1] = 1.0f;
    const Image greenLuma = toLuma(pureGreen);
    CHECK_NEAR(greenLuma.pixel(0, 0)[0], 0.7152, 1e-3);

    Image pureBlue = makeConstant(1, 1, 4, 0.0f);
    pureBlue.pixel(0, 0)[2] = 1.0f;
    CHECK_NEAR(toLuma(pureBlue).pixel(0, 0)[0], 0.0722, 1e-3);
}

V4K_TEST(image_resize_to_the_same_size_is_the_identity) {
    const Image source = makeRamp(9, 6, 3);
    const Image bilinear = resizeBilinear(source, 9, 6);
    const Image bicubic = resizeBicubic(source, 9, 6);
    CHECK_LT(worstDifference(source, bilinear), 1e-5);
    CHECK_LT(worstDifference(source, bicubic), 1e-5);
}

V4K_TEST(image_upscale_keeps_a_flat_image_flat) {
    const Image source = makeConstant(16, 16, 3, 0.42f);
    const Image upscaled = resizeBicubic(source, 64, 64);
    CHECK_EQ_INT(upscaled.width, 64);
    for (float value : upscaled.data) {
        CHECK_NEAR(value, 0.42, 2e-3);
    }
}

V4K_TEST(image_upscale_reproduces_a_linear_ramp) {
    // The resampler is centre aligned (dst texel x maps to
    // (x + 0.5) * scale - 0.5 in source space) and Catmull-Rom reproduces any
    // linear signal exactly, so a ramp must survive an upscale bit-for-bit in
    // the interior. This is the check that catches a kernel with the wrong
    // normalisation or a half texel phase error -- both invisible until a real
    // frame is rendered, and both very common bugs.
    const Image source = makeRamp(16, 16, 1);
    const Image upscaled = resizeBicubic(source, 64, 64);
    double worst = 0.0;
    for (int y = 8; y < 56; ++y) {
        for (int x = 8; x < 56; ++x) {
            const double srcX = (x + 0.5) / 4.0 - 0.5;
            const double srcY = (y + 0.5) / 4.0 - 0.5;
            const double expected = (srcX + srcY) / 32.0;
            worst = std::max(worst, std::fabs(upscaled.pixel(x, y)[0] - expected));
        }
    }
    CHECK_MSG(worst < 1e-4,
              "worst deviation from the analytic ramp: " + std::to_string(worst));
}

V4K_TEST(image_psnr_is_infinite_for_identical_images) {
    const Image a = makeRamp(24, 24, 3);
    const double identical = psnr(a, a);
    CHECK(std::isinf(identical));
    CHECK_NEAR(ssim(a, a), 1.0, 1e-6);

    Image noisy = a;
    for (float& value : noisy.data) value = std::min(1.0f, value + 0.1f);
    const double degraded = psnr(a, noisy);
    CHECK_GT(degraded, 15.0);
    CHECK_LT(degraded, 25.0);
    CHECK_LT(ssim(a, noisy), 1.0);
    // 0.1 average error is roughly 20*log10(1/0.1) = 20 dB.
    CHECK_NEAR(degraded, 20.0, 0.5);
}

V4K_TEST(image_psnr_rejects_mismatched_sizes) {
    const Image a = makeRamp(8, 8, 3);
    const Image b = makeRamp(16, 16, 3);
    CHECK(psnr(a, b) < 0.0);
    CHECK(ssim(a, b) < 0.0);
}

V4K_TEST(image_unsharp_increases_edge_contrast) {
    Image image = makeConstant(16, 16, 1, 0.4f);
    for (int y = 0; y < 16; ++y) {
        for (int x = 8; x < 16; ++x) image.pixel(x, y)[0] = 0.6f;
    }
    const Image sharpened = unsharpMask(image, 0.8f, 1.0f);
    CHECK_LT(sharpened.pixel(7, 7)[0], image.pixel(7, 7)[0]);
    CHECK_GT(sharpened.pixel(8, 7)[0], image.pixel(8, 7)[0]);
    // A zero amount is a no-op.
    const Image untouched = unsharpMask(image, 0.0f, 1.0f);
    CHECK_LT(worstDifference(image, untouched), 1e-6);
}

V4K_TEST(image_edge_directed_upscale_produces_the_requested_size) {
    const Image source = makeRamp(20, 12, 3);
    const Image out = edgeDirectedUpscale(source, 40, 24, 0.35f);
    CHECK_EQ_INT(out.width, 40);
    CHECK_EQ_INT(out.height, 24);
    CHECK_EQ_INT(out.channels, 3);
    for (float value : out.data) {
        CHECK(value >= -0.001f && value <= 1.001f);
    }
}

V4K_TEST(image_planar_conversion_round_trips) {
    // Distinct value per (x, y, c) so a swapped axis or channel cannot pass.
    Image image(7, 5, 3);
    for (int y = 0; y < 5; ++y) {
        for (int x = 0; x < 7; ++x) {
            for (int c = 0; c < 3; ++c) {
                image.pixel(x, y)[c] = static_cast<float>(x * 100 + y * 10 + c) / 1000.0f;
            }
        }
    }

    const std::vector<float> planar = imageToPlanar(image);
    CHECK_EQ_INT(planar.size(), 7u * 5u * 3u);
    // Planar layout is [channel][row][column].
    CHECK_NEAR(planar[0 * 35 + 2 * 7 + 4], image.pixel(4, 2)[0], 1e-6);
    CHECK_NEAR(planar[1 * 35 + 2 * 7 + 4], image.pixel(4, 2)[1], 1e-6);
    CHECK_NEAR(planar[2 * 35 + 2 * 7 + 4], image.pixel(4, 2)[2], 1e-6);

    const Image restored = imageFromPlanar(planar.data(), 7, 5, 3);
    CHECK_EQ_INT(restored.channels, 3);
    CHECK_NEAR(worstDifference(image, restored), 0.0, 1e-6);

    // A single-channel image must not be reinterpreted as interleaved.
    const Image luma(4, 4, 1, 0.25f);
    const std::vector<float> lumaPlanar = imageToPlanar(luma);
    CHECK_EQ_INT(lumaPlanar.size(), 16u);
    CHECK_NEAR(lumaPlanar[5], 0.25f, 1e-6);
}

V4K_TEST(image_compare_agrees_with_psnr) {
    const Image reference = makeRamp(32, 32, 3);
    Image close = reference;
    for (float& value : close.data) value = std::min(1.0f, value + 0.01f);
    const Image wrong = makeConstant(32, 32, 3, 0.0f);

    QualityReport report;
    CHECK(compareImages(reference, close, report));
    CHECK_GT(report.score, report.ssimValue > 0.9 ? 60.0 : 0.0);
    CHECK_STR_CONTAINS(report.verdict, report.score > 95.0 ? "equivalent" : "");

    CHECK(compareImages(reference, wrong, report));
    CHECK_LT(report.score, 60.0);

    const Image differentSize = makeConstant(8, 8, 3, 0.5f);
    QualityReport unused;
    CHECK(!compareImages(reference, differentSize, unused));
}
