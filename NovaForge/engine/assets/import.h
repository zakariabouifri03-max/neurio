// NovaForge Engine - asset import interface (glTF/GLB, OBJ, FBX, textures, audio)
#pragma once
#include <string>
#include <vector>

namespace nf {

struct ImportOptions {
    std::string projectRoot;                       // absolute project folder
    std::string modelsFolder = "Assets/Models";
    std::string meshesFolder = "Assets/Meshes";
    std::string materialsFolder = "Assets/Materials";
    std::string texturesFolder = "Assets/Textures";
    std::string audioFolder = "Assets/Audio";
    std::string nameOverride;                      // empty = derive from file name
    float scale = 1.0f;                            // uniform import scale
    bool importAnimations = true;
    bool generateMissingMaterials = true;
    bool copySource = true;                        // copy the source file into the project
};

struct ImportResult {
    bool ok = false;
    std::string message;                    // human readable summary or error + reason
    std::string modelPath;                  // project relative .nfmodel.json (models only)
    std::string assetPath;                  // project relative path of the main asset
    std::string assetType;                  // "Model", "Texture", "Audio", "Material"
    std::vector<std::string> createdFiles;  // project relative
    std::vector<std::string> warnings;
    size_t triangleCount = 0;
    size_t partCount = 0;
    size_t animationCount = 0;

    static ImportResult failure(const std::string& why) {
        ImportResult r;
        r.ok = false;
        r.message = why;
        return r;
    }
};

// Each importer writes engine native assets (.nfmesh / .nfmodel.json /
// .nfmat.json / .png) into the project so that materials and textures stay
// editable after the import.
ImportResult importGltf(const std::string& sourceFile, const ImportOptions& opts);
ImportResult importObj(const std::string& sourceFile, const ImportOptions& opts);
ImportResult importFbx(const std::string& sourceFile, const ImportOptions& opts);
ImportResult importTexture(const std::string& sourceFile, const ImportOptions& opts);
ImportResult importAudio(const std::string& sourceFile, const ImportOptions& opts);

// Dispatches on the file extension. Unknown extensions return a failure with
// an explicit "unsupported" reason (no silent no-ops).
ImportResult importAssetFile(const std::string& sourceFile, const ImportOptions& opts);

// Extensions the engine can import (used by the asset browser / file dialogs)
const std::vector<std::string>& importableModelExtensions();
const std::vector<std::string>& importableTextureExtensions();
const std::vector<std::string>& importableAudioExtensions();
bool isImportable(const std::string& path);

}  // namespace nf
