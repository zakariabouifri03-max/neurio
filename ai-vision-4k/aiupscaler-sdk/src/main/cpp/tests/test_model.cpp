#include <cmath>
#include <cstring>
#include <vector>

#include "ai/v4k_cpu_infer.h"
#include "core/v4k_sha256.h"
#include "ai/v4k_model.h"
#include "ai/v4k_model_catalog.h"
#include "v4k_test.h"

using namespace v4k;

namespace {

// A deliberately tiny but *real* graph:
//   conv 3x3 (identity centre tap, 1 -> 4 channels)
//   pixel shuffle 2x  (4 channels -> 1 channel, 2x2 spatial expansion)
// The result is an exact nearest-neighbour 2x upscale, which makes the
// interpreter's correctness verifiable by inspection.
Model makeNearestNeighbourModel(ModelWeightFormat format) {
    Model m;
    m.inputChannels = 1;
    m.scaleFactor = 2;
    m.weightFormat = format;
    m.qualityTier = static_cast<uint32_t>(AiQuality::Low);

    ModelOp conv;
    conv.type = ModelOpType::Conv2d;
    conv.inputIndex = -1;
    conv.inputChannels = 1;
    conv.outputChannels = 4;
    conv.kernelSize = 3;
    conv.stride = 1;
    conv.padding = 1;
    conv.activation = ModelActivation::None;
    conv.weights.assign(4 * 1 * 3 * 3, 0.0f);
    for (int c = 0; c < 4; ++c) conv.weights[static_cast<size_t>(c) * 9 + 4] = 1.0f;
    conv.bias.assign(4, 0.0f);
    m.ops.push_back(conv);

    ModelOp shuffle;
    shuffle.type = ModelOpType::PixelShuffle;
    shuffle.inputIndex = 0;
    shuffle.inputChannels = 4;
    shuffle.outputChannels = 1;
    m.ops.push_back(shuffle);
    return m;
}

Model makeConstantModel() {
    Model m;
    m.inputChannels = 1;
    m.scaleFactor = 2;
    m.weightFormat = ModelWeightFormat::Fp32;

    ModelOp conv;
    conv.type = ModelOpType::Conv2d;
    conv.inputIndex = -1;
    conv.inputChannels = 1;
    conv.outputChannels = 4;
    conv.kernelSize = 3;
    conv.stride = 1;
    conv.padding = 1;
    conv.activation = ModelActivation::Relu;
    conv.weights.assign(4 * 1 * 3 * 3, 0.0f);
    conv.bias.assign(4, 0.5f);
    m.ops.push_back(conv);

    ModelOp shuffle;
    shuffle.type = ModelOpType::PixelShuffle;
    shuffle.inputIndex = 0;
    m.ops.push_back(shuffle);
    return m;
}

std::vector<float> rampInput(int w, int h) {
    std::vector<float> data(static_cast<size_t>(w) * h);
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            data[static_cast<size_t>(y) * w + x] =
                (static_cast<float>(x) + static_cast<float>(y) * 0.5f) / (w * 2.0f);
        }
    }
    return data;
}

}  // namespace

V4K_TEST(model_container_roundtrip_fp32) {
    const Model original = makeNearestNeighbourModel(ModelWeightFormat::Fp32);
    std::string error;
    const std::vector<uint8_t> bytes = writeModel(original, &error);
    CHECK(!bytes.empty());
    if (bytes.empty()) {
        V4K_FAIL("writeModel failed: " + error);
        return;
    }
    CHECK(bytes.size() > sizeof(ModelHeader));

    Model loaded;
    CHECK(loadModel(bytes, loaded, &error));
    if (!loaded.valid()) {
        V4K_FAIL("loadModel failed: " + error);
        return;
    }
    CHECK_EQ_INT(loaded.ops.size(), 2u);
    CHECK_EQ_INT(loaded.inputChannels, 1u);
    CHECK_EQ_INT(loaded.scaleFactor, 2u);
    CHECK(loaded.ops[0].type == ModelOpType::Conv2d);
    CHECK(loaded.ops[1].type == ModelOpType::PixelShuffle);
    CHECK_EQ_INT(loaded.ops[0].weights.size(), 36u);
    CHECK_NEAR(loaded.ops[0].weights[4], 1.0, 1e-6);
    CHECK_NEAR(loaded.ops[0].bias[3], 0.0, 1e-6);
    CHECK_EQ_INT(loaded.fileBytes, bytes.size());
    CHECK_EQ_STR(loaded.fileSha256, sha256Hex(bytes.data(), bytes.size()));
}

