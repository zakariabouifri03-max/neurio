// NovaForge Engine - assets/MeshImport.cpp
#include "assets/MeshImport.h"
#include "core/FileSystem.h"
#include "core/StringUtil.h"
#include "core/Log.h"

#ifndef NF_NO_IMPORTERS
#endif

namespace nf {

std::string MeshImporter::SupportedExtensions() { return "glb;gltf;obj;fbx"; }

bool MeshImporter::IsSupported(const std::string& extension) {
  std::string e = ToLower(extension);
  return e == "glb" || e == "gltf" || e == "obj" || e == "fbx";
}

MeshImportResult MeshImporter::Import(const std::string& path, const MeshImportOptions& options) {
  MeshImportResult result;
  if (!fs::IsFile(path)) {
    result.error = "Unable to load " + fs::FileName(path) + "\nReason: file not found at " + path;
    return result;
  }
  std::string ext = fs::Extension(path);
  if (ext.empty()) {
    result.error = "Unable to load " + fs::FileName(path) +
                   "\nReason: file has no extension - cannot determine format";
    return result;
  }
  if (ext == "obj") return ImportObj(path, options);
  if (ext == "gltf" || ext == "glb") return ImportGltf(path, options);
  if (ext == "fbx") return ImportFbx(path, options);

  result.error = "Unable to load " + fs::FileName(path) + "\nReason: unsupported format '." + ext +
                 "' (supported: glb, gltf, obj, fbx)";
  return result;
}

} // namespace nf
