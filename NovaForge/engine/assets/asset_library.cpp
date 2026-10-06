#include "assets/asset_library.h"

#include "core/fs.h"
#include "core/guid.h"
#include "core/json.h"
#include "core/log.h"

#include <algorithm>
#include <ctime>

namespace nf {

namespace {
std::string lowerExt2(const std::string& path) {
    // returns the last two dot-separated components lowercased ("nfmodel.json")
    std::string f = fs::filename(path);
    std::string::size_type p1 = f.rfind('.');
    if (p1 == std::string::npos) return "";
    std::string::size_type p2 = f.rfind('.', p1 - 1);
    std::string ext = f.substr(p1 + 1);
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
    if (p2 == std::string::npos) return ext;
    std::string ext1 = f.substr(p2 + 1, p1 - p2 - 1);
    std::transform(ext1.begin(), ext1.end(), ext1.begin(), ::tolower);
    return ext1 + "." + ext;
}

std::string timestampNow() {
    time_t t = time(nullptr);
    struct tm* tm = localtime(&t);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", tm);
    return buf;
}
}  // namespace

AssetLibrary& AssetLibrary::get() {
    static AssetLibrary lib;
    return lib;
}

const std::vector<std::string>& AssetLibrary::primitiveNames() {
    static const std::vector<std::string> names = {"Cube",  "Sphere", "Plane",   "Cylinder",
                                                  "Cone",  "Capsule", "Torus",  "Quad"};
    return names;
}

void AssetLibrary::setProjectRoot(const std::string& root) {
    if (projectRoot_ == root) return;
    projectRoot_ = fs::normalize(root);
    clearCaches();
    assets_.clear();
    imports_.clear();
    TextureCache::get().setProjectRoot(projectRoot_);
    if (!projectRoot_.empty()) {
        ensureStandardFolders();
        loadImportRecords();
        rescan();
    }
}

void AssetLibrary::ensureStandardFolders() {
    for (const char* folder :
         {"Assets", "Assets/Models", "Assets/Meshes", "Assets/Materials", "Assets/Textures",
          "Assets/Audio", "Assets/Scenes", "Assets/Scripts", "Assets/Prefabs", "Project", "Logs"})
        fs::createDirectories(fs::join(projectRoot_, folder));
}

void AssetLibrary::rescan() {
    assets_.clear();
    if (projectRoot_.empty()) return;
    std::string assetsRoot = fs::join(projectRoot_, "Assets");
    if (!fs::exists(assetsRoot)) return;
    for (auto& e : fs::listDirectory(assetsRoot, true)) {
        if (e.directory) continue;
        std::string rel = fs::relativeTo(e.path, projectRoot_);
        std::string ext2 = lowerExt2(rel);
        std::string ext = fs::extension(rel);
        AssetInfo info;
        info.path = rel;
        info.name = fs::stem(rel);
        if (ext2 == "nfmodel.json" || ext == "glb" || ext == "gltf" || ext == "obj" ||
            ext == "fbx") {
            info.type = "Model";
        } else if (ext == "nfmesh") {
            info.type = "Mesh";
        } else if (ext2 == "nfmat.json" || ext == "nfmat") {
            info.type = "Material";
        } else if (ext == "png" || ext == "jpg" || ext == "jpeg" || ext == "tga" || ext == "bmp") {
            info.type = "Texture";
        } else if (ext == "wav" || ext == "ogg" || ext == "mp3") {
            info.type = "Audio";
        } else if (ext2 == "nfscene.json" || ext == "nfscene") {
            info.type = "Scene";
        } else if (ext2 == "nfprefab.json") {
            info.type = "Prefab";
        } else if (ext == "lua") {
            info.type = "Script";
        } else {
            info.type = "Text";
        }
        if (ext2 == "nfmodel.json") info.name = fs::stem(fs::stem(rel));
        info.folder = fs::normalize(fs::parent(rel));
        info.size = e.size;
        info.modified = fs::modifiedTime(e.path);
        for (auto& rec : imports_) {
            if (rec.assetPath == rel) {
                info.imported = true;
                info.sourceFile = rec.sourceFile;
                break;
            }
        }
        assets_.push_back(info);
    }
    NF_LOG_INFO("Assets", "scanned project: %zu assets", assets_.size());
}

std::vector<AssetInfo> AssetLibrary::assetsOfType(const std::string& type) const {
    std::vector<AssetInfo> out;
    for (auto& a : assets_)
        if (a.type == type) out.push_back(a);
    return out;
}

const AssetInfo* AssetLibrary::find(const std::string& path) const {
    std::string norm = fs::normalize(path);
    for (auto& a : assets_)
        if (a.path == norm) return &a;
    return nullptr;
}

bool AssetLibrary::exists(const std::string& path) const {
    if (isPrimitive(path)) return true;
    if (path.empty()) return false;
    if (projectRoot_.empty()) return false;
    return fs::exists(fs::join(projectRoot_, path));
}

// ---------------------------------------------------------------- loading
std::shared_ptr<Model> AssetLibrary::loadModel(const std::string& path) {
    if (isPrimitive(path)) return primitiveModel(primitiveNameOf(path));
    if (path.empty()) return nullptr;
    auto it = models_.find(path);
    if (it != models_.end()) return it->second;
    auto model = std::make_shared<Model>();
    std::string err;
    std::string full = fs::isAbsolute(path) ? path : fs::join(projectRoot_, path);
    if (!model->load(full, projectRoot_, &err)) {
        NF_LOG_ERROR("Assets", "Unable to load model '%s'\n  Reason: %s", path.c_str(),
                     err.empty() ? "unknown" : err.c_str());
        models_[path] = nullptr;   // negative cache: do not spam the log every frame
        return nullptr;
    }
    models_[path] = model;
    return model;
}

std::shared_ptr<Model> AssetLibrary::primitiveModel(const std::string& name) {
    std::string key = std::string("primitive://") + name;
    auto it = models_.find(key);
    if (it != models_.end()) return it->second;
    Mesh mesh;
    if (name == "Cube") mesh = primitives::cube(1.0f, 2);
    else if (name == "Sphere") mesh = primitives::sphere(0.5f, 32, 20);
    else if (name == "Plane") mesh = primitives::plane(1.0f, 4, 1.0f);
    else if (name == "Cylinder") mesh = primitives::cylinder(0.5f, 2.0f, 32);
    else if (name == "Cone") mesh = primitives::cone(0.5f, 1.0f, 32);
    else if (name == "Capsule") mesh = primitives::capsule(0.35f, 1.2f, 24, 8);
    else if (name == "Torus") mesh = primitives::torus(0.5f, 0.18f, 40, 20);
    else if (name == "Quad") mesh = primitives::quad(1.0f);
    else {
        NF_LOG_WARN("Assets", "unknown primitive '%s', using a cube", name.c_str());
        mesh = primitives::cube(1.0f, 2);
    }
    auto model = std::make_shared<Model>();
    model->path = key;
    model->name = name;
    ModelNode node;
    node.name = name;
    model->nodes.push_back(node);
    ModelPart part;
    part.name = name;
    part.mesh = std::make_shared<Mesh>(std::move(mesh));
    part.node = 0;
    model->parts.push_back(std::move(part));
    model->computeBounds();
    models_[key] = model;
    return model;
}

std::shared_ptr<Material> AssetLibrary::defaultMaterial() {
    if (!defaultMaterial_) {
        defaultMaterial_ = std::make_shared<Material>();
        defaultMaterial_->name = "Default";
    }
    return defaultMaterial_;
}

std::shared_ptr<Material> AssetLibrary::loadMaterial(const std::string& path) {
    if (path.empty()) return defaultMaterial();
    auto it = materials_.find(path);
    if (it != materials_.end()) return it->second;
    std::string full = fs::isAbsolute(path) ? path : fs::join(projectRoot_, path);
    if (!fs::exists(full)) {
        NF_LOG_ERROR("Assets", "Unable to load material '%s'\n  Reason: file not found", path.c_str());
        materials_[path] = nullptr;
        return defaultMaterial();
    }
    auto mat = std::make_shared<Material>();
    std::string err;
    if (!mat->load(full, &err)) {
        NF_LOG_ERROR("Assets", "Unable to load material '%s'\n  Reason: %s", path.c_str(),
                     err.c_str());
        materials_[path] = nullptr;
        return defaultMaterial();
    }
    materials_[path] = mat;
    return mat;
}

std::shared_ptr<Material> AssetLibrary::findMaterial(const std::string& path) {
    auto it = materials_.find(path);
    return it != materials_.end() ? it->second : nullptr;
}

std::shared_ptr<Texture> AssetLibrary::loadTexture(const std::string& path) {
    return TextureCache::get().load(path);
}

// ---------------------------------------------------------------- authoring
std::string AssetLibrary::uniquePath(const std::string& folder, const std::string& base,
                                     const std::string& extension) {
    std::string candidate = folder + "/" + base + extension;
    int counter = 1;
    while (fs::exists(fs::join(projectRoot_, candidate))) {
        candidate = folder + "/" + base + "_" + std::to_string(counter++) + extension;
    }
    return candidate;
}

std::string AssetLibrary::createMaterial(const std::string& name, const Material& m,
                                        const std::string& folder) {
    Material copy = m;
    copy.name = name;
    if (copy.id.empty()) copy.id = generateGuid();
    fs::createDirectories(fs::join(projectRoot_, folder));
    std::string rel = uniquePath(folder, name, ".nfmat.json");
    copy.save(fs::join(projectRoot_, rel));
    materials_[rel] = std::make_shared<Material>(copy);
    rescan();
    NF_LOG_INFO("Assets", "created material %s", rel.c_str());
    return rel;
}

std::string AssetLibrary::saveMaterial(const std::string& path, const Material& m) {
    if (path.empty()) return "";
    if (!m.save(fs::join(projectRoot_, path))) {
        NF_LOG_ERROR("Assets", "failed to save material %s", path.c_str());
        return "";
    }
    materials_[path] = std::make_shared<Material>(m);
    return path;
}

std::string AssetLibrary::createFolder(const std::string& rel) {
    std::string full = fs::join(projectRoot_, rel);
    if (fs::exists(full)) return "";
    fs::createDirectories(full);
    rescan();
    return fs::normalize(rel);
}

bool AssetLibrary::deleteAsset(const std::string& path, bool deleteFile) {
    if (path.empty()) return false;
    std::string full = fs::join(projectRoot_, path);
    invalidate(path);
    if (deleteFile) {
        if (fs::isDirectory(full)) {
            fs::removeTree(full);
        } else if (!fs::removeFile(full)) {
            NF_LOG_ERROR("Assets", "could not delete '%s'", path.c_str());
            return false;
        }
    }
    imports_.erase(std::remove_if(imports_.begin(), imports_.end(),
                                 [&](const ImportRecord& r) { return r.assetPath == path; }),
                   imports_.end());
    saveImportRecords();
    rescan();
    return true;
}

std::string AssetLibrary::duplicateAsset(const std::string& path, const std::string& newName) {
    std::string full = fs::join(projectRoot_, path);
    if (!fs::exists(full)) return "";
    std::string folder = fs::parent(path);
    std::string ext2 = lowerExt2(path);
    std::string suffix = ext2 == "nfmodel.json" ? ".nfmodel.json"
                       : ext2 == "nfmat.json" ? ".nfmat.json"
                       : ext2 == "nfscene.json" ? ".nfscene.json"
                       : ("." + fs::extension(path));
    std::string base = newName.empty() ? fs::stem(fs::stem(path)) + "_Copy" : newName;
    std::string rel = uniquePath(folder, base, suffix);
    if (!fs::copyFile(full, fs::join(projectRoot_, rel))) return "";
    rescan();
    return rel;
}

std::string AssetLibrary::renameAsset(const std::string& path, const std::string& newName) {
    if (newName.empty()) return "";
    std::string folder = fs::parent(path);
    std::string ext2 = lowerExt2(path);
    std::string suffix = ext2 == "nfmodel.json" ? ".nfmodel.json"
                       : ext2 == "nfmat.json" ? ".nfmat.json"
                       : ext2 == "nfscene.json" ? ".nfscene.json"
                       : ("." + fs::extension(path));
    std::string rel = folder + "/" + newName + suffix;
    if (fs::exists(fs::join(projectRoot_, rel))) return "";
    std::string from = fs::join(projectRoot_, path), to = fs::join(projectRoot_, rel);
    invalidate(path);
    if (!fs::rename(from, to)) return "";
    for (auto& r : imports_)
        if (r.assetPath == path) r.assetPath = rel;
    saveImportRecords();
    rescan();
    return rel;
}

ImportResult AssetLibrary::importFile(const std::string& sourceFile,
                                      const std::string& destinationFolder,
                                      const std::string& nameOverride) {
    ImportOptions opts;
    opts.projectRoot = projectRoot_;
    if (!nameOverride.empty()) opts.nameOverride = nameOverride;
    if (destinationFolder.rfind("Assets/Textures", 0) == 0) opts.texturesFolder = destinationFolder;
    if (destinationFolder.rfind("Assets/Audio", 0) == 0) opts.audioFolder = destinationFolder;
    if (destinationFolder.rfind("Assets/Models", 0) == 0) opts.modelsFolder = destinationFolder;
    ImportResult result = importAssetFile(sourceFile, opts);
    if (!result.ok) return result;
    ensureStandardFolders();
    ImportRecord rec;
    rec.sourceFile = fs::absolute(sourceFile);
    rec.assetPath = result.assetPath;
    rec.type = result.assetType;
    rec.importedAt = timestampNow();
    rec.options = opts;
    imports_.push_back(rec);
    saveImportRecords();
    rescan();
    return result;
}

ImportResult AssetLibrary::reimport(const std::string& assetPath) {
    for (auto& r : imports_) {
        bool match = r.assetPath == assetPath;
        if (!match) {
            // also match when any generated file of the import is referenced
            match = r.assetPath == assetPath;
        }
        if (!match) continue;
        if (!fs::exists(r.sourceFile)) {
            return ImportResult::failure("Unable to reimport '" + assetPath +
                                         "'\n  Reason: original source file is missing: " +
                                         r.sourceFile);
        }
        invalidate(r.assetPath);
        clearCaches();
        ImportOptions opts = r.options;
        opts.projectRoot = projectRoot_;
        ImportResult res = importAssetFile(r.sourceFile, opts);
        if (res.ok) {
            r.importedAt = timestampNow();
            r.assetPath = res.assetPath;
            saveImportRecords();
            rescan();
        }
        return res;
    }
    return ImportResult::failure("'" + assetPath +
                                 "' was not produced by an import (nothing to reimport)");
}

void AssetLibrary::invalidate(const std::string& path) {
    models_.erase(path);
    materials_.erase(path);
    for (auto& kv : models_) {
        if (kv.second) {
            for (auto& part : kv.second->parts) {
                for (auto& mp : part.subMaterialPaths)
                    if (mp == path) materials_.erase(mp);
            }
        }
    }
}

void AssetLibrary::clearCaches() {
    models_.clear();
    materials_.clear();
    TextureCache::get().clear();
}

size_t AssetLibrary::cacheMemoryBytes() const {
    size_t total = 0;
    for (auto& kv : models_) {
        if (!kv.second) continue;
        for (auto& p : kv.second->parts)
            if (p.mesh) total += p.mesh->memoryUsage();
    }
    return total + TextureCache::get().memoryUsageBytes();
}

// ---------------------------------------------------------------- import db
void AssetLibrary::loadImportRecords() {
    imports_.clear();
    std::string path = fs::join(projectRoot_, "Project/imports.json");
    if (!fs::exists(path)) return;
    Json root;
    std::string err;
    if (!Json::parseFile(path, root, &err)) {
        NF_LOG_WARN("Assets", "could not read the import database: %s", err.c_str());
        return;
    }
    for (const Json& j : root["imports"].items()) {
        ImportRecord r;
        r.sourceFile = j["sourceFile"].asString();
        r.assetPath = j["assetPath"].asString();
        r.type = j["type"].asString();
        r.importedAt = j["importedAt"].asString();
        r.options.projectRoot = projectRoot_;
        imports_.push_back(r);
    }
}

void AssetLibrary::saveImportRecords() {
    Json root = Json::object();
    root.set("format", "NovaForgeImportDatabase");
    root.set("version", 1);
    Json& arr = root.arrayAt("imports");
    for (auto& r : imports_) {
        Json j = Json::object();
        j.set("sourceFile", r.sourceFile);
        j.set("assetPath", r.assetPath);
        j.set("type", r.type);
        j.set("importedAt", r.importedAt);
        arr.push(j);
    }
    root.saveFile(fs::join(projectRoot_, "Project/imports.json"), 2);
}

}  // namespace nf
