// NovaForge Engine - assets/Mesh.cpp
#include "assets/Mesh.h"
#include "core/Log.h"

namespace nf {

void Mesh::RecalculateBounds() {
  bounds = AABB{Vec3(1e30f), Vec3(-1e30f)};
  if (!vertices.empty()) {
    for (auto& v : vertices) bounds.Expand(v.position);
  } else {
    for (auto& v : skinnedVertices) bounds.Expand(v.position);
  }
  if (!bounds.IsValid()) bounds = AABB{Vec3(-0.5f), Vec3(0.5f)};
}

void Mesh::RecalculateNormals() {
  for (auto& v : vertices) v.normal = Vec3(0, 0, 0);
  for (usize i = 0; i + 2 < indices.size(); i += 3) {
    u32 i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
    if (i0 >= vertices.size() || i1 >= vertices.size() || i2 >= vertices.size()) continue;
    Vec3 a = vertices[i0].position, b = vertices[i1].position, c = vertices[i2].position;
    Vec3 n = Cross(b - a, c - a);
    vertices[i0].normal += n;
    vertices[i1].normal += n;
    vertices[i2].normal += n;
  }
  for (auto& v : vertices) v.normal = Normalize(v.normal);
}

void Mesh::GenerateTangents() {
  std::vector<Vec3> tan(vertices.size(), Vec3(0, 0, 0));
  std::vector<Vec3> bit(vertices.size(), Vec3(0, 0, 0));
  for (usize i = 0; i + 2 < indices.size(); i += 3) {
    u32 i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
    if (i0 >= vertices.size() || i1 >= vertices.size() || i2 >= vertices.size()) continue;
    const Vertex& v0 = vertices[i0];
    const Vertex& v1 = vertices[i1];
    const Vertex& v2 = vertices[i2];
    Vec3 e1 = v1.position - v0.position;
    Vec3 e2 = v2.position - v0.position;
    Vec2 d1 = v1.uv - v0.uv;
    Vec2 d2 = v2.uv - v0.uv;
    f32 det = d1.x * d2.y - d2.x * d1.y;
    if (Abs(det) < 1e-8f) continue;
    f32 r = 1.0f / det;
    Vec3 t = (e1 * d2.y - e2 * d1.y) * r;
    Vec3 b = (e2 * d1.x - e1 * d2.x) * r;
    tan[i0] += t; tan[i1] += t; tan[i2] += t;
    bit[i0] += b; bit[i1] += b; bit[i2] += b;
  }
  for (usize i = 0; i < vertices.size(); i++) {
    Vec3 n = vertices[i].normal;
    Vec3 t = tan[i];
    if (LengthSq(t) < 1e-12f) { vertices[i].tangent = Vec4(1, 0, 0, 1); continue; }
    t = Normalize(t - n * Dot(n, t));
    f32 w = (Dot(Cross(n, t), bit[i]) < 0.0f) ? -1.0f : 1.0f;
    vertices[i].tangent = Vec4(t.x, t.y, t.z, w);
  }
}

void Mesh::ComputeSubMeshBounds() {
  for (auto& sm : submeshes) {
    sm.bounds = AABB{Vec3(1e30f), Vec3(-1e30f)};
    for (u32 i = 0; i < sm.indexCount && (sm.indexOffset + i) < indices.size(); i++) {
      u32 idx = indices[sm.indexOffset + i];
      if (idx < vertices.size()) sm.bounds.Expand(vertices[idx].position);
    }
    if (!sm.bounds.IsValid()) sm.bounds = bounds;
  }
}

void Mesh::MakeSingleSubMesh(const std::string& materialHint) {
  submeshes.clear();
  SubMesh sm;
  sm.indexOffset = 0;
  sm.indexCount = (u32)indices.size();
  sm.materialIndex = 0;
  sm.name = materialHint;
  sm.bounds = bounds;
  submeshes.push_back(sm);
}

void Mesh::ScaleBy(const Vec3& s) {
  for (auto& v : vertices) { v.position.x *= s.x; v.position.y *= s.y; v.position.z *= s.z; }
  for (auto& v : skinnedVertices) { v.position.x *= s.x; v.position.y *= s.y; v.position.z *= s.z; }
  RecalculateBounds();
  ComputeSubMeshBounds();
}

void Mesh::AppendFrom(const Mesh& other, const Mat4& transform) {
  u32 baseVertex = (u32)vertices.size();
  Mat4 normalMat = transform.NormalMatrix();
  for (auto& v : other.vertices) {
    Vertex nv = v;
    nv.position = transform.TransformPoint(v.position);
    nv.normal = Normalize(normalMat.TransformDir(v.normal));
    nv.tangent = Vec4(Normalize(normalMat.TransformDir(v.tangent.xyz())), v.tangent.w);
    vertices.push_back(nv);
  }
  u32 baseIndex = (u32)indices.size();
  if (other.submeshes.empty()) {
    for (u32 idx : other.indices) indices.push_back(idx + baseVertex);
    SubMesh sm;
    sm.indexOffset = baseIndex;
    sm.indexCount = (u32)other.indices.size();
    sm.vertexOffset = baseVertex;
    sm.materialIndex = 0;
    submeshes.push_back(sm);
  } else {
    for (auto& osm : other.submeshes) {
      SubMesh sm = osm;
      sm.indexOffset = (u32)indices.size();
      sm.vertexOffset = baseVertex;
      for (u32 i = 0; i < osm.indexCount; i++) {
        usize at = (usize)osm.indexOffset + i;
        if (at < other.indices.size()) indices.push_back(other.indices[at] + baseVertex);
      }
      submeshes.push_back(sm);
    }
  }
  RecalculateBounds();
  ComputeSubMeshBounds();
}

Mesh Mesh::Merge(const std::vector<const Mesh*>& meshes, const std::vector<Mat4>& transforms) {
  Mesh out;
  out.name = "Merged";
  for (usize i = 0; i < meshes.size(); i++) {
    if (!meshes[i]) continue;
    Mat4 t = i < transforms.size() ? transforms[i] : Mat4::Identity();
    out.AppendFrom(*meshes[i], t);
  }
  if (out.submeshes.empty()) out.MakeSingleSubMesh();
  return out;
}

// -------------------------------------------------------------------- primitives
static Vertex MakeVertex(const Vec3& p, const Vec3& n, f32 u, f32 v) {
  Vertex vert;
  vert.position = p;
  vert.normal = n;
  vert.uv = {u, v};
  return vert;
}

Mesh Mesh::CreateQuad(f32 w, f32 h) {
  Mesh m;
  m.name = "Quad";
  f32 hw = w * 0.5f, hh = h * 0.5f;
  m.vertices = {
      MakeVertex({-hw, -hh, 0}, {0, 0, 1}, 0, 0),
      MakeVertex({hw, -hh, 0}, {0, 0, 1}, 1, 0),
      MakeVertex({hw, hh, 0}, {0, 0, 1}, 1, 1),
      MakeVertex({-hw, hh, 0}, {0, 0, 1}, 0, 1),
  };
  m.indices = {0, 1, 2, 0, 2, 3};
  m.RecalculateBounds();
  m.MakeSingleSubMesh();
  return m;
}

Mesh Mesh::CreateBox(const Vec3& size, f32 uvScale) {
  Mesh m;
  m.name = "Box";
  Vec3 h = size * 0.5f;
  const Vec3 normals[6] = {{0, 0, 1}, {0, 0, -1}, {1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}};
  // 4 vertices per face, each face spanning the full UV range * uvScale
  const int faces[6][4] = {
      {4, 5, 1, 0},   // +Z
      {7, 6, 2, 3},   // -Z
      {5, 7, 3, 1},   // +X
      {6, 4, 0, 2},   // -X
      {6, 7, 5, 4},   // +Y
      {3, 2, 0, 1},   // -Y
  };
  const Vec3 corners[8] = {
      {-h.x, -h.y, h.z}, {h.x, -h.y, h.z}, {-h.x, h.y, h.z}, {h.x, h.y, h.z},
      {-h.x, -h.y, -h.z}, {h.x, -h.y, -h.z}, {-h.x, h.y, -h.z}, {h.x, h.y, -h.z},
  };
  const Vec2 uvs[4] = {{0, 0}, {1, 0}, {0, 1}, {1, 1}};
  for (int f = 0; f < 6; f++) {
    u32 base = (u32)m.vertices.size();
    for (int c = 0; c < 4; c++) {
      Vec3 p = corners[faces[f][c]];
      m.vertices.push_back(MakeVertex(p, normals[f], uvs[c].x * uvScale, uvs[c].y * uvScale));
    }
    m.indices.insert(m.indices.end(), {base + 0, base + 2, base + 3, base + 0, base + 3, base + 1});
  }
  m.RecalculateBounds();
  m.MakeSingleSubMesh();
  return m;
}

Mesh Mesh::CreateSphere(f32 radius, int segments, int rings) {
  Mesh m;
  m.name = "Sphere";
  segments = std::max(3, segments);
  rings = std::max(2, rings);
  for (int y = 0; y <= rings; y++) {
    f32 v = (f32)y / (f32)rings;
    f32 phi = v * kPi;
    for (int x = 0; x <= segments; x++) {
      f32 u = (f32)x / (f32)segments;
      f32 theta = u * kTwoPi;
      Vec3 n(Sin(phi) * Cos(theta), Cos(phi), Sin(phi) * Sin(theta));
      m.vertices.push_back(MakeVertex(n * radius, n, u, 1.0f - v));
    }
  }
  int stride = segments + 1;
  for (int y = 0; y < rings; y++) {
    for (int x = 0; x < segments; x++) {
      u32 a = (u32)(y * stride + x);
      u32 b = a + 1;
      u32 c = (u32)((y + 1) * stride + x);
      u32 d = c + 1;
      m.indices.insert(m.indices.end(), {a, c, d, a, d, b});
    }
  }
  m.RecalculateBounds();
  m.MakeSingleSubMesh();
  return m;
}

Mesh Mesh::CreatePlane(f32 sizeX, f32 sizeZ, int subdivisions, f32 uvScale) {
  Mesh m;
  m.name = "Plane";
  subdivisions = std::max(1, subdivisions);
  int n = subdivisions + 1;
  for (int z = 0; z < n; z++) {
    for (int x = 0; x < n; x++) {
      f32 fx = (f32)x / (f32)subdivisions;
      f32 fz = (f32)z / (f32)subdivisions;
      Vec3 p((fx - 0.5f) * sizeX, 0, (fz - 0.5f) * sizeZ);
      m.vertices.push_back(MakeVertex(p, {0, 1, 0}, fx * uvScale, fz * uvScale));
    }
  }
  for (int z = 0; z < subdivisions; z++) {
    for (int x = 0; x < subdivisions; x++) {
      u32 a = (u32)(z * n + x);
      u32 b = a + 1;
      u32 c = (u32)((z + 1) * n + x);
      u32 d = c + 1;
      m.indices.insert(m.indices.end(), {a, c, b, b, c, d});
    }
  }
  m.RecalculateBounds();
  m.MakeSingleSubMesh();
  return m;
}

Mesh Mesh::CreateCylinder(f32 radius, f32 height, int segments) {
  Mesh m;
  m.name = "Cylinder";
  segments = std::max(3, segments);
  f32 hh = height * 0.5f;
  for (int i = 0; i <= segments; i++) {
    f32 u = (f32)i / (f32)segments;
    f32 a = u * kTwoPi;
    Vec3 n(Cos(a), 0, Sin(a));
    m.vertices.push_back(MakeVertex(Vec3(n.x * radius, -hh, n.z * radius), n, u, 0));
    m.vertices.push_back(MakeVertex(Vec3(n.x * radius, hh, n.z * radius), n, u, 1));
  }
  for (int i = 0; i < segments; i++) {
    u32 a = (u32)(i * 2), b = a + 1, c = a + 2, d = a + 3;
    m.indices.insert(m.indices.end(), {a, c, d, a, d, b});
  }
  // caps
  for (int side = 0; side < 2; side++) {
    f32 y = side == 0 ? -hh : hh;
    Vec3 n(0, side == 0 ? -1.0f : 1.0f, 0);
    u32 center = (u32)m.vertices.size();
    m.vertices.push_back(MakeVertex(Vec3(0, y, 0), n, 0.5f, 0.5f));
    for (int i = 0; i <= segments; i++) {
      f32 a = (f32)i / (f32)segments * kTwoPi;
      Vec3 p(Cos(a) * radius, y, Sin(a) * radius);
      m.vertices.push_back(MakeVertex(p, n, Cos(a) * 0.5f + 0.5f, Sin(a) * 0.5f + 0.5f));
    }
    for (int i = 0; i < segments; i++) {
      u32 a = center + 1 + (u32)i;
      u32 b = center + 2 + (u32)i;
      if (side == 0) m.indices.insert(m.indices.end(), {center, b, a});
      else m.indices.insert(m.indices.end(), {center, a, b});
    }
  }
  m.RecalculateBounds();
  m.MakeSingleSubMesh();
  return m;
}

Mesh Mesh::CreateCone(f32 radius, f32 height, int segments) {
  Mesh m = CreateCylinder(radius, height, segments);
  m.name = "Cone";
  f32 hh = height * 0.5f;
  // pinch the top ring
  for (auto& v : m.vertices) {
    if (Abs(v.position.y - hh) < 1e-5f) {
      v.position.x = 0; v.position.z = 0;
      v.normal = Vec3(0, 1, 0);
    }
  }
  m.RecalculateBounds();
  return m;
}

Mesh Mesh::CreateCapsule(f32 radius, f32 height, int segments, int rings) {
  Mesh m;
  m.name = "Capsule";
  segments = std::max(4, segments);
  rings = std::max(2, rings);
  f32 cylHeight = std::max(0.0f, height - 2 * radius);
  f32 halfCyl = cylHeight * 0.5f;
  int halfRings = rings / 2;
  for (int part = 0; part < 2; part++) {
    for (int r = 0; r <= halfRings; r++) {
      f32 v = (f32)r / (f32)halfRings;
      f32 phi = v * kHalfPi;
      f32 y = part == 0 ? -halfCyl - Cos(phi) * radius : halfCyl + Sin(phi) * radius;
      f32 rad = Sin(phi) * radius;
      for (int s = 0; s <= segments; s++) {
        f32 u = (f32)s / (f32)segments;
        f32 theta = u * kTwoPi;
        Vec3 n(Cos(theta) * Sin(phi), part == 0 ? -Cos(phi) : Cos(phi), Sin(theta) * Sin(phi));
        Vec3 p(Cos(theta) * rad, y, Sin(theta) * rad);
        m.vertices.push_back(MakeVertex(p, n, u, part == 0 ? 0.5f - v * 0.25f : 0.75f + v * 0.25f));
      }
    }
  }
  int stride = segments + 1;
  int totalRings = (halfRings + 1) * 2;
  for (int r = 0; r < totalRings - 1; r++) {
    for (int s = 0; s < segments; s++) {
      u32 a = (u32)(r * stride + s);
      u32 b = a + 1;
      u32 c = (u32)((r + 1) * stride + s);
      u32 d = c + 1;
      if (r == halfRings - 1) {
        // connect lower hemisphere to the cylinder wall implicitly by bridging
      }
      m.indices.insert(m.indices.end(), {a, c, d, a, d, b});
    }
  }
  m.RecalculateBounds();
  m.MakeSingleSubMesh();
  return m;
}

std::vector<std::string> Mesh::PrimitiveNames() {
  return {"Box", "Sphere", "Plane", "Cylinder", "Capsule", "Cone", "Quad"};
}

Mesh Mesh::CreatePrimitive(const std::string& name) {
  if (name == "Box") return CreateBox();
  if (name == "Sphere") return CreateSphere();
  if (name == "Plane") return CreatePlane();
  if (name == "Cylinder") return CreateCylinder();
  if (name == "Capsule") return CreateCapsule();
  if (name == "Cone") return CreateCone();
  if (name == "Quad") return CreateQuad();
  NF_WARN(LogCategory::Asset, "Unknown primitive '%s' - falling back to Box", name.c_str());
  return CreateBox();
}

} // namespace nf
