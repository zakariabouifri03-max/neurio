// NovaForge Engine - assets/AssetDatabase.h
// Central asset registry + cache. Owns mesh/model/texture/material/audio loading,
// asynchronous background import and the Asset Browser's file listing.
#pragma once

#include "core/Base.h"
#include "core/ThreadPool.h"
#include "assets/Model.h"
#include "assets/Texture.h"
#include "assets/Material.h"

namespace nf {

class AudioClip;

enum class AssetType : int {
  Unknown = 0, Model, Mesh, Texture, Material, Scene, Audio, Script, Animation, Folder, Shader
};

const char* AssetTypeName(AssetType type);
AssetType AssetTypeFromExtension(const std::string& ext);
bool IsModelExtension(const std::string& ext);
bool IsTextureExtension(const std::string& ext);
bool IsAudioExtension(const std::string& ext);

struct AssetInfo {
  std::string path;        // project-relative, forward slashes  ("Assets/Models/Hero.glb")
  std::string absolutePath;
  std::string name;
  std::string extension;
  AssetType type = AssetType::Unknown;
  u64 fileSize = 0;
  i64 modifiedTime = 0;
  bool loaded = false;
  bool failed = false;
  std::string loadError;
};

// Result of importing a mesh file into the project.
struct ImportedAsset {
  bool success = false;
  std::string error;
  std::string warning;
  std::string assetPath;                  // primary created asset (the model)
  std::vector<std::string> createdFiles;   // model + extracted textures + generated materials
  int vertexCount = 0;
  int triangleCount = 0;
  int materialCount = 0;
  int animationCount = 0;
};

class AssetDatabase {
public:
  AssetDatabase();
  ~AssetDatabase();

  void SetProjectRoot(const std::string& root);
  const std::string& ProjectRoot() const { return projectRoot_; }
  const std::string& AssetsPath() const { return assetsPath_; }

  // ---- registry
  void Rescan();
  const std::vector<AssetInfo>& Assets() const { return assets_; }
  const AssetInfo* Find(const std::string& projectRelativePath) const;
  std::vector<const AssetInfo*> FindByType(AssetType type) const;
  std::vector<const AssetInfo*> FindByFolder(const std::string& projectRelativeFolder) const;
  bool RegisterFile(const std::string& projectRelativePath);   // called after creating an asset
  void UnregisterFile(const std::string& projectRelativePath);

  // ---- path helpers
  std::string ToAbsolute(const std::string& projectRelative) const;
  std::string ToProjectRelative(const std::string& absolute) const;
  std::string MakeUniqueAssetPath(const std::string& folder, const std::string& fileName) const;

  // ---- loading (cached)
  std::shared_ptr<Model> LoadModel(const std::string& path);
  std::shared_ptr<Mesh> LoadMesh(const std::string& path);       // .nfmesh or via model
  std::shared_ptr<Texture> LoadTexture(const std::string& path);
  std::shared_ptr<Material> LoadMaterial(const std::string& path);
  std::shared_ptr<AudioClip> LoadAudio(const std::string& path);
  std::shared_ptr<Mesh> GetPrimitiveMesh(const std::string& primitiveName);
  std::shared_ptr<Texture> GetDefaultTexture(const std::string& kind);   // white/normal/checker

  // ---- importing
  ImportedAsset ImportMeshFile(const std::string& sourcePathAbs, const std::string& destinationFolder = "Assets/Models");
  ImportedAsset ImportTextureFile(const std::string& sourcePathAbs, const std::string& destinationFolder = "Assets/Textures");
  ImportedAsset ImportAudioFile(const std::string& sourcePathAbs, const std::string& destinationFolder = "Assets/Audio");

  // ---- asynchronous loading (jobs run on the thread pool, results marshal on the main thread)
  void RequestAsyncLoad(const std::string& path, std::function<void()> onLoaded = nullptr);
  void PumpAsync();                                   // call once per frame on the main thread
  i32 PendingAsyncLoads() const { return pendingLoads_; }
  f32 AsyncProgress() const;

  // ---- bookkeeping
  usize LoadedAssetCount() const;
  u64 MemoryFootprint() const;
  void Clear();

private:
  std::shared_ptr<Model> LoadModelInternal(const std::string& path);
  void WriteImportedTextures(const std::string& modelProjectPath, Model& model);

  std::string projectRoot_;
  std::string assetsPath_;
  std::vector<AssetInfo> assets_;
  std::unordered_map<std::string, usize> assetIndex_;

  std::unordered_map<std::string, std::shared_ptr<Model>> models_;
  std::unordered_map<std::string, std::shared_ptr<Mesh>> meshes_;
  std::unordered_map<std::string, std::shared_ptr<Texture>> textures_;
  std::unordered_map<std::string, std::shared_ptr<Material>> materials_;
  std::unordered_map<std::string, std::shared_ptr<AudioClip>> audio_;
  std::unordered_map<std::string, std::shared_ptr<Mesh>> primitives_;

  std::unique_ptr<ThreadPool> pool_;
  std::atomic<i32> pendingLoads_{0};
  std::atomic<i32> totalLoads_{0};
  std::mutex asyncMutex_;
  std::vector<std::pair<std::string, std::vector<std::shared_ptr<Model>>>> asyncResults_;
  std::vector<std::function<void()>> asyncCallbacks_;
  mutable std::mutex cacheMutex_;
};

// Audio clip lives in the audio module; declared here as a shared_ptr target.
class AudioClip {
public:
  std::string name;
  std::vector<f32> samples;      // interleaved
  u32 channels = 2;
  u32 sampleRate = 44100;
  u32 frameCount = 0;
  f32 duration = 0.0f;
  bool IsValid() const { return !samples.empty() && frameCount > 0; }
};

std::string AssetTypeLabel(AssetType type);

} // namespace nf
