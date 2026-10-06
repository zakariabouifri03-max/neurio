// NovaForge Engine - assets/Mesh.h
// CPU mesh data + submeshes + bounding volume. GPU mirrors live in the renderer.
#pragma once

#include "core/Base.h"
#include "core/Math.h"

namespace nf {

struct Vertex {
  Vec3 position{0, 0, 0};
  Vec3 normal{0, 1, 0};
  Vec2 uv{0, 0};
  Vec4 tangent{1, 0, 0, 1};   // w = handedness
};

struct SubMesh {
  u32 indexOffset = 0;
  u32 indexCount = 0;
  u32 vertexOffset = 0;
  int materialIndex = -1;
  AABB bounds;
  std::string name;
};

// A skinned vertex carries up to 4 bone influences.
struct SkinnedVertex {
  Vec3 position{0, 0, 0};
  Vec3 normal{0, 1, 0};
  Vec2 uv{0, 0};
  Vec4 tangent{1, 0, 0, 1};
  u16 joints[4] = {0, 0, 0, 0};
  f32 weights[4] = {0, 0, 0, 0};
};

class Mesh {
public:
  std::string name;
  std::string sourcePath;         // asset-relative path
  std::vector<Vertex> vertices;
  std::vector<u32> indices;
  std::vector<SubMesh> submeshes;
  AABB bounds;

  // Optional skeletal data (populated by the glTF/FBX importer when present).
  std::vector<SkinnedVertex> skinnedVertices;
  bool hasSkinData = false;

  u32 gpuHandle = 0;              // renderer-owned; 0 = not uploaded
  u64 gpuVersion = 0;

  usize VertexCount() const { return vertices.empty() ? skinnedVertices.size() : vertices.size(); }
  usize TriangleCount() const { return indices.size() / 3; }
  bool IsValid() const { return !indices.empty() && VertexCount() > 0; }

  void RecalculateBounds();
  void RecalculateNormals();
  void GenerateTangents();
  void ComputeSubMeshBounds();
  void MakeSingleSubMesh(const std::string& materialHint = "");
  void ScaleBy(const Vec3& s);
  // Weld/copy helpers used by the importers
  void AppendFrom(const Mesh& other, const Mat4& transform);
  static Mesh Merge(const std::vector<const Mesh*>& meshes, const std::vector<Mat4>& transforms);

  // ---- built-in primitives (used by the editor, the AI assistant and the sample game)
  static Mesh CreateBox(const Vec3& size = Vec3(1, 1, 1), f32 uvScale = 1.0f);
  static Mesh CreateSphere(f32 radius = 0.5f, int segments = 24, int rings = 16);
  static Mesh CreatePlane(f32 sizeX = 10.0f, f32 sizeZ = 10.0f, int subdivisions = 1, f32 uvScale = 1.0f);
  static Mesh CreateCylinder(f32 radius = 0.5f, f32 height = 1.0f, int segments = 24);
  static Mesh CreateCapsule(f32 radius = 0.5f, f32 height = 1.0f, int segments = 16, int rings = 8);
  static Mesh CreateCone(f32 radius = 0.5f, f32 height = 1.0f, int segments = 24);
  static Mesh CreateQuad(f32 w = 1.0f, f32 h = 1.0f);
  static std::vector<std::string> PrimitiveNames();
  static Mesh CreatePrimitive(const std::string& name);
};

} // namespace nf