V4K_TEST(model_container_roundtrip_fp16) {
    Model original = makeNearestNeighbourModel(ModelWeightFormat::Fp16);
    original.ops[0].weights[0] = 0.5f;
    original.ops[0].weights[1] = -0.25f;
    original.ops[0].weights[2] = 0.125f;
    std::string error;
    const std::vector<uint8_t> bytes = writeModel(original, &error);
    CHECK(!bytes.empty());

    Model loaded;
    CHECK(loadModel(bytes, loaded, &error));
    CHECK_EQ_INT(loaded.ops[0].weights.size(), 36u);
    // These values are exactly representable in binary16.
    CHECK_NEAR(loaded.ops[0].weights[0], 0.5, 1e-9);
    CHECK_NEAR(loaded.ops[0].weights[1], -0.25, 1e-9);
    CHECK_NEAR(loaded.ops[0].weights[2], 0.125, 1e-9);
    CHECK_NEAR(loaded.ops[0].weights[4], 1.0, 1e-9);
}

V4K_TEST(model_container_roundtrip_int8) {
    Model original = makeNearestNeighbourModel(ModelWeightFormat::Int8PerTensor);
    // Symmetric scale covering the weight range.
    original.ops[0].quantScales = {1.0f / 127.0f};
    original.ops[0].quantZeroPoints = {0.0f};
    original.ops[0].weights[3] = 0.5f;    // -> q = 63
    original.ops[0].weights[5] = -0.75f;  // -> q = -95
    std::string error;
    const std::vector<uint8_t> bytes = writeModel(original, &error);
    CHECK(!bytes.empty());

    Model loaded;
    CHECK(loadModel(bytes, loaded, &error));
    CHECK_EQ_INT(loaded.ops[0].weights.size(), 36u);
    // Quantisation error is bounded by half a step.
    const float step = 1.0f / 127.0f;
    CHECK_NEAR(loaded.ops[0].weights[3], 0.5, step);
    CHECK_NEAR(loaded.ops[0].weights[5], -0.75, step);
    CHECK_NEAR(loaded.ops[0].weights[4], 1.0, step);
}

V4K_TEST(model_container_detects_tampering) {
    const Model original = makeNearestNeighbourModel(ModelWeightFormat::Fp32);
    std::string error;
    std::vector<uint8_t> bytes = writeModel(original, &error);
    CHECK(!bytes.empty());

    // Flip a weight byte inside the body (past the header and op table).
    const size_t target = sizeof(ModelHeader) + 2 * sizeof(ModelOpRecord) + 8;
    CHECK_LT(target, bytes.size());
    bytes[target] = static_cast<uint8_t>(bytes[target] ^ 0x40);

    Model loaded;
    CHECK(!loadModel(bytes, loaded, &error));
    CHECK(error.find("digest mismatch") != std::string::npos);
}

