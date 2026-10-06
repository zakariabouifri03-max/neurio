// NovaForge Engine - asset registry + caches (the "Content" of a project)
#pragma once
#include "assets/import.h"
#include "assets/material.h"
#include "assets/model.h"
#include "assets/texture.h"

#include <map>
#include <memory>
#include <string>
#include <vector>

namespace nf {

struct AssetInfo {
    std::string path;       // project relative, e.g. "Assets/Models/player.nfmodel.json"
    std::string name;       // display name ("player")
    std::string type;       // Model | Mesh | Material | Texture | Audio | Scene | Script | Prefab | Text
    std::string folder;     // "Assets/Models" (or "<folder>/<sub>" for nested folders)
    int64_t size = 0;
    int64_t modified = 0;
    bool imported = false;      // produced by the importer (has a source file)
    std::string sourceFile;     // import source (may be outside the project)

    bool isModel() const { return type == "Model"; }
};

struct ImportRecord {
    std::string sourceFile;   // absolute path of the original file
    std::string assetPath;    // project relative main asset
    std::string type;
    std::string importedAt;
    ImportOptions options;
};

class AssetLibrary {
public:
    static AssetLibrary& get();

    void setProjectRoot(const std::string& root);
    const std::string& projectRoot() const { return projectRoot_; }

    // Creates the standard project folder layout if missing.
    void ensureStandardFolders();
    // Re-scans the project's Assets folder and loads the import database.
    void rescan();
    const std::vector<AssetInfo>& assets() const { return assets_; }
    std::vector<AssetInfo> assetsOfType(const std::string& type) const;
    const AssetInfo* find(const std::string& projectRelativePath) const;
    bool exists(const std::string& projectRelativePath) const;

    // ---- loading (cached) -------------------------------------------
    std::shared_ptr<Model> loadModel(const std::string& path);
    std::shared_ptr<Model> primitiveModel(const std::string& primitiveName);
    std::shared_ptr<Material> loadMaterial(const std::string& path);
    std::shared_ptr<Material> findMaterial(const std::string& path);
    // Material used when a mesh has no material assigned.
    std::shared_ptr<Material> defaultMaterial();
    std::shared_ptr<Texture> loadTexture(const std::string& path);

    // ---- authoring ---------------------------------------------------
    std::string createMaterial(const std::string& name, const Material& m,
                              const std::string& folder = "Assets/Materials");
    std::string saveMaterial(const std::string& path, const Material& m);
    std::string createFolder(const std::string& projectRelativePath);
    bool deleteAsset(const std::string& projectRelativePath, bool deleteFile = true);
    std::string duplicateAsset(const std::string& projectRelativePath, const std::string& newName = "");
    std::string renameAsset(const std::string& projectRelativePath, const std::string& newName);

    ImportResult importFile(const std::string& sourceFile,
                            const std::string& destinationFolder = "Assets/Models",
                            const std::string& nameOverride = "");
    const std::vector<ImportRecord>& importRecords() const { return imports_; }
    // Re-imports every asset that was produced from `sourceFile`.
    ImportResult reimport(const std::string& assetPath);

    // Frees cached models/materials of a deleted file.
    void invalidate(const std::string& projectRelativePath);
    void clearCaches();

    static const std::vector<std::string>& primitiveNames();  // Cube, Sphere, Plane, ...
    static std::string primitivePath(const std::string& name) { return "primitive://" + name; }
    static bool isPrimitive(const std::string& path) {
        return path.rfind("primitive://", 0) == 0;
    }
    static std::string primitiveNameOf(const std::string& path) {
        return isPrimitive(path) ? path.substr(12) : std::string();
    }

    size_t cacheMemoryBytes() const;

private:
    AssetLibrary() = default;
    void loadImportRecords();
    void saveImportRecords();
    std::string uniquePath(const std::string& folder, const std::string& base,
                           const std::string& extension);

    std::string projectRoot_;
    std::vector<AssetInfo> assets_;
    std::vector<ImportRecord> imports_;
    std::map<std::string, std::shared_ptr<Model>> models_;
    std::map<std::string, std::shared_ptr<Material>> materials_;
    std::shared_ptr<Material> defaultMaterial_;
};

}  // namespace nf
