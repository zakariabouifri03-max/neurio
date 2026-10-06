// NovaForge Engine - assets/AssetDatabase.cpp
#include "assets/AssetDatabase.h"
#include "assets/MeshImport.h"
#include "core/FileSystem.h"
#include "core/StringUtil.h"
#include "core/Log.h"

namespace nf {

// implemented in ImageImporter.cpp
std::shared_ptr<Texture> LoadTextureFromFile(const std::string& path, std::string* outError);

std::string AssetTypeLabel(AssetType type) { return AssetTypeName(type); }

const char* AssetTypeName(AssetType type) {
  switch (type) {
    case AssetType::Model: return "Model";
    case AssetType::Mesh: return "Mesh";
    case AssetType::Texture: return "Texture";
    case AssetType::Material: return "Material";
    case AssetType::Scene: return "Scene";
    case AssetType::Audio: return "Audio";
    case AssetType::Script: return "Script";
    case AssetType::Animation: return "Animation";
    case AssetType::Folder: return "Folder";
    case AssetType::Shader: return "Shader";
    default: return "Unknown";
  }
}

bool IsModelExtension(const std::string& ext) {
  return ext == "glb" || ext == "gltf" || ext == "obj" || ext == "fbx" || ext == "nfmesh";
}
bool IsTextureExtension(const std::string& ext) {
  return ext == "png" || ext == "jpg" || ext == "jpeg" || ext == "bmp" || ext == "tga" ||
         ext == "gif" || ext == "psd" || ext == "hdr";
}
bool IsAudioExtension(const std::string& ext) {
  return ext == "wav" || ext == "mp3" || ext == "ogg" || ext == "flac";
}

AssetType AssetTypeFromExtension(const std::string& ext) {
  std::string e = ToLower(ext);
  if (IsModelExtension(e)) return AssetType::Model;
  if (e == "nfmesh") return AssetType::Mesh;
  if (IsTextureExtension(e)) return AssetType::Texture;
  if (e == "nfmat") return AssetType::Material;
  if (e == "nfscene") return AssetType::Scene;
  if (IsAudioExtension(e)) return AssetType::Audio;
  if (e == "nfscript" || e == "cpp" || e == "h" || e == "lua") return AssetType::Script;
  if (e == "nfanim") return AssetType::Animation;
  if (e == "glsl" || e == "vert" || e == "frag") return AssetType::Shader;
  return AssetType::Unknown;
}

AssetDatabase::AssetDatabase() { pool_ = std::make_unique<ThreadPool>(2); }
AssetDatabase::~AssetDatabase() = default;

void AssetDatabase::SetProjectRoot(const std::string& root) {
  projectRoot_ = fs::Normalize(root);
  assetsPath_ = fs::Join(projectRoot_, "Assets");
  Rescan();
}

void AssetDatabase::Rescan() {
  assets_.clear();
  assetIndex_.clear();
  if (projectRoot_.empty() || !fs::Exists(assetsPath_)) return;
  for (auto& fi : fs::ListDirectory(assetsPath_, true)) {
    if (fi.isDirectory) continue;
    AssetInfo info;
    info.absolutePath = fi.path;
    info.path = ToProjectRelative(fi.path);
    info.name = fi.name;
    info.extension = fi.extension;
    info.type = AssetTypeFromExtension(fi.extension);
    info.fileSize = fi.size;
    info.modifiedTime = fi.modifiedTime;
    info.loaded = models_.count(info.path) || meshes_.count(info.path) ||
                  textures_.count(info.path) || materials_.count(info.path) ||
                  audio_.count(info.path);
    assetIndex_[info.path] = assets_.size();
    assets_.push_back(info);
  }
  NF_INFO(LogCategory::Asset, "Asset database scanned: %zu files in %s", assets_.size(),
          assetsPath_.c_str());
}

const AssetInfo* AssetDatabase::Find(const std::string& path) const {
  auto it = assetIndex_.find(path);
  if (it == assetIndex_.end()) {
    // tolerate absolute paths and back-slashes
    std::string normalized = ToProjectRelative(path);
    it = assetIndex_.find(normalized);
    if (it == assetIndex_.end()) return nullptr;
  }
  return &assets_[it->second];
}

std::vector<const AssetInfo*> AssetDatabase::FindByType(AssetType type) const {
  std::vector<const AssetInfo*> out;
  for (auto& a : assets_) if (a.type == type) out.push_back(&a);
  return out;
}

std::vector<const AssetInfo*> AssetDatabase::FindByFolder(const std::string& folder) const {
  std::vector<const AssetInfo*> out;
  std::string prefix = folder;
  if (!prefix.empty() && prefix.back() != '/') prefix += "/";
  for (auto& a : assets_)
    if (StartsWith(a.path, prefix)) out.push_back(&a);
  return out;
}

bool AssetDatabase::RegisterFile(const std::string& path) {
  std::string rel = ToProjectRelative(path);
  std::string abs = ToAbsolute(rel);
  if (!fs::IsFile(abs)) return false;
  auto it = assetIndex_.find(rel);
  if (it != assetIndex_.end()) {
    assets_[it->second].modifiedTime = fs::ModifiedTime(abs);
    assets_[it->second].fileSize = fs::FileSize(abs);
    return true;
  }
  AssetInfo info;
  info.absolutePath = abs;
  info.path = rel;
  info.name = fs::FileName(rel);
  info.extension = fs::Extension(rel);
  info.type = AssetTypeFromExtension(info.extension);
  info.fileSize = fs::FileSize(abs);
  info.modifiedTime = fs::ModifiedTime(abs);
  assetIndex_[rel] = assets_.size();
  assets_.push_back(info);
  return true;
}

void AssetDatabase::UnregisterFile(const std::string& path) {
  auto it = assetIndex_.find(path);
  if (it == assetIndex_.end()) return;
  usize index = it->second;
  assets_.erase(assets_.begin() + (i64)index);
  assetIndex_.clear();
  for (usize i = 0; i < assets_.size(); i++) assetIndex_[assets_[i].path] = i;
  models_.erase(path);
  meshes_.erase(path);
  textures_.erase(path);
  materials_.erase(path);
  audio_.erase(path);
}

std::string AssetDatabase::ToAbsolute(const std::string& projectRelative) const {
  if (fs::IsAbsolute(projectRelative)) return fs::Normalize(projectRelative);
  return fs::Normalize(fs::Join(projectRoot_, projectRelative));
}

std::string AssetDatabase::ToProjectRelative(const std::string& absolute) const {
  std::string p = absolute;
  for (auto& c : p) if (c == '\\') c = '/';
  std::string root = projectRoot_;
  for (auto& c : root) if (c == '\\') c = '/';
  if (!root.empty() && StartsWith(p, root)) {
    p = p.substr(root.size());
    while (!p.empty() && p[0] == '/') p.erase(p.begin());
    return p;
  }
  // already relative?
  if (!fs::IsAbsolute(absolute)) return p;
  return p;
}

std::string AssetDatabase::MakeUniqueAssetPath(const std::string& folder, const std::string& fileName) const {
  std::string dir = fs::Join(projectRoot_, folder);
  std::string candidate = fs::Join(folder, fileName);
  if (!fs::Exists(fs::Join(projectRoot_, candidate))) return candidate;
  std::string stem = fs::Stem(fileName);
  std::string ext = fs::Extension(fileName);
  for (int i = 1; i < 1000; i++) {
    candidate = fs::Join(folder, stem + "_" + std::to_string(i) + (ext.empty() ? "" : "." + ext));
    if (!fs::Exists(fs::Join(projectRoot_, candidate))) return candidate;
  }
  return candidate;
}

// ------------------------------------------------------------------ loading
std::shared_ptr<Model> AssetDatabase::LoadModel(const std::string& path) {
  std::lock_guard<std::mutex> lock(cacheMutex_);
  return LoadModelInternal(path);
}

std::shared_ptr<Model> AssetDatabase::LoadModelInternal(const std::string& path) {
  auto it = models_.find(path);
  if (it != models_.end()) return it->second;

  std::string abs = ToAbsolute(path);
  MeshImportResult imported = MeshImporter::Import(abs, {});
  if (!imported.success){
    AssetInfo* info = const_cast<AssetInfo*>(Find(path));
    if (info) {
      info->failed = true;
      info->loadError = imported.error;
    }
    NF_ERROR(LogCategory::Asset, "%s", imported.error.c_str());
    return nullptr;
  }
  auto model = imported.models.empty() ? nullptr : imported.models[0];
  if (!model) {
    NF_ERROR(LogCategory::Asset, "Unable to load %s\nReason: importer returned no data",
             fs::FileName(path).c_str());
    return nullptr;
  }
  model->sourcePath = path;
  for (auto& m : model->materials) {
    // material texture paths are absolute after import - normalise to project relative
    if (!m.baseColorTexture.empty()) m.baseColorTexture = ToProjectRelative(m.baseColorTexture);
    if (!m.normalTexture.empty()) m.normalTexture = ToProjectRelative(m.normalTexture);
    if (!m.metallicRoughnessTexture.empty())
      m.metallicRoughnessTexture = ToProjectRelative(m.metallicRoughnessTexture);
    if (!m.emissiveTexture.empty()) m.emissiveTexture = ToProjectRelative(m.emissiveTexture);
  }
  models_[path] = model;
  AssetInfo* info = const_cast<AssetInfo*>(Find(path));
  if (info) info->loaded = true;
  return model;
}

std::shared_ptr<Mesh> AssetDatabase::LoadMesh(const std::string& path) {
  auto it = meshes_.find(path);
  if (it != meshes_.end()) return it->second;
  auto model = LoadModel(path);
  if (!model) return nullptr;
  meshes_[path] = model->mesh;
  return model->mesh;
}

std::shared_ptr<Texture> AssetDatabase::LoadTexture(const std::string& path) {
  if (path.empty()) return nullptr;
  std::lock_guard<std::mutex> lock(cacheMutex_);
  auto it = textures_.find(path);
  if (it != textures_.end()) return it->second;
  std::string error;
  auto texture = LoadTextureFromFile(ToAbsolute(path), &error);
  if (!texture) {
    NF_ERROR(LogCategory::Asset, "Unable to load texture %s\nReason: %s", path.c_str(), error.c_str());
    AssetInfo* info = const_cast<AssetInfo*>(Find(path));
    if (info) { info->failed = true; info->loadError = error; }
    return nullptr;
  }
  texture->sourcePath = path;
  textures_[path] = texture;
  AssetInfo* info = const_cast<AssetInfo*>(Find(path));
  if (info) info->loaded = true;
  return texture;
}

std::shared_ptr<Material> AssetDatabase::LoadMaterial(const std::string& path) {
  std::lock_guard<std::mutex> lock(cacheMutex_);
  auto it = materials_.find(path);
  if (it != materials_.end()) return it->second;
  Material material;
  std::string error;
  if (!material.LoadFromFile(ToAbsolute(path), &error)) {
    NF_ERROR(LogCategory::Asset, "Unable to load material %s\nReason: %s", path.c_str(), error.c_str());
    return nullptr;
  }
  auto shared = std::make_shared<Material>(material);
  materials_[path] = shared;
  return shared;
}

std::shared_ptr<AudioClip> AssetDatabase::LoadAudio(const std::string& path) {
  std::lock_guard<std::mutex> lock(cacheMutex_);
  auto it = audio_.find(path);
  if (it != audio_.end()) return it->second;
  // Decoding is handled by the audio backend (miniaudio); a lightweight WAV reader is
  // implemented here so the asset is usable even without an audio device.
  auto clip = std::make_shared<AudioClip>();
  clip->name = fs::Stem(path);
  std::string abs = ToAbsolute(path);
  std::string readError;
  std::vector<u8> data = fs::ReadBinary(abs, &readError);
  if (data.size() > 44 && memcmp(data.data(), "RIFF", 4) == 0 && memcmp(data.data() + 8, "WAVE", 4) == 0) {
    usize cursor = 12;
    u16 channels = 1, bits = 16;
    u32 sampleRate = 44100;
    const u8* pcm = nullptr;
    usize pcmSize = 0;
    while (cursor + 8 <= data.size()) {
      const char* id = (const char*)data.data() + cursor;
      u32 size = *(const u32*)(data.data() + cursor + 4);
      if (memcmp(id, "fmt ", 4) == 0 && cursor + 8 + 16 <= data.size()) {
        channels = *(const u16*)(data.data() + cursor + 10);
        sampleRate = *(const u32*)(data.data() + cursor + 12);
        bits = *(const u16*)(data.data() + cursor + 22);
      } else if (memcmp(id, "data", 4) == 0) {
        pcm = data.data() + cursor + 8;
        pcmSize = std::min((usize)size, data.size() - cursor - 8);
      }
      cursor += 8 + size + (size & 1);
    }
    if (pcm && bits == 16) {
      clip->channels = channels;
      clip->sampleRate = sampleRate;
      usize sampleCount = pcmSize / 2;
      clip->samples.resize(sampleCount);
      const i16* src = (const i16*)pcm;
      for (usize i = 0; i < sampleCount; i++) clip->samples[i] = src[i] / 32768.0f;
      clip->frameCount = (u32)(sampleCount / std::max<u32>(1, channels));
      clip->duration = (f32)clip->frameCount / (f32)std::max<u32>(1, sampleRate);
    }
  }
  if (!clip->IsValid()) {
    NF_WARN(LogCategory::Audio,
            "Audio clip '%s' could not be decoded (V1 decodes 16-bit PCM WAV inside the engine; "
            "other formats are handed to the OS audio backend).",
            fs::FileName(path).c_str());
  }
  audio_[path] = clip;
  return clip;
}

std::shared_ptr<Mesh> AssetDatabase::GetPrimitiveMesh(const std::string& primitiveName) {
  auto it = primitives_.find(primitiveName);
  if (it != primitives_.end()) return it->second;
  auto mesh = std::make_shared<Mesh>(Mesh::CreatePrimitive(primitiveName));
  primitives_[primitiveName] = mesh;
  return mesh;
}

std::shared_ptr<Texture> AssetDatabase::GetDefaultTexture(const std::string& kind) {
  std::string key = "internal:" + kind;
  auto it = textures_.find(key);
  if (it != textures_.end()) return it->second;
  std::shared_ptr<Texture> texture;
  if (kind == "normal") texture = Texture::CreateNormalFlat("DefaultNormal", 4);
  else if (kind == "checker") texture = Texture::CreateChecker("Checker", 256);
  else if (kind == "grid") texture = Texture::CreateChecker("Grid", 512, Vec4(0.75f, 0.76f, 0.8f, 1),
                                                            Vec4(0.35f, 0.36f, 0.42f, 1), 16);
  else texture = Texture::CreateSolid("White", Vec4(1, 1, 1, 1), 4);
  textures_[key] = texture;
  return texture;
}

// ------------------------------------------------------------------ importing
static std::string SanitizeFileStem(const std::string& stem) {
  std::string out;
  for (char c : stem) out.push_back((c == ' ' || c == '/' || c == '\\') ? '_' : c);
  return out;
}

ImportedAsset AssetDatabase::ImportMeshFile(const std::string& sourcePathAbs,
                                            const std::string& destinationFolder) {
  ImportedAsset result;
  if (!fs::IsFile(sourcePathAbs)) {
    result.error = "File not found: " + sourcePathAbs;
    return result;
  }
  std::string ext = fs::Extension(sourcePathAbs);
  if (!MeshImporter::IsSupported(ext)) {
    result.error = "Unsupported model format '." + ext + "' (supported: glb, gltf, obj, fbx)";
    return result;
  }
  std::string fileName = SanitizeFileStem(fs::FileName(sourcePathAbs));
  std::string destRel = MakeUniqueAssetPath(destinationFolder, fileName);
  std::string destAbs = fs::Join(projectRoot_, destRel);
  if (fs::Absolute(sourcePathAbs) != fs::Absolute(destAbs)) {
    if (!fs::Copy(sourcePathAbs, destAbs)) {
      result.error = "Could not copy " + fs::FileName(sourcePathAbs) + " into the project";
      return result;
    }
  }
  result.createdFiles.push_back(destRel);

  // glTF references external buffers/images - copy the companions too.
  if (ext == "gltf") {
    JsonValue doc;
    std::string err;
    if (JsonValue::ParseFile(destAbs, &doc, &err)) {
      auto copyCompanion = [&](const std::string& uri) {
        if (uri.empty() || StartsWith(uri, "data:")) return;
        std::string rel = ReplaceAll(uri, "%20", " ");
        std::string src = fs::Join(fs::Parent(sourcePathAbs), rel);
        if (!fs::Exists(src)) return;
        std::string out = MakeUniqueAssetPath(destinationFolder, SanitizeFileStem(fs::FileName(src)));
        if (fs::Copy(src, fs::Join(projectRoot_, out))) result.createdFiles.push_back(out);
      };
      for (usize i = 0; i < doc["buffers"].Size(); i++)
        copyCompanion(doc["buffers"][i]["uri"].AsString());
      for (usize i = 0; i < doc["images"].Size(); i++)
        copyCompanion(doc["images"][i]["uri"].AsString());
    }
  }

  // Import immediately so textures are extracted into the project and the user gets
  // real numbers (verts/tris/materials) in the UI instead of a promise.
  MeshImportOptions options;
  options.textureOutputDir = fs::Join(projectRoot_, "Assets/Textures");
  options.importTextures = true;
  options.importMaterials = true;
  options.importAnimations = true;
  options.generateTangents = true;
  MeshImportResult imported = MeshImporter::Import(destAbs, options);
  if (!imported.success) {
    result.error = imported.error;
    return result;
  }
  result.warning = imported.warning;
  auto model = imported.models[0];
  model->sourcePath = destRel;
  for (auto& m : model->materials) {
    if (!m.baseColorTexture.empty()) {
      std::string rel = ToProjectRelative(m.baseColorTexture);
      m.baseColorTexture = rel;
      result.createdFiles.push_back(rel);
    }
    if (!m.normalTexture.empty()) m.normalTexture = ToProjectRelative(m.normalTexture);
    if (!m.metallicRoughnessTexture.empty())
      m.metallicRoughnessTexture = ToProjectRelative(m.metallicRoughnessTexture);
    if (!m.emissiveTexture.empty()) m.emissiveTexture = ToProjectRelative(m.emissiveTexture);
  }
  {
    std::lock_guard<std::mutex> lock(cacheMutex_);
    models_[destRel] = model;
  }
  result.vertexCount = (int)model->mesh->VertexCount();
  result.triangleCount = (int)model->mesh->TriangleCount();
  result.materialCount = (int)model->materials.size();
  result.animationCount = (int)model->animations.size();
  result.assetPath = destRel;
  result.success = true;

  RegisterFile(destRel);
  for (auto& f : result.createdFiles) RegisterFile(f);
  return result;
}

ImportedAsset AssetDatabase::ImportTextureFile(const std::string& sourcePathAbs,
                                               const std::string& destinationFolder) {
  ImportedAsset result;
  if (!fs::IsFile(sourcePathAbs)) {
    result.error = "File not found: " + sourcePathAbs;
    return result;
  }
  std::string ext = fs::Extension(sourcePathAbs);
  if (!IsTextureExtension(ext)) {
    result.error = "Unsupported image format '." + ext + "'";
    return result;
  }
  std::string destRel = MakeUniqueAssetPath(destinationFolder, fs::FileName(sourcePathAbs));
  std::string destAbs = fs::Join(projectRoot_, destRel);
  if (!fs::Copy(sourcePathAbs, destAbs)) {
    result.error = "Could not copy image into the project";
    return result;
  }
  std::string error;
  auto texture = LoadTextureFromFile(destAbs, &error);
  if (!texture) {
    result.error = "Unable to load " + fs::FileName(sourcePathAbs) + "\nReason: " + error;
    return result;
  }
  {
    std::lock_guard<std::mutex> lock(cacheMutex_);
    texture->sourcePath = destRel;
    textures_[destRel] = texture;
  }
  RegisterFile(destRel);
  result.success = true;
  result.assetPath = destRel;
  result.createdFiles.push_back(destRel);
  return result;
}

ImportedAsset AssetDatabase::ImportAudioFile(const std::string& sourcePathAbs,
                                             const std::string& destinationFolder) {
  ImportedAsset result;
  if (!fs::IsFile(sourcePathAbs)) {
    result.error = "File not found: " + sourcePathAbs;
    return result;
  }
  if (!IsAudioExtension(fs::Extension(sourcePathAbs))) {
    result.error = "Unsupported audio format '." + fs::Extension(sourcePathAbs) + "'";
    return result;
  }
  std::string destRel = MakeUniqueAssetPath(destinationFolder, fs::FileName(sourcePathAbs));
  if (!fs::Copy(sourcePathAbs, fs::Join(projectRoot_, destRel))) {
    result.error = "Could not copy audio file into the project";
    return result;
  }
  RegisterFile(destRel);
  result.success = true;
  result.assetPath = destRel;
  result.createdFiles.push_back(destRel);
  return result;
}

void AssetDatabase::RequestAsyncLoad(const std::string& path, std::function<void()> onLoaded) {
  pendingLoads_.fetch_add(1);
  totalLoads_.fetch_add(1);
  std::string absolute = ToAbsolute(path);
  pool_->Submit([this, path, absolute, onLoaded] {
    MeshImportResult imported = MeshImporter::Import(absolute, {});
    std::lock_guard<std::mutex> lock(asyncMutex_);
    if (imported.success && !imported.models.empty()) {
      auto model = imported.models[0];
      model->sourcePath = path;
      for (auto& m : model->materials) {
        if (!m.baseColorTexture.empty()) m.baseColorTexture = ToProjectRelative(m.baseColorTexture);
        if (!m.normalTexture.empty()) m.normalTexture = ToProjectRelative(m.normalTexture);
      }
      asyncResults_.push_back({path, imported.models});
    } else {
      NF_ERROR(LogCategory::Asset, "Async load failed for %s: %s", path.c_str(),
               imported.error.c_str());
    }
    if (onLoaded) asyncCallbacks_.push_back(onLoaded);
  });
}

void AssetDatabase::PumpAsync() {
  std::vector<std::pair<std::string, std::vector<std::shared_ptr<Model>>>> results;
  std::vector<std::function<void()>> callbacks;
  {
    std::lock_guard<std::mutex> lock(asyncMutex_);
    results.swap(asyncResults_);
    callbacks.swap(asyncCallbacks_);
  }
  if (!results.empty()) {
    std::lock_guard<std::mutex> lock(cacheMutex_);
    for (auto& r : results) {
      models_[r.first] = r.second[0];
      AssetInfo* info = const_cast<AssetInfo*>(Find(r.first));
      if (info) info->loaded = true;
      pendingLoads_.fetch_sub(1);
    }
  }
  for (auto& cb : callbacks) cb();
}

f32 AssetDatabase::AsyncProgress() const {
  i32 total = totalLoads_.load();
  if (total <= 0) return 1.0f;
  return 1.0f - (f32)pendingLoads_.load() / (f32)total;
}

usize AssetDatabase::LoadedAssetCount() const {
  std::lock_guard<std::mutex> lock(cacheMutex_);
  return models_.size() + textures_.size() + materials_.size() + audio_.size();
}

u64 AssetDatabase::MemoryFootprint() const {
  std::lock_guard<std::mutex> lock(cacheMutex_);
  u64 bytes = 0;
  for (auto& m : models_)
    if (m.second && m.second->mesh)
      bytes += m.second->mesh->vertices.size() * sizeof(Vertex) +
               m.second->mesh->indices.size() * sizeof(u32);
  for (auto& t : textures_) bytes += t.second ? t.second->pixels.size() : 0;
  return bytes;
}

void AssetDatabase::Clear() {
  std::lock_guard<std::mutex> lock(cacheMutex_);
  models_.clear();
  meshes_.clear();
  textures_.clear();
  materials_.clear();
  audio_.clear();
}

} // namespace nf
