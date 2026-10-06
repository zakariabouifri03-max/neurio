#include "v4k_model_catalog.h"

#include <algorithm>
#include <cstdio>

#include "../core/v4k_json.h"
#include "../core/v4k_log.h"
#include "../core/v4k_sha256.h"

namespace v4k {
namespace {

ModelPrecision precisionFromString(const std::string& s) {
    if (s == "FP16" || s == "fp16") return ModelPrecision::Fp16;
    if (s == "INT8" || s == "int8" || s == "QUANT8") return ModelPrecision::Int8;
    return ModelPrecision::Fp32;
}

const ModelEntry* bestFor(const ModelCatalog& catalog, AiQuality quality, ModelPrecision wanted,
                          bool allowExperimental) {
    const ModelEntry* best = nullptr;
    for (const ModelEntry& m : catalog.models) {
        if (m.experimental && !allowExperimental) continue;
        if (m.targetQuality != quality) continue;
        if (m.precision != wanted) continue;
        if (best == nullptr || m.sizeBytes < best->sizeBytes) best = &m;
    }
    return best;
}

}  // namespace

const ModelEntry* ModelCatalog::find(const std::string& id) const {
    for (const ModelEntry& m : models) {
        if (m.id == id) return &m;
    }
    return nullptr;
}

bool catalogFromJson(const std::string& json, ModelCatalog& out, std::string* error) {
    auto root = JsonValue::parse(json, error);
    if (root == nullptr) return false;
    if (!root->isObject()) {
        if (error != nullptr) *error = "catalog must be a JSON object";
        return false;
    }
    ModelCatalog catalog;
    catalog.version = static_cast<int>((*root)["version"].asInt(1));
    catalog.repositoryBaseUrl = (*root)["repositoryBaseUrl"].asString();

    const JsonValue& models = (*root)["models"];
    if (!models.isArray()) {
        if (error != nullptr) *error = "catalog.models must be an array";
        return false;
    }
    for (size_t i = 0; i < models.size(); ++i) {
        const JsonValue& m = models.at(i);
        if (!m.isObject()) continue;
        ModelEntry e;
        e.id = m["id"].asString();
        e.displayName = m["name"].asString(e.id);
        e.description = m["description"].asString();
        e.targetQuality = aiQualityFromString(m["quality"].asString("LOW"), AiQuality::Low);
        e.precision = precisionFromString(m["precision"].asString("INT8"));
        e.scaleFactor = static_cast<uint32_t>(m["scale"].asInt(2));
        e.sizeBytes = static_cast<uint64_t>(m["sizeBytes"].asInt(0));
        e.sha256 = m["sha256"].asString();
        e.url = m["url"].asString();
        e.experimental = m["experimental"].asBool(false);
        e.requiresTemporalInput = m["requiresTemporalInput"].asBool(false);
        e.bundled = m["bundled"].asBool(false);
        e.recommendedTier = m["recommendedTier"].asString();
        if (!e.id.empty()) catalog.models.push_back(std::move(e));
    }
    out = std::move(catalog);
    return true;
}

std::string ModelCatalog::toJson() const {
    JsonWriter w(2);
    w.beginObject();
    w.field("version", version);
    w.field("repositoryBaseUrl", repositoryBaseUrl);
    w.key("models");
    w.beginArray();
    for (const ModelEntry& m : models) {
        w.beginObject();
        w.field("id", m.id);
        w.field("name", m.displayName);
        w.field("description", m.description);
        w.field("quality", toString(m.targetQuality));
        w.field("precision", toString(m.precision));
        w.field("scale", m.scaleFactor);
        w.field("sizeBytes", m.sizeBytes);
        w.field("sha256", m.sha256);
        w.field("url", m.url);
        w.field("experimental", m.experimental);
        w.field("requiresTemporalInput", m.requiresTemporalInput);
        w.field("bundled", m.bundled);
        w.field("recommendedTier", m.recommendedTier);
        w.endObject();
    }
    w.endArray();
    w.endObject();
    return w.str();
}

std::string selectModel(const ModelCatalog& catalog, const std::vector<std::string>& installedIds,
                        AiQuality quality, bool allowInt8, bool allowFp16, bool allowExperimental) {
    auto installed = [&installedIds](const std::string& id) {
        return std::find(installedIds.begin(), installedIds.end(), id) != installedIds.end();
    };

    // Preference order: quality tier first, then the cheapest precision that the
    // device actually supports (INT8 > FP16 > FP32), then the smallest file.
    const ModelPrecision order[3] = {allowInt8 ? ModelPrecision::Int8 : ModelPrecision::Fp32,
                                     allowFp16 ? ModelPrecision::Fp16 : ModelPrecision::Fp32,
                                     ModelPrecision::Fp32};
    for (ModelPrecision precision : order) {
        const ModelEntry* m = bestFor(catalog, quality, precision, allowExperimental);
        if (m != nullptr && (installed(m->id) || m->bundled)) return m->id;
    }
    // Fall back to a lower quality tier before declaring failure: a lite model
    // that exists beats no model at all.
    const AiQuality fallbackOrder[4] = {AiQuality::Medium, AiQuality::Low, AiQuality::High,
                                        AiQuality::Ultra};
    for (AiQuality q : fallbackOrder) {
        if (q == quality) continue;
        for (ModelPrecision precision : order) {
            const ModelEntry* m = bestFor(catalog, q, precision, allowExperimental);
            if (m != nullptr && (installed(m->id) || m->bundled)) return m->id;
        }
    }
    return std::string();
}

std::string resolveModelUrl(const ModelCatalog& catalog, const ModelEntry& entry) {
    if (entry.url.empty()) return std::string();
    if (entry.url.rfind("http://", 0) == 0 || entry.url.rfind("https://", 0) == 0) return entry.url;
    if (catalog.repositoryBaseUrl.empty()) return entry.url;
    std::string base = catalog.repositoryBaseUrl;
    if (!base.empty() && base.back() != '/') base += '/';
    return base + entry.url;
}

InstalledModel inspectModelFile(const std::string& path, const ModelEntry* entry) {
    InstalledModel out;
    out.path = path;
    if (entry != nullptr) out.id = entry->id;

    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (f == nullptr) {
        out.error = "file not found";
        return out;
    }
    std::fseek(f, 0, SEEK_END);
    const long size = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    if (size <= 0) {
        std::fclose(f);
        out.error = "empty file";
        return out;
    }
    out.sizeBytes = static_cast<uint64_t>(size);
    out.filePresent = true;

    std::vector<uint8_t> headerBytes(std::min<long>(size, static_cast<long>(sizeof(ModelHeader))));
    const size_t read = std::fread(headerBytes.data(), 1, headerBytes.size(), f);
    std::fclose(f);
    if (read != headerBytes.size()) {
        out.error = "short read";
        return out;
    }

    ModelHeader header{};
    std::string error;
    if (!readModelHeader(headerBytes, header, &error)) {
        out.error = error;
        return out;
    }
    out.header = header;
    out.headerValid = true;

    if (entry != nullptr && !entry->sha256.empty()) {
        std::string digest;
        if (!sha256File(path, digest)) {
            out.error = "cannot hash file";
            return out;
        }
        out.fileSha256 = digest;
        out.digestMatchesCatalog = (digest == entry->sha256);
        if (!out.digestMatchesCatalog) {
            out.headerValid = false;
            out.error = "SHA-256 mismatch: file is not the model described by the catalog";
        }
    }
    if (entry != nullptr && entry->scaleFactor != 0 && header.scaleFactor != entry->scaleFactor) {
        out.headerValid = false;
        out.error = "scale factor mismatch: catalog says " + std::to_string(entry->scaleFactor) +
                    ", file says " + std::to_string(header.scaleFactor);
    }
    return out;
}

}  // namespace v4k
