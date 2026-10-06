// AI model catalog + on-device install state.
//
// Models are *not* bundled in the APK (they are tens to hundreds of kilobytes
// each and must be updatable independently). The catalog lists what exists, and
// the model manager downloads a model only when a profile actually needs it.
//
// The catalog is intentionally a plain JSON document that can be pointed at any
// repository, so the app is not tied to one CDN:
//     Settings -> AI Engine -> Model repository
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "v4k_common.h"
#include "v4k_model.h"

namespace v4k {

enum class ModelPrecision : int32_t {
    Fp32 = 0,
    Fp16 = 1,
    Int8 = 2,
};

inline const char* toString(ModelPrecision p) {
    switch (p) {
        case ModelPrecision::Fp32: return "FP32";
        case ModelPrecision::Fp16: return "FP16";
        case ModelPrecision::Int8: return "INT8";
    }
    return "FP32";
}

struct ModelEntry {
    std::string id;                 // "mobile_sr_lite"
    std::string displayName;        // "Mobile SR Lite"
    std::string description;
    AiQuality targetQuality = AiQuality::Low;
    ModelPrecision precision = ModelPrecision::Int8;
    uint32_t scaleFactor = 2;
    uint64_t sizeBytes = 0;
    std::string sha256;             // hex digest of the whole file
    std::string url;                // absolute, or relative to the repo base
    bool experimental = false;
    bool requiresTemporalInput = false;
    bool bundled = false;           // true if shipped inside the APK assets
    std::string recommendedTier;    // DeviceTier name, informational
};

struct ModelCatalog {
    int version = 1;
    std::string repositoryBaseUrl;
    std::vector<ModelEntry> models;

    const ModelEntry* find(const std::string& id) const;
    std::string toJson() const;
};

bool catalogFromJson(const std::string& json, ModelCatalog& out, std::string* error);

// Which model a configuration actually wants, given what is installed.
// Returns an empty string when nothing suitable is installed.
std::string selectModel(const ModelCatalog& catalog, const std::vector<std::string>& installedIds,
                        AiQuality quality, bool allowInt8, bool allowFp16, bool allowExperimental);

// Installation record kept in the app's private files directory.
struct InstalledModel {
    std::string id;
    std::string path;
    uint64_t sizeBytes = 0;
    bool filePresent = false;
    bool headerValid = false;
    bool digestMatchesCatalog = false;
    std::string fileSha256;
    std::string error;              // why it is not usable, when it is not
    ModelHeader header{};           // only valid when headerValid

    bool usable() const { return filePresent && headerValid; }
};

// Verifies a file against a catalog entry (or, when the entry has no digest,
// just parses the header). Never throws.
InstalledModel inspectModelFile(const std::string& path, const ModelEntry* entry);

// Absolute download URL for an entry (handles relative paths).
std::string resolveModelUrl(const ModelCatalog& catalog, const ModelEntry& entry);

}  // namespace v4k
