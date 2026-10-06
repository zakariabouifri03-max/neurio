#include "v4k_model.h"

#include <cmath>
#include <cstring>

#include "../core/v4k_log.h"
#include "../core/v4k_sha256.h"

namespace v4k {

const char kModelMagicString[9] = "V4KMODEL";

// ---------------------------------------------------------------------------
// fp16
// ---------------------------------------------------------------------------
uint16_t floatToHalf(float value) {
    uint32_t bits;
    std::memcpy(&bits, &value, sizeof(bits));
    const uint32_t sign = (bits >> 16) & 0x8000u;
    int32_t exponent = static_cast<int32_t>((bits >> 23) & 0xFFu) - 127 + 15;
    const uint32_t mantissa = bits & 0x7FFFFFu;

    if (((bits >> 23) & 0xFFu) == 0xFFu) {
        // Inf / NaN
        return static_cast<uint16_t>(sign | 0x7C00u | (mantissa != 0 ? 0x200u : 0u));
    }
    if (exponent <= 0) {
        if (exponent < -10) return static_cast<uint16_t>(sign);
        // Subnormal
        const uint32_t m = (mantissa | 0x800000u) >> static_cast<uint32_t>(1 - exponent);
        const uint32_t rounded = m + ((m & 0x1000u) ? 0x2000u : 0u);
        return static_cast<uint16_t>(sign | (rounded >> 13));
    }
    if (exponent >= 31) {
        return static_cast<uint16_t>(sign | 0x7C00u);  // overflow -> inf
    }
    uint32_t half = sign | (static_cast<uint32_t>(exponent) << 10) | (mantissa >> 13);
    // Round to nearest even.
    if ((mantissa & 0x1FFFu) > 0x1000u || ((mantissa & 0x1FFFu) == 0x1000u && (half & 1u) != 0u)) {
        ++half;
    }
    return static_cast<uint16_t>(half);
}

float halfToFloat(uint16_t value) {
    const uint32_t sign = (value & 0x8000u) != 0u ? 0x80000000u : 0u;
    const uint32_t exponent = (value >> 10) & 0x1Fu;
    const uint32_t mantissa = value & 0x3FFu;

    uint32_t bits;
    if (exponent == 0) {
        if (mantissa == 0) {
            bits = sign;   // +/- zero
        } else {
            // Subnormal half: value = mantissa * 2^-24. Exactly representable
            // as a float, so a plain scaling conversion is correct.
            const float magnitude = static_cast<float>(static_cast<double>(mantissa) * 5.9604644775390625e-08);
            uint32_t magnitudeBits;
            std::memcpy(&magnitudeBits, &magnitude, sizeof(magnitudeBits));
            bits = sign | (magnitudeBits & 0x7FFFFFFFu);
        }
    } else if (exponent == 0x1Fu) {
        bits = sign | 0x7F800000u | (mantissa << 13);   // inf / NaN
    } else {
        bits = sign | ((exponent - 15u + 127u) << 23) | (mantissa << 13);
    }

    float out;
    std::memcpy(&out, &bits, sizeof(out));
    return out;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
bool readModelHeader(const std::vector<uint8_t>& bytes, ModelHeader& header, std::string* error) {
    if (bytes.size() < sizeof(ModelHeader)) {
        if (error != nullptr) *error = "file is smaller than the model header";
        return false;
    }
    std::memcpy(&header, bytes.data(), sizeof(ModelHeader));
    if (std::memcmp(header.magic, kModelMagicString, 8) != 0) {
        if (error != nullptr) *error = "bad magic: not a V4KMODEL file";
        return false;
    }
    if (header.version != kModelFormatVersion) {
        if (error != nullptr) {
            *error = "unsupported model format version " + std::to_string(header.version) +
                     " (engine expects " + std::to_string(kModelFormatVersion) + ")";
        }
        return false;
    }
    if (header.headerBytes != sizeof(ModelHeader)) {
        if (error != nullptr) *error = "unexpected header size";
        return false;
    }
    if (header.scaleFactor != 2 && header.scaleFactor != 4) {
        if (error != nullptr) *error = "scale factor must be 2 or 4";
        return false;
    }
    if (header.inputChannels == 0 || header.inputChannels > 4) {
        if (error != nullptr) *error = "input channel count must be 1..4";
        return false;
    }
    const uint64_t opTableBytes = static_cast<uint64_t>(header.opCount) * sizeof(ModelOpRecord);
    const uint64_t end = static_cast<uint64_t>(header.weightsOffset) + header.weightsBytes;
    if (header.opTableOffset < sizeof(ModelHeader) ||
        static_cast<uint64_t>(header.opTableOffset) + opTableBytes > bytes.size() ||
        end > bytes.size()) {
        if (error != nullptr) *error = "op table or weight blob runs past the end of the file";
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
namespace {

float readFloat(const uint8_t* p) {
    float v;
    std::memcpy(&v, p, sizeof(v));
    return v;
}

}  // namespace


namespace {

// Which per-channel quantisation entry a weight index belongs to.
//   Conv2d          weights are [out][in][k][k]
//   DepthwiseConv2d weights are [out][k][k]
uint32_t channelIndexForWeight(uint32_t type, uint32_t outputChannels, uint32_t weightCount,
                               uint32_t weightIndex, uint32_t kernelSize) {
    if (outputChannels == 0) return 0;
    if (type == static_cast<uint32_t>(ModelOpType::DepthwiseConv2d)) {
        const uint32_t perChannel = kernelSize * kernelSize;
        return perChannel == 0 ? 0 : weightIndex / perChannel;
    }
    const uint32_t perChannel = weightCount / outputChannels;
    return perChannel == 0 ? 0 : weightIndex / perChannel;
}

}  // namespace

bool loadModel(const std::vector<uint8_t>& bytes, Model& out, std::string* error) {
    ModelHeader header{};
    if (!readModelHeader(bytes, header, error)) return false;

    // Digest check: the body digest covers op table + weights.
    const uint64_t bodyStart = header.opTableOffset;
    const uint64_t bodyEnd = static_cast<uint64_t>(header.weightsOffset) + header.weightsBytes;
    const std::string digest =
        sha256Hex(bytes.data() + bodyStart, static_cast<size_t>(bodyEnd - bodyStart));
    {
        static const char* hex = "0123456789abcdef";
        std::string expected;
        expected.reserve(64);
        for (uint8_t b : header.bodyDigest) {
            expected += hex[b >> 4];
            expected += hex[b & 0x0Fu];
        }
        bool allZero = true;
        for (uint8_t b : header.bodyDigest) {
            if (b != 0) allZero = false;
        }
        if (!allZero && digest != expected) {
            if (error != nullptr) {
                *error = "model body digest mismatch (file is corrupt or tampered): expected " +
                         expected + ", computed " + digest;
            }
            return false;
        }
    }

    Model model;
    model.version = header.version;
    model.inputChannels = header.inputChannels;
    model.scaleFactor = header.scaleFactor;
    model.flags = header.flags;
    model.weightFormat = static_cast<ModelWeightFormat>(header.weightFormat);
    model.qualityTier = header.qualityTier;
    model.opCount = header.opCount;
    model.fileBytes = bytes.size();
    model.fileSha256 = sha256Hex(bytes.data(), bytes.size());

    const uint8_t* weightsBase = bytes.data() + header.weightsOffset;

    for (uint32_t i = 0; i < header.opCount; ++i) {
        ModelOpRecord rec{};
        std::memcpy(&rec, bytes.data() + header.opTableOffset + i * sizeof(ModelOpRecord), sizeof(rec));

        ModelOp op;
        op.type = static_cast<ModelOpType>(rec.type);
        op.inputIndex = rec.inputIndex == 0xFFFFFFFFu ? -1 : static_cast<int32_t>(rec.inputIndex);
        op.input2Index = rec.input2Index == 0xFFFFFFFFu ? -1 : static_cast<int32_t>(rec.input2Index);
        op.inputChannels = rec.inputChannels;
        op.outputChannels = rec.outputChannels;
        op.kernelSize = rec.kernelSize;
        op.stride = rec.stride == 0 ? 1 : rec.stride;
        op.padding = rec.padding;
        op.activation = static_cast<ModelActivation>(rec.activation);
        op.flags = rec.flags;

        if (op.type == ModelOpType::Conv2d || op.type == ModelOpType::DepthwiseConv2d ||
            op.type == ModelOpType::PReLU) {
            const uint64_t wOffset = rec.weightsOffset;
            const uint64_t wEnd = wOffset + static_cast<uint64_t>(rec.weightsCount) *
                                               (model.weightFormat == ModelWeightFormat::Fp16 ? 2u
                                                                                              : (model.weightFormat == ModelWeightFormat::Fp32 ? 4u : 1u));
            if (wEnd > header.weightsBytes) {
                if (error != nullptr) *error = "op " + std::to_string(i) + ": weights run past the blob";
                return false;
            }
            const uint8_t* wp = weightsBase + wOffset;
            op.weights.resize(rec.weightsCount);
            switch (model.weightFormat) {
                case ModelWeightFormat::Fp32:
                    for (uint32_t k = 0; k < rec.weightsCount; ++k) {
                        op.weights[k] = readFloat(wp + k * 4);
                    }
                    break;
                case ModelWeightFormat::Fp16:
                    for (uint32_t k = 0; k < rec.weightsCount; ++k) {
                        uint16_t h;
                        std::memcpy(&h, wp + k * 2, sizeof(h));
                        op.weights[k] = halfToFloat(h);
                    }
                    break;
                case ModelWeightFormat::Int8PerTensor:
                case ModelWeightFormat::Int8PerChannel: {
                    // int8 weights are dequantised on load: w = (q - zeroPoint) * scale.
                    const uint32_t channels = op.type == ModelOpType::DepthwiseConv2d
                                                  ? op.outputChannels
                                                  : op.outputChannels;
                    std::vector<float> scales(channels, 1.0f);
                    std::vector<float> zeroPoints(channels, 0.0f);
                    if (rec.quantOffset < header.weightsBytes) {
                        const uint8_t* qp = weightsBase + rec.quantOffset;
                        const uint32_t count = model.weightFormat == ModelWeightFormat::Int8PerChannel
                                                   ? channels
                                                   : 2u;
                        for (uint32_t c = 0; c < count; ++c) {
                            scales[c] = readFloat(qp + c * 4);
                            zeroPoints[c] = readFloat(qp + (count + c) * 4);
                        }
                        if (model.weightFormat == ModelWeightFormat::Int8PerTensor) {
                            for (uint32_t c = 1; c < channels; ++c) {
                                scales[c] = scales[0];
                                zeroPoints[c] = zeroPoints[0];
                            }
                        }
                    }
                    op.quantScales = scales;
                    op.quantZeroPoints = zeroPoints;
                    for (uint32_t k = 0; k < rec.weightsCount; ++k) {
                        const int8_t q = static_cast<int8_t>(wp[k]);
                        const uint32_t channel =
                            model.weightFormat == ModelWeightFormat::Int8PerChannel
                                ? channelIndexForWeight(rec.type, rec.outputChannels,
                                                        rec.weightsCount, k, rec.kernelSize)
                                : 0u;
                        const uint32_t ci = std::min(channel, static_cast<uint32_t>(channels - 1));
                        op.weights[k] = (static_cast<float>(q) - zeroPoints[ci]) * scales[ci];
                    }
                    break;
                }
            }

            if (rec.biasCount > 0 && op.type != ModelOpType::PReLU) {
                const uint64_t bEnd = rec.biasOffset + static_cast<uint64_t>(rec.biasCount) * 4u;
                if (bEnd > header.weightsBytes) {
                    if (error != nullptr) *error = "op " + std::to_string(i) + ": bias runs past the blob";
                    return false;
                }
                op.bias.resize(rec.biasCount);
                for (uint32_t k = 0; k < rec.biasCount; ++k) {
                    op.bias[k] = readFloat(weightsBase + rec.biasOffset + k * 4);
                }
            }
        }

        model.ops.push_back(std::move(op));
    }

    if (model.ops.empty()) {
        if (error != nullptr) *error = "model has no ops";
        return false;
    }
    out = std::move(model);
    return true;
}

// ---------------------------------------------------------------------------
// Writing (used by tests and by the exporter's self-check)
// ---------------------------------------------------------------------------
std::vector<uint8_t> writeModel(const Model& model, std::string* error) {
    if (model.ops.empty()) {
        if (error != nullptr) *error = "cannot write a model without ops";
        return {};
    }

    // Layout: header | op table | weights blob
    // Weights are laid out sequentially; each op records its offset.
    std::vector<uint8_t> weights;
    std::vector<ModelOpRecord> records;
    records.reserve(model.ops.size());

    auto appendFloats = [&weights](const std::vector<float>& values) -> uint32_t {
        const uint32_t offset = static_cast<uint32_t>(weights.size());
        const size_t bytes = values.size() * sizeof(float);
        const size_t oldSize = weights.size();
        weights.resize(oldSize + bytes);
        std::memcpy(weights.data() + oldSize, values.data(), bytes);
        return offset;
    };

    for (const ModelOp& op : model.ops) {
        ModelOpRecord rec{};
        rec.type = static_cast<uint32_t>(op.type);
        rec.inputIndex = op.inputIndex < 0 ? 0xFFFFFFFFu : static_cast<uint32_t>(op.inputIndex);
        rec.input2Index = op.input2Index < 0 ? 0xFFFFFFFFu : static_cast<uint32_t>(op.input2Index);
        rec.inputChannels = op.inputChannels;
        rec.outputChannels = op.outputChannels;
        rec.kernelSize = op.kernelSize;
        rec.stride = op.stride;
        rec.padding = op.padding;
        rec.activation = static_cast<uint32_t>(op.activation);
        rec.flags = op.flags;
        rec.weightsCount = static_cast<uint32_t>(op.weights.size());
        rec.biasCount = static_cast<uint32_t>(op.bias.size());
        if (model.weightFormat == ModelWeightFormat::Fp16) {
            rec.weightsOffset = static_cast<uint32_t>(weights.size());
            for (float w : op.weights) {
                const uint16_t h = floatToHalf(w);
                weights.push_back(static_cast<uint8_t>(h & 0xFFu));
                weights.push_back(static_cast<uint8_t>(h >> 8));
            }
        } else if (model.weightFormat == ModelWeightFormat::Int8PerTensor ||
                   model.weightFormat == ModelWeightFormat::Int8PerChannel) {
            // Symmetric affine quantisation: q = clamp(round(w / scale + zeroPoint)).
            rec.weightsOffset = static_cast<uint32_t>(weights.size());
            const bool perChannel =
                model.weightFormat == ModelWeightFormat::Int8PerChannel && !op.quantScales.empty();
            for (uint32_t k = 0; k < op.weights.size(); ++k) {
                float scale = 1.0f;
                float zeroPoint = 0.0f;
                if (!op.quantScales.empty()) {
                    uint32_t ci = 0;
                    if (perChannel) {
                        ci = channelIndexForWeight(static_cast<uint32_t>(op.type), op.outputChannels,
                                                   static_cast<uint32_t>(op.weights.size()), k,
                                                   op.kernelSize);
                    }
                    ci = std::min<uint32_t>(ci, static_cast<uint32_t>(op.quantScales.size() - 1));
                    scale = op.quantScales[ci];
                    zeroPoint = ci < op.quantZeroPoints.size() ? op.quantZeroPoints[ci] : 0.0f;
                }
                if (scale == 0.0f) scale = 1.0f;
                const int q = static_cast<int>(std::lround(op.weights[k] / scale + zeroPoint));
                const int clamped = std::min(127, std::max(-128, q));
                weights.push_back(static_cast<uint8_t>(static_cast<int8_t>(clamped)));
            }
        } else {
            rec.weightsOffset = appendFloats(op.weights);
        }
        rec.biasOffset = op.bias.empty() ? 0u : appendFloats(op.bias);
        if (!op.quantScales.empty()) {
            rec.quantOffset = appendFloats(op.quantScales);
            appendFloats(op.quantZeroPoints);
        }
        records.push_back(rec);
    }

    ModelHeader header{};
    std::memcpy(header.magic, kModelMagicString, 8);
    header.version = kModelFormatVersion;
    header.headerBytes = sizeof(ModelHeader);
    header.opCount = static_cast<uint32_t>(records.size());
    header.weightsBytes = static_cast<uint32_t>(weights.size());
    header.inputChannels = model.inputChannels;
    header.scaleFactor = model.scaleFactor;
    header.flags = model.flags;
    header.weightFormat = static_cast<uint32_t>(model.weightFormat);
    header.qualityTier = model.qualityTier;
    header.opTableOffset = sizeof(ModelHeader);
    header.weightsOffset = static_cast<uint32_t>(sizeof(ModelHeader) +
                                                 records.size() * sizeof(ModelOpRecord));

    std::vector<uint8_t> body;
    body.resize(records.size() * sizeof(ModelOpRecord) + weights.size());
    std::memcpy(body.data(), records.data(), records.size() * sizeof(ModelOpRecord));
    if (!weights.empty()) {
        std::memcpy(body.data() + records.size() * sizeof(ModelOpRecord), weights.data(), weights.size());
    }
    const std::string digest = sha256Hex(body.data(), body.size());
    for (int i = 0; i < 32; ++i) {
        const std::string byte = digest.substr(static_cast<size_t>(i) * 2, 2);
        header.bodyDigest[i] = static_cast<uint8_t>(std::stoul(byte, nullptr, 16));
    }

    std::vector<uint8_t> out(sizeof(ModelHeader) + body.size());
    std::memcpy(out.data(), &header, sizeof(ModelHeader));
    std::memcpy(out.data() + sizeof(ModelHeader), body.data(), body.size());
    return out;
}

uint64_t Model::estimateMacs(uint32_t inputWidth, uint32_t inputHeight) const {
    uint64_t macs = 0;
    uint32_t w = inputWidth;
    uint32_t h = inputHeight;
    for (const ModelOp& op : ops) {
        switch (op.type) {
            case ModelOpType::Conv2d: {
                const uint64_t outW = (w + 2 * op.padding - op.kernelSize) / op.stride + 1;
                const uint64_t outH = (h + 2 * op.padding - op.kernelSize) / op.stride + 1;
                macs += outW * outH * op.outputChannels * op.inputChannels * op.kernelSize *
                        op.kernelSize;
                w = static_cast<uint32_t>(outW);
                h = static_cast<uint32_t>(outH);
                break;
            }
            case ModelOpType::DepthwiseConv2d: {
                const uint64_t outW = (w + 2 * op.padding - op.kernelSize) / op.stride + 1;
                const uint64_t outH = (h + 2 * op.padding - op.kernelSize) / op.stride + 1;
                macs += outW * outH * op.outputChannels * op.kernelSize * op.kernelSize;
                w = static_cast<uint32_t>(outW);
                h = static_cast<uint32_t>(outH);
                break;
            }
            case ModelOpType::PixelShuffle:
                w *= 2;
                h *= 2;
                break;
            default:
                break;
        }
    }
    return macs;
}

}  // namespace v4k
