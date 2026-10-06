// NovaForge Engine - import dispatch (by file type) + texture/audio import
#include "assets/import.h"

#include "assets/material.h"
#include "assets/mesh.h"
#include "assets/model.h"
#include "core/fs.h"
#include "core/guid.h"
#include "core/image.h"
#include "core/log.h"

namespace nf {

const std::vector<std::string>& importableModelExtensions() {
    static const std::vector<std::string> e = {"glb", "gltf", "obj", "fbx"};
    return e;
}
const std::vector<std::string>& importableTextureExtensions() {
    static const std::vector<std::string> e = {"png", "jpg", "jpeg", "tga", "bmp", "psd", "gif"};
    return e;
}
const std::vector<std::string>& importableAudioExtensions() {
    static const std::vector<std::string> e = {"wav", "ogg", "mp3"};
    return e;
}

static bool inList(const std::vector<std::string>& list, const std::string& v) {
    for (auto& s : list)
        if (s == v) return true;
    return false;
}

bool isImportable(const std::string& path) {
    std::string ext = fs::extension(path);
    return inList(importableModelExtensions(), ext) || inList(importableTextureExtensions(), ext) ||
           inList(importableAudioExtensions(), ext);
}

ImportResult importTexture(const std::string& sourceFile, const ImportOptions& opts) {
    ImportResult result;
    std::string ext = fs::extension(sourceFile);
    if (!inList(importableTextureExtensions(), ext))
        return ImportResult::failure("Unable to import '" + fs::filename(sourceFile) +
                                     "'\n  Reason: unsupported image format '." + ext +
                                     "' (supported: png, jpg, jpeg, tga, bmp, psd, gif)");
    ImageData img;
    std::string err;
    if (!decodeImageFile(sourceFile, img, 4, false, &err))
        return ImportResult::failure("Unable to import '" + fs::filename(sourceFile) +
                                     "'\n  Reason: " + err);
    std::string name = opts.nameOverride.empty() ? fs::stem(sourceFile) : opts.nameOverride;
    std::string rel = opts.texturesFolder + "/" + name + ".png";
    std::string full = fs::join(opts.projectRoot, rel);
    if (ext == "png" && fs::isAbsolute(sourceFile)) {
        // keep the original file bytes when the source is already PNG
        fs::Bytes bytes = fs::readBinary(sourceFile);
        if (!fs::writeBinary(full, bytes)) return ImportResult::failure("failed to write " + rel);
    } else if (!writePng(full, img.pixels.data(), img.width, img.height)) {
        return ImportResult::failure("failed to write " + rel);
    }
    result.ok = true;
    result.assetPath = rel;
    result.assetType = "Texture";
    result.createdFiles.push_back(rel);
    char buf[256];
    snprintf(buf, sizeof(buf), "Imported texture '%s': %dx%d", fs::filename(sourceFile).c_str(),
             img.width, img.height);
    result.message = buf;
    NF_LOG_INFO("Import", "%s", result.message.c_str());
    return result;
}

ImportResult importAudio(const std::string& sourceFile, const ImportOptions& opts) {
    ImportResult result;
    std::string ext = fs::extension(sourceFile);
    if (!inList(importableAudioExtensions(), ext))
        return ImportResult::failure("Unable to import '" + fs::filename(sourceFile) +
                                     "'\n  Reason: unsupported audio format '." + ext +
                                     "' (V1 decodes 16/24/32 bit PCM .wav)");
    fs::Bytes bytes = fs::readBinary(sourceFile);
    if (bytes.empty())
        return ImportResult::failure("Unable to import '" + fs::filename(sourceFile) +
                                     "'\n  Reason: file is empty or unreadable");
    if (ext == "wav") {
        std::vector<float> samples;
        int channels = 0, sampleRate = 0;
        std::string err;
        if (!readWav(bytes.data(), bytes.size(), samples, channels, sampleRate, &err))
            return ImportResult::failure("Unable to import '" + fs::filename(sourceFile) +
                                         "'\n  Reason: " + err);
    } else {
        NF_LOG_WARN("Import",
                    "'%s' is copied but '%s' decoding is not implemented in V1 (V1 plays PCM WAV). "
                    "The asset will not produce sound.",
                    fs::filename(sourceFile).c_str(), ext.c_str());
    }
    std::string name = opts.nameOverride.empty() ? fs::stem(sourceFile) : opts.nameOverride;
    std::string rel = opts.audioFolder + "/" + name + "." + ext;
    if (!fs::writeBinary(fs::join(opts.projectRoot, rel), bytes))
        return ImportResult::failure("failed to write " + rel);
    result.ok = true;
    result.assetPath = rel;
    result.assetType = "Audio";
    result.createdFiles.push_back(rel);
    if (ext != "wav")
        result.warnings.push_back("MP3/OGG decoding is not implemented in V1 - the file is copied "
                                  "for reference but will stay silent");
    result.message = "Imported audio '" + fs::filename(sourceFile) + "'";
    NF_LOG_INFO("Import", "%s", result.message.c_str());
    return result;
}

ImportResult importAssetFile(const std::string& sourceFile, const ImportOptions& opts) {
    if (!fs::exists(sourceFile))
        return ImportResult::failure("Unable to import '" + sourceFile +
                                     "'\n  Reason: file does not exist");
    std::string ext = fs::extension(sourceFile);
    if (inList(importableModelExtensions(), ext)) {
        if (ext == "glb" || ext == "gltf") return importGltf(sourceFile, opts);
        if (ext == "obj") return importObj(sourceFile, opts);
        if (ext == "fbx") return importFbx(sourceFile, opts);
    }
    if (inList(importableTextureExtensions(), ext)) return importTexture(sourceFile, opts);
    if (inList(importableAudioExtensions(), ext)) return importAudio(sourceFile, opts);
    return ImportResult::failure("Unable to import '" + fs::filename(sourceFile) +
                                 "'\n  Reason: unsupported file type '." + ext +
                                 "'\n  Supported: glb, gltf, obj, fbx, png, jpg, bmp, tga, wav");
}

}  // namespace nf
