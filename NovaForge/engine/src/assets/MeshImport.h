// NovaForge Engine - assets/MeshImport.h
// Mesh importers: OBJ, glTF 2.0 (.gltf/.glb), ASCII FBX.
#pragma once

#include "core/Base.h"
#include "assets/Model.h"

namespace nf {

struct MeshImportOptions {
  bool importMaterials = true;
  bool importTextures = true;         // extract embedded textures next to the asset
  bool importAnimations = true;
  bool flipUVs = false;
  bool generateTangents = true;
  std::string textureOutputDir;       // where embedded images are written
  f32 scale = 1.0f;
};

struct MeshImportResult {
  bool success = false;
  std::string error;                  // human readable reason on failure
  std::string warning;
  std::vector<std::shared_ptr<Model>> models;   // multi-mesh formats produce several
};

class MeshImporter {
public:
  static std::string SupportedExtensions();     // "glb;gltf;obj;fbx"
  static bool IsSupported(const std::string& extension);
  // Dispatches on extension, never throws: failures are reported in MeshImportResult::error.
  static MeshImportResult Import(const std::string& path, const MeshImportOptions& options = {});

  static MeshImportResult ImportObj(const std::string& path, const MeshImportOptions& options);
  static MeshImportResult ImportGltf(const std::string& path, const MeshImportOptions& options);
  static MeshImportResult ImportFbx(const std::string& path, const MeshImportOptions& options);
};

} // namespace nf
