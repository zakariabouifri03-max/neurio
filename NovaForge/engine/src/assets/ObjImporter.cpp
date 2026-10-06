// NovaForge Engine - assets/ObjImporter.cpp
// Wavefront OBJ importer: v/vn/vt/f, groups, usemtl, mtllib.
#include "assets/MeshImport.h"
#include "core/FileSystem.h"
#include "core/StringUtil.h"
#include "core/Log.h"

namespace nf {

namespace {
struct ObjIndex {
  int v = 0, vt = 0, vn = 0;
  bool operator==(const ObjIndex& o) const { return v == o.v && vt == o.vt && vn == o.vn; }
};
struct ObjIndexHash {
  usize operator()(const ObjIndex& i) const {
    return std::hash<i64>()((i64)i.v) ^ (std::hash<i64>()((i64)i.vt) << 8) ^
           (std::hash<i64>()((i64)i.vn) << 16);
  }
};

Vec3 ParseObjVec3(const std::vector<std::string>& parts) {
  Vec3 v;
  if (parts.size() > 1) v.x = (f32)atof(parts[1].c_str());
  if (parts.size() > 2) v.y = (f32)atof(parts[2].c_str());
  if (parts.size() > 3) v.z = (f32)atof(parts[3].c_str());
  return v;
}

Vec2 ParseObjVec2(const std::vector<std::string>& parts) {
  Vec2 v;
  if (parts.size() > 1) v.x = (f32)atof(parts[1].c_str());
  if (parts.size() > 2) v.y = (f32)atof(parts[2].c_str());
  return v;
}

ObjIndex ParseObjIndex(const std::string& token) {
  ObjIndex idx;
  auto parts = SplitString(token, '/');
  auto toInt = [](const std::string& s) { return s.empty() ? 0 : atoi(s.c_str()); };
  if (parts.size() > 0) idx.v = toInt(parts[0]);
  if (parts.size() > 1) idx.vt = toInt(parts[1]);
  if (parts.size() > 2) idx.vn = toInt(parts[2]);
  return idx;
}
} // namespace

MeshImportResult MeshImporter::ImportObj(const std::string& path, const MeshImportOptions& options) {
  MeshImportResult result;
  std::string text, err;
  if (!fs::ReadText(path, &text, &err)) {
    result.error = "Unable to load " + fs::FileName(path) + "\nReason: " + err;
    return result;
  }

  auto model = std::make_shared<Model>();
  model->name = fs::Stem(path);
  model->sourcePath = path;
  model->mesh = std::make_shared<Mesh>();
  model->mesh->name = model->name;

  std::vector<Vec3> positions;
  std::vector<Vec2> uvs;
  std::vector<Vec3> normals;
  std::unordered_map<ObjIndex, u32, ObjIndexHash> vertexMap;
  std::vector<std::string> materialNames;
  std::unordered_map<std::string, int> materialLookup;

  auto currentMaterialIndex = [&]() -> int {
    if (materialNames.empty()) return -1;
    auto it = materialLookup.find(materialNames.back());
    return it == materialLookup.end() ? -1 : it->second;
  };

  int currentSubMesh = -1;
  auto beginSubMesh = [&]() {
    SubMesh sm;
    sm.indexOffset = (u32)model->mesh->indices.size();
    sm.indexCount = 0;
    sm.materialIndex = currentMaterialIndex();
    sm.name = materialNames.empty() ? "default" : materialNames.back();
    model->mesh->submeshes.push_back(sm);
    currentSubMesh = (int)model->mesh->submeshes.size() - 1;
  };
  beginSubMesh();

  auto lines = SplitString(text, '\n');
  for (auto& rawLine : lines) {
    std::string line = Trim(rawLine);
    if (line.empty() || line[0] == '#') continue;
    auto parts = SplitString(line, ' ');
    std::vector<std::string> tokens;
    for (auto& p : parts) if (!p.empty()) tokens.push_back(p);
    if (tokens.empty()) continue;

    const std::string& kw = tokens[0];
    if (kw == "v") positions.push_back(ParseObjVec3(tokens) * options.scale);
    else if (kw == "vt") uvs.push_back(ParseObjVec2(tokens));
    else if (kw == "vn") normals.push_back(ParseObjVec3(tokens));
    else if (kw == "usemtl") {
      if (tokens.size() > 1) {
        if (!materialNames.empty() && materialNames.back() == tokens[1]) continue;
        // close current submesh, start a new one for the material
        if (currentSubMesh >= 0 && model->mesh->submeshes[(usize)currentSubMesh].indexCount == 0)
          model->mesh->submeshes.pop_back();
        materialNames.push_back(tokens[1]);
        if (!materialLookup.count(tokens[1])) {
          materialLookup[tokens[1]] = (int)model->materials.size();
          Material m;
          m.name = tokens[1];
          model->materials.push_back(m);
        }
        beginSubMesh();
      }
    } else if (kw == "f") {
      std::vector<u32> faceIndices;
      for (usize i = 1; i < tokens.size(); i++) {
        ObjIndex idx = ParseObjIndex(tokens[i]);
        auto normalize = [](int i, usize count) {
          if (i < 0) return (int)count + i;     // OBJ supports negative (relative) indices
          return i - 1;
        };
        ObjIndex key;
        key.v = normalize(idx.v, positions.size());
        key.vt = idx.vt == 0 ? -1 : normalize(idx.vt, uvs.size());
        key.vn = idx.vn == 0 ? -1 : normalize(idx.vn, normals.size());
        auto it = vertexMap.find(key);
        if (it == vertexMap.end()) {
          Vertex v;
          if (key.v >= 0 && key.v < (int)positions.size()) v.position = positions[(usize)key.v];
          if (key.vt >= 0 && key.vt < (int)uvs.size()) {
            v.uv = uvs[(usize)key.vt];
            if (options.flipUVs) v.uv.y = 1.0f - v.uv.y;
          }
          if (key.vn >= 0 && key.vn < (int)normals.size()) v.normal = normals[(usize)key.vn];
          else v.normal = Vec3(0, 0, 0);
          u32 newIndex = (u32)model->mesh->vertices.size();
          model->mesh->vertices.push_back(v);
          vertexMap[key] = newIndex;
          faceIndices.push_back(newIndex);
        } else {
          faceIndices.push_back(it->second);
        }
      }
      if (faceIndices.size() >= 3) {
        for (usize i = 1; i + 1 < faceIndices.size(); i++) {
          model->mesh->indices.push_back(faceIndices[0]);
          model->mesh->indices.push_back(faceIndices[i]);
          model->mesh->indices.push_back(faceIndices[i + 1]);
        }
        if (currentSubMesh >= 0)
          model->mesh->submeshes[(usize)currentSubMesh].indexCount =
              (u32)model->mesh->indices.size() - model->mesh->submeshes[(usize)currentSubMesh].indexOffset;
      }
    } else if (kw == "mtllib" && options.importMaterials && tokens.size() > 1) {
      std::string mtlPath = fs::Join(fs::Parent(path), tokens[1]);
      std::string mtlText;
      if (fs::ReadText(mtlPath, &mtlText)) {
        Material* current = nullptr;
        for (auto& ml : SplitString(mtlText, '\n')) {
          std::string l = Trim(ml);
          auto t = SplitString(l, ' ');
          std::vector<std::string> tk;
          for (auto& p : t) if (!p.empty()) tk.push_back(p);
          if (tk.empty()) continue;
          if (tk[0] == "newmtl" && tk.size() > 1) {
            int idx = -1;
            auto it = materialLookup.find(tk[1]);
            if (it != materialLookup.end()) idx = it->second;
            else {
              idx = (int)model->materials.size();
              materialLookup[tk[1]] = idx;
              Material m;
              m.name = tk[1];
              model->materials.push_back(m);
            }
            current = &model->materials[(usize)idx];
          } else if (current) {
            if (tk[0] == "Kd" && tk.size() > 3) {
              current->baseColor.x = (f32)atof(tk[1].c_str());
              current->baseColor.y = (f32)atof(tk[2].c_str());
              current->baseColor.z = (f32)atof(tk[3].c_str());
            } else if (tk[0] == "Ks" && tk.size() > 3) {
              current->metallic = Clamp((f32)atof(tk[1].c_str()), 0.0f, 1.0f) * 0.5f;
            } else if (tk[0] == "Ns" && tk.size() > 1) {
              f32 ns = (f32)atof(tk[1].c_str());
              current->roughness = Clamp(1.0f - ns / 1000.0f, 0.05f, 1.0f);
            } else if (tk[0] == "d" && tk.size() > 1) {
              current->opacity = (f32)atof(tk[1].c_str());
              current->baseColor.w = current->opacity;
            } else if (tk[0] == "map_Kd" && tk.size() > 1) {
              current->baseColorTexture = tk[1];
            } else if (tk[0] == "map_Bump" || tk[0] == "bump" || tk[0] == "norm") {
              if (tk.size() > 1) current->normalTexture = tk[tk.size() - 1];
            }
          }
        }
      } else {
        result.warning = "Material library not found: " + fs::FileName(mtlPath);
      }
    }
  }

  // drop empty submeshes, ensure at least one
  std::vector<SubMesh> kept;
  for (auto& sm : model->mesh->submeshes) if (sm.indexCount > 0) kept.push_back(sm);
  model->mesh->submeshes = kept;
  if (model->mesh->submeshes.empty()) model->mesh->MakeSingleSubMesh();

  // normals: if the file had none, generate them
  bool missingNormals = false;
  for (auto& v : model->mesh->vertices)
    if (LengthSq(v.normal) < 1e-6f) { missingNormals = true; break; }
  if (missingNormals) model->mesh->RecalculateNormals();
  if (options.generateTangents) model->mesh->GenerateTangents();

  if (model->materials.empty()) model->materials.push_back(Material::Default());
  model->mesh->RecalculateBounds();
  model->mesh->ComputeSubMeshBounds();

  if (model->mesh->indices.empty()) {
    result.error = "Unable to load " + fs::FileName(path) + "\nReason: no faces found in OBJ file";
    return result;
  }

  result.success = true;
  result.warning = result.warning;
  result.models.push_back(model);
  NF_INFO(LogCategory::Asset, "Imported OBJ '%s': %zu verts, %zu tris, %zu material(s)",
          fs::FileName(path).c_str(), model->mesh->vertices.size(), model->mesh->TriangleCount(),
          model->materials.size());
  return result;
}

} // namespace nf
