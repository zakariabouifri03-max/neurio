// NovaForge Engine - mesh data + built-in primitives + .nfmesh container
#pragma once
#include "core/math.h"

#include <cstdint>
#include <string>
#include <vector>

namespace nf {

struct Vertex {
    Vec3 pos;
    Vec3 normal{0, 1, 0};
    Vec2 uv;
    Vec4 color{1, 1, 1, 1};
    uint16_t joints[4] = {0, 0, 0, 0};
    float weights[4] = {0, 0, 0, 0};
};

struct SubMesh {
    int materialIndex = 0;
    uint32_t indexOffset = 0;
    uint32_t indexCount = 0;
};

struct Mesh {
    std::string name;
    std::vector<Vertex> vertices;
    std::vector<uint32_t> indices;
    std::vector<SubMesh> submeshes;
    AABB bounds;
    bool skinned = false;

    size_t triangleCount() const { return indices.size() / 3; }

    void computeBounds();
    void computeNormals(bool smooth = true);
    void addSubMesh(int materialIndex, uint32_t firstIndex, uint32_t count);
    void append(const Mesh& other, int materialIndex);
    void transform(const Mat4& m);  // bakes a transform into the vertices

    // Binary container used by the importer (Assets/Meshes/*.nfmesh)
    bool save(const std::string& path) const;
    bool load(const std::string& path, std::string* error = nullptr);
    std::vector<uint8_t> serialize() const;
    bool deserialize(const uint8_t* data, size_t size, std::string* error = nullptr);
    size_t memoryUsage() const {
        return vertices.size() * sizeof(Vertex) + indices.size() * sizeof(uint32_t);
    }
};

// ---------------------------------------------------------------- primitives
// Built-in meshes: they let a user build a level with zero external files and
// are also the default "Create > Object" entries in the editor.
namespace primitives {
Mesh cube(float size = 1.0f, int subdiv = 1);
Mesh sphere(float radius = 0.5f, int segments = 24, int rings = 16);
Mesh plane(float size = 10.0f, int subdiv = 1, float uvTiling = 1.0f);
Mesh cylinder(float radius = 0.5f, float height = 1.0f, int segments = 24);
Mesh cone(float radius = 0.5f, float height = 1.0f, int segments = 24);
Mesh capsule(float radius = 0.4f, float height = 1.2f, int segments = 16, int rings = 6);
Mesh torus(float major = 0.6f, float minor = 0.2f, int segsMajor = 32, int segsMinor = 16);
Mesh quad(float size = 1.0f);
}  // namespace primitives

// CPU skinning: used by the software rasterizer and by the animation tests.
// The GL renderer performs the same math in a vertex shader.
void applySkinning(const Mesh& mesh, const std::vector<Mat4>& jointMatrices,
                   std::vector<Vertex>& outVertices);

}  // namespace nf