V4K_TEST(model_container_rejects_bad_files) {
    ModelHeader header{};
    std::string error;

    std::vector<uint8_t> junk(256, 0xAB);
    CHECK(!readModelHeader(junk, header, &error));
    CHECK(error.find("magic") != std::string::npos);

    const Model original = makeNearestNeighbourModel(ModelWeightFormat::Fp32);
    std::vector<uint8_t> bytes = writeModel(original, &error);
    CHECK(!bytes.empty());

    // Wrong version.
    std::vector<uint8_t> wrongVersion = bytes;
    reinterpret_cast<ModelHeader*>(wrongVersion.data())->version = 99;
    Model loaded;
    CHECK(!loadModel(wrongVersion, loaded, &error));
    CHECK(error.find("version") != std::string::npos);

    // Truncated file.
    std::vector<uint8_t> truncated(bytes.begin(), bytes.begin() + bytes.size() / 2);
    CHECK(!loadModel(truncated, loaded, &error));

    // Too small to even hold a header.
    std::vector<uint8_t> tiny(bytes.begin(), bytes.begin() + 16);
    CHECK(!loadModel(tiny, loaded, &error));
}

V4K_TEST(model_macs_estimate_is_plausible) {
    const Model m = makeNearestNeighbourModel(ModelWeightFormat::Fp32);
    const uint64_t macs = m.estimateMacs(1280, 720);
    // 1280*720 outputs * 4 channels * 1 input * 9 taps
    CHECK_EQ_INT(macs, 1280ull * 720ull * 4ull * 9ull);
}

V4K_TEST(cpu_inference_matches_reference_upscale) {
    Model model = makeNearestNeighbourModel(ModelWeightFormat::Fp32);
    std::string error;
    CpuInference infer;
    CHECK(infer.prepare(model, &error));
    if (!infer.ready()) {
        V4K_FAIL("prepare failed: " + error);
        return;
    }
    infer.setThreadCount(1);   // deterministic

    const int w = 4;
    const int h = 3;
    const std::vector<float> input = rampInput(w, h);
    std::vector<float> output(static_cast<size_t>(w * 2) * (h * 2), 0.0f);
    CHECK(infer.run(input.data(), w, h, output.data()));
    CHECK_EQ_INT(infer.outputWidth(w), 8u);
    CHECK_EQ_INT(infer.outputHeight(h), 6u);

    for (int y = 0; y < h * 2; ++y) {
        for (int x = 0; x < w * 2; ++x) {
            const float expected = input[static_cast<size_t>(y / 2) * w + (x / 2)];
            const float actual = output[static_cast<size_t>(y) * (w * 2) + x];
            CHECK_NEAR(actual, expected, 1e-5);
        }
    }
    CHECK_EQ_INT(infer.stats().framesProcessed, 1u);
    CHECK_GT(infer.stats().lastTotalUs, 0.0);
    CHECK_GT(infer.stats().macsPerFrame, 0ull);
}

V4K_TEST(cpu_inference_applies_bias_and_activation) {
    Model model = makeConstantModel();
    std::string error;
    CpuInference infer;
    CHECK(infer.prepare(model, &error));
    infer.setThreadCount(1);

    std::vector<float> input(16, 0.0f);
    std::vector<float> output(64, -1.0f);
    CHECK(infer.run(input.data(), 4, 4, output.data()));
    for (float v : output) {
        CHECK_NEAR(v, 0.5, 1e-5);
    }
}

V4K_TEST(cpu_inference_rejects_broken_graphs) {
    Model bad = makeNearestNeighbourModel(ModelWeightFormat::Fp32);
    bad.ops[0].weights.resize(10);   // wrong size for a 3x3 conv
    CpuInference infer;
    std::string error;
    CHECK(!infer.prepare(bad, &error));
    CHECK(error.find("weights") != std::string::npos);

    Model empty;
    CHECK(!infer.prepare(empty, &error));
}

