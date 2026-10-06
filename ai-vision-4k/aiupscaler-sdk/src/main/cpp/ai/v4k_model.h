// The .v4kmodel container and its graph description.
//
// Design constraints:
//   * one flat, memory-mappable file (no protobuf, no Python runtime at load);
//   * fixed-size op records so the GPU backend can upload the op table verbatim
//     to a storage buffer and execute it with a generic dispatch loop;
//   * FP32, FP16 and INT8 (per-tensor and per-output-channel affine) weights;
//   * SHA-256 over the body so a model from the network can be verified.
//
// Tools/model/export_v4kmodel.py converts an ESPCN/FSRCNN-style PyTorch model
// into this format; tools/model/dump_v4kmodel.py prints it back.
#pragma once

#include "../core/v4k_common.h"

#include <cstdint>
#include <string>
#include <vector>

namespace v4k {

constexpr uint32_t kModelMagic = 0x4D4B3456u;  // "V4KM" little endian, see magic string
extern const char kModelMagicString[9];        // "V4KMODEL"

enum class ModelWeightFormat : int32_t {
    Fp32 = 0,
    Fp16 = 1,
    Int8PerTensor = 2,
    Int8PerChannel = 3,
};

enum class ModelOpType : uint32_t {
    Conv2d = 0,        // full convolution, kernel 1 or 3, stride 1
    DepthwiseConv2d = 1,
    PixelShuffle = 2,  // sub-pixel convolution rearrange (scale 2)
    Add = 3,           // residual add (input0 + input1)
    PReLU = 4,         // parametric relu (slope per channel)
    ConcatInput = 5,   // concat the network input channels (used by temporal models)
};

enum class ModelActivation : uint32_t {
    None = 0,
    Relu = 1,
    PReLU = 2,
    LeakyRelu = 3,
};

// Header flags.
constexpr uint32_t kModelFlagTemporal = 1u << 0;    // consumes a motion/history input
constexpr uint32_t kModelFlagMotionVectors = 1u << 1;  // requires MV input (not block matching)
constexpr uint32_t kModelFlagGlobalResidual = 1u << 2; // output = upsample(input) + net(input)
constexpr uint32_t kModelFlagExperimental = 1u << 3;

#pragma pack(push, 1)
struct ModelHeader {
    char magic[8];            // "V4KMODEL\0"
    uint32_t version;         // kModelFormatVersion
    uint32_t headerBytes;     // sizeof(ModelHeader)
    uint32_t opCount;
    uint32_t weightsBytes;    // byte length of the weight blob
    uint32_t inputChannels;   // 3 for RGB, 1 for luma
    uint32_t scaleFactor;     // 2 or 4
    uint32_t flags;
    uint32_t weightFormat;    // ModelWeightFormat
    uint32_t qualityTier;     // AiQuality the model targets (LOW..ULTRA)
    uint32_t opTableOffset;
    uint32_t weightsOffset;
    uint32_t reserved0[9];  // pads the header to 120 bytes
    uint8_t bodyDigest[32];   // SHA-256 over the body (op table + weights)
};
static_assert(sizeof(ModelHeader) == 120, "ModelHeader must stay 120 bytes");

struct ModelOpRecord {
    uint32_t type;             // ModelOpType
    uint32_t inputIndex;       // 0xFFFFFFFF == network input, otherwise op index
    uint32_t input2Index;      // second operand (Add), 0xFFFFFFFF when unused
    uint32_t inputChannels;
    uint32_t outputChannels;
    uint32_t kernelSize;       // 1 or 3
    uint32_t stride;           // 1 or 2 (for the low-res feature extractor)
    uint32_t padding;          // explicit symmetric padding
    uint32_t weightsOffset;    // relative to weights blob
    uint32_t weightsCount;     // element count (dequantised element count for INT8)
    uint32_t biasOffset;       // relative to weights blob, float32/int32
    uint32_t biasCount;
    uint32_t activation;       // ModelActivation
    uint32_t quantOffset;      // float32 scale/zero-point table (INT8 only)
    uint32_t flags;            // op specific flags
    uint32_t reserved[1];      // pads the record to 64 bytes
};
static_assert(sizeof(ModelOpRecord) == 64, "ModelOpRecord must stay 64 bytes");
#pragma pack(pop)

// Weight layouts (row-major, matching the exporter and the GPU kernels):
//   Conv2d          : [outputChannels][inputChannels][kernelSize][kernelSize]
//   DepthwiseConv2d : [outputChannels][kernelSize][kernelSize]
//   PReLU           : [channels]   (slopes)
//   INT8 tables     : [scales...][zeroPoints...] in float32
struct ModelOp {
    ModelOpType type = ModelOpType::Conv2d;
    int32_t inputIndex = -1;     // -1 == network input
    int32_t input2Index = -1;
    uint32_t inputChannels = 0;
    uint32_t outputChannels = 0;
    uint32_t kernelSize = 3;
    uint32_t stride = 1;
    uint32_t padding = 1;
    ModelActivation activation = ModelActivation::None;
    uint32_t flags = 0;

    // Weights, already converted to float32 planner-friendly form. For INT8
    // models these are dequantised lazily by the backend (see quantScales).
    std::vector<float> weights;
    std::vector<float> bias;
    std::vector<float> quantScales;   // per-tensor [inScale, outScale] or per-channel
    std::vector<float> quantZeroPoints;
};

struct Model {
    // Metadata
    std::string id;               // filled in by the catalog, not the file
    std::string displayName;
    uint32_t version = 0;
    uint32_t inputChannels = 3;
    uint32_t scaleFactor = 2;
    uint32_t flags = 0;
    ModelWeightFormat weightFormat = ModelWeightFormat::Fp32;
    uint32_t qualityTier = 0;
    uint32_t opCount = 0;
    uint64_t fileBytes = 0;
    std::string fileSha256;

    std::vector<ModelOp> ops;

    bool temporal() const { return (flags & kModelFlagTemporal) != 0; }
    bool needsMotionVectors() const { return (flags & kModelFlagMotionVectors) != 0; }
    bool globalResidual() const { return (flags & kModelFlagGlobalResidual) != 0; }
    bool experimental() const { return (flags & kModelFlagExperimental) != 0; }

    // Number of multiply-accumulate operations for a given input size.
    uint64_t estimateMacs(uint32_t inputWidth, uint32_t inputHeight) const;

    bool valid() const { return !ops.empty(); }
};

// Reads the header only (cheap verification path).
bool readModelHeader(const std::vector<uint8_t>& bytes, ModelHeader& header, std::string* error);

// Full parse: validates the container, checks the digest and converts weights.
bool loadModel(const std::vector<uint8_t>& bytes, Model& out, std::string* error);

// Writes a container. Used by tools/model/export_v4kmodel.py --verify and by the
// unit tests (round trip).
std::vector<uint8_t> writeModel(const Model& model, std::string* error);

// ---- fp16 helpers (IEEE 754 binary16) -------------------------------------
uint16_t floatToHalf(float value);
float halfToFloat(uint16_t value);

}  // namespace v4k
