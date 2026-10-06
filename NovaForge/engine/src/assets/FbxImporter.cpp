// NovaForge Engine - assets/FbxImporter.cpp
// V1 supports *ASCII* FBX (the text flavour exported by Blender/Maya/3ds Max).
// Binary FBX is a proprietary layout; the importer reports that clearly instead of
// failing silently, and points the user at glTF/GLB which NovaForge implements fully.
#include "assets/MeshImport.h"
#include "core/FileSystem.h"
#include "core/StringUtil.h"
#include "core/Log.h"

namespace nf {

namespace {
const char* kBinaryFbxReason =
    "binary FBX is a proprietary format and is not supported in V1.\n"
    "        Fix: re-export the model as glTF 2.0 (.glb) or ASCII FBX (.fbx with\n"
    "        'FBX 7.x ASCII' selected) and import it again.";

bool IsBinaryFbx(const std::vector<u8>& bytes) {
  if (bytes.size() < 27) return false;
  static const char* magic = "Kaydara FBX Binary  \x00";
  return memcmp(bytes.data(), magic, 21) == 0;
}

// Very small recursive "key: value" tokeniser for the ASCII FBX subset we need.
struct FbxNode {
  std::string name;
  std::vector<f64> numbers;
  std::vector<std::string> strings;
  std::vector<FbxNode> children;
  bool hasNumbers = false;
};

} // namespace

MeshImportResult MeshImporter::ImportFbx(const std::string& path, const MeshImportOptions& options) {
  MeshImportResult result;
  std::string readError;
  std::vector<u8> bytes = fs::ReadBinary(path, &readError);
  if (bytes.empty()) {
    result.error = "Unable to load " + fs::FileName(path) + "\nReason: " + readError;
    return result;
  }
  if (IsBinaryFbx(bytes)) {
    result.error = "Unable to load " + fs::FileName(path) + "\nReason: " + kBinaryFbxReason;
    NF_ERROR(LogCategory::Asset, "FBX import failed (%s): %s", fs::FileName(path).c_str(),
             "binary FBX not supported - convert to glTF/GLB");
    return result;
  }

  std::string text((const char*)bytes.data(), bytes.size());
  if (text.find("FBXHeaderExtension") == std::string::npos &&
      text.find("Objects:") == std::string::npos) {
    result.error = "Unable to load " + fs::FileName(path) +
                   "\nReason: not a valid ASCII FBX file (missing header/Objects section)";
    return result;
  }

  // Extract vertex/index data with a tolerant line based parser.
  auto model = std::make_shared<Model>();
  model->name = fs::Stem(path);
  model->sourcePath = path;
  model->mesh = std::make_shared<Mesh>();
  model->mesh->name = model->name;

  std::vector<Vec3> positions;
  std::vector<Vec3> normals;
  std::vector<Vec2> uvs;
  std::vector<i64> polygonIndices;

  auto lines = SplitString(text, '\n');
  for (usize i = 0; i < lines.size(); i++) {
    std::string line = Trim(lines[i]);
    auto parseNumbersAfter = [&](usize startLine) {
      std::vector<f64> out;
      for (usize j = startLine; j < lines.size(); j++) {
        std::string l = Trim(lines[j]);
        if (l.empty()) continue;
        if (l[0] == 'a' || l[0] == '}') break;
        for (auto& tok : SplitString(l, ',')) {
          std::string t = Trim(tok);
          if (t.empty()) continue;
          out.push_back(atof(t.c_str()));
        }
        if (out.size() > 2000000) break;
      }
      return out;
    };

    if (StartsWith(line, "Vertices:")) {
      auto nums = parseNumbersAfter(i + 1);
      for (usize k = 0; k + 2 < nums.size(); k += 3)
        positions.push_back(Vec3((f32)nums[k], (f32)nums[k + 1], (f32)nums[k + 2]) * options.scale);
    } else if (StartsWith(line, "Normals:")) {
      auto nums = parseNumbersAfter(i + 1);
      for (usize k = 0; k + 2 < nums.size(); k += 3)
        normals.push_back(Vec3((f32)nums[k], (f32)nums[k + 1], (f32)nums[k + 2]));
    } else if (StartsWith(line, "UV:") || StartsWith(line, "UVIndex:")) {
      auto nums = parseNumbersAfter(i + 1);
      if (StartsWith(line, "UV:"))
        for (usize k = 0; k + 1 < nums.size(); k += 2)
          uvs.push_back(Vec2((f32)nums[k], 1.0f - (f32)nums[k + 1]));
    } else if (StartsWith(line, "PolygonVertexIndex:")) {
      auto nums = parseNumbersAfter(i + 1);
      for (f64 n : nums) polygonIndices.push_back((i64)n);
    }
  }

  if (positions.empty() || polygonIndices.empty()) {
    result.error = "Unable to load " + fs::FileName(path) +
                   "\nReason: no geometry found. NovaForge supports ASCII FBX geometry "
                   "(Vertices/PolygonVertexIndex). Convert the file to glTF/GLB for full support.";
    NF_ERROR(LogCategory::Asset, "FBX import failed (%s): no geometry", fs::FileName(path).c_str());
    return result;
  }

  // FBX polygon indices use negative-xor encoding for the last index of each polygon.
  const bool normalsArePerVertex = normals.size() == positions.size();
  const bool uvsArePerVertex = uvs.size() == positions.size();
  auto makeVertex = [&](i64 index) -> u32 {
    u32 vi = (u32)index;
    Vertex v;
    if (vi < positions.size()) v.position = positions[vi];
    if (vi < normals.size() && normalsArePerVertex) v.normal = normals[vi];
    if (vi < uvs.size() && uvsArePerVertex) v.uv = uvs[vi];
    u32 out = (u32)model->mesh->vertices.size();
    model->mesh->vertices.push_back(v);
    return out;
  };

  std::vector<u32> polygon;
  for (i64 raw : polygonIndices) {
    if (raw < 0) {
      polygon.push_back((u32)((-raw) - 1));
      for (usize k = 1; k + 1 < polygon.size(); k++) {
        model->mesh->indices.push_back(makeVertex((i64)polygon[0]));
        model->mesh->indices.push_back(makeVertex((i64)polygon[k]));
        model->mesh->indices.push_back(makeVertex((i64)polygon[k + 1]));
      }
      polygon.clear();
    } else {
      polygon.push_back((u32)raw);
    }
  }

  if (model->mesh->indices.empty()) {
    result.error = "Unable to load " + fs::FileName(path) + "\nReason: FBX contains no polygons";
    return result;
  }

  bool missingNormals = normals.empty() || !normalsArePerVertex;
  if (missingNormals) model->mesh->RecalculateNormals();
  if (options.generateTangents) model->mesh->GenerateTangents();
  model->materials.push_back(Material::Default());
  model->mesh->MakeSingleSubMesh();
  model->mesh->RecalculateBounds();
  model->mesh->ComputeSubMeshBounds();

  result.success = true;
  result.warning = "ASCII FBX: materials, skinning and animation import are limited in V1 "
                   "(geometry imported fully). glTF/GLB gives full support.";
  result.models.push_back(model);
  NF_INFO(LogCategory::Asset, "Imported ASCII FBX '%s': %zu verts, %zu tris",
          fs::FileName(path).c_str(), model->mesh->vertices.size(), model->mesh->TriangleCount());
  return result;
}

} // namespace nf