V4K_TEST(catalog_parsing_and_selection) {
    const std::string json = R"({
      "version": 1,
      "repositoryBaseUrl": "https://models.example.invalid/aivision4k/",
      "models": [
        {"id":"mobile_sr_lite","name":"Mobile SR Lite","quality":"LOW","precision":"INT8",
         "scale":2,"sizeBytes":45000,"sha256":"aa","url":"lite.v4kmodel","recommendedTier":"ENTRY"},
        {"id":"mobile_sr_balanced","name":"Mobile SR Balanced","quality":"MEDIUM","precision":"INT8",
         "scale":2,"sizeBytes":120000,"sha256":"bb","url":"balanced.v4kmodel"},
        {"id":"mobile_sr_quality","name":"Mobile SR Quality","quality":"HIGH","precision":"FP16",
         "scale":2,"sizeBytes":380000,"sha256":"cc","url":"https://cdn.example.invalid/q.v4kmodel"},
        {"id":"mobile_sr_temporal","name":"Mobile SR Temporal","quality":"ULTRA","precision":"FP16",
         "scale":2,"sizeBytes":900000,"sha256":"dd","url":"temporal.v4kmodel",
         "experimental":true,"requiresTemporalInput":true}
      ]
    })";

    ModelCatalog catalog;
    std::string error;
    CHECK(catalogFromJson(json, catalog, &error));
    if (catalog.models.size() != 4) {
        V4K_FAIL("catalog parse failed: " + error);
        return;
    }
    CHECK_EQ_STR(catalog.repositoryBaseUrl, "https://models.example.invalid/aivision4k/");
    CHECK(catalog.find("mobile_sr_quality") != nullptr);
    CHECK(catalog.find("does_not_exist") == nullptr);
    CHECK(catalog.models[0].precision == ModelPrecision::Int8);
    CHECK(catalog.models[2].precision == ModelPrecision::Fp16);
    CHECK(catalog.models[3].experimental);

    // URL resolution: relative paths use the repository base.
    CHECK_EQ_STR(resolveModelUrl(catalog, catalog.models[0]),
                 "https://models.example.invalid/aivision4k/lite.v4kmodel");
    CHECK_EQ_STR(resolveModelUrl(catalog, catalog.models[2]),
                 "https://cdn.example.invalid/q.v4kmodel");

    // Only *installed* models are selected, cheapest precision first.
    CHECK_EQ_STR(selectModel(catalog, {"mobile_sr_balanced"}, AiQuality::Medium, true, true, false),
                 "mobile_sr_balanced");
    CHECK(selectModel(catalog, {"mobile_sr_balanced"}, AiQuality::High, true, true, false).empty() ||
          selectModel(catalog, {"mobile_sr_balanced"}, AiQuality::High, true, true, false) ==
              "mobile_sr_balanced");
    CHECK_EQ_STR(selectModel(catalog, {"mobile_sr_quality"}, AiQuality::High, true, true, false),
                 "mobile_sr_quality");
    // Experimental models need the opt-in.
    CHECK(selectModel(catalog, {"mobile_sr_temporal"}, AiQuality::Ultra, false, true, false).empty());
    CHECK_EQ_STR(selectModel(catalog, {"mobile_sr_temporal"}, AiQuality::Ultra, false, true, true),
                 "mobile_sr_temporal");

    const std::string serialised = catalog.toJson();
    ModelCatalog again;
    CHECK(catalogFromJson(serialised, again, &error));
    CHECK_EQ_INT(again.models.size(), 4u);
}

V4K_TEST(catalog_rejects_malformed_json) {
    ModelCatalog catalog;
    std::string error;
    CHECK(!catalogFromJson("{", catalog, &error));
    CHECK(!catalogFromJson("{\"models\": 5}", catalog, &error));
    // A missing models array is still an error, an empty one is fine.
    ModelCatalog empty;
    CHECK(catalogFromJson("{\"models\": []}", empty, &error));
    CHECK(empty.models.empty());
}

V4K_TEST(model_file_inspection_reports_missing_files) {
    InstalledModel state = inspectModelFile("/definitely/not/here.v4kmodel", nullptr);
    CHECK(!state.filePresent);
    CHECK(!state.usable());
    CHECK(!state.error.empty());
}
