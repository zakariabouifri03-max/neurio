#include "assets/mesh.h"
#include "core/fs.h"
#include "core/log.h"

#include <cstring>

namespace nf {

void Mesh::computeBounds() {
    bounds = AABB();
    for (auto& v : vertices) bounds.expand(v.pos);
    if (vertices.empty()) {
        bounds.expand(Vec3(0, 0, 0));
    }
}

void Mesh::computeNormals(bool smooth) {
    for (auto& v : vertices) v.normal = Vec3(0, 0, 0);
    for (size_t i = 0; i + 2 < indices.size(); i += 3) {
        Vertex& a = vertices[indices[i]];
        Vertex& b = vertices[indices[i + 1]];
        Vertex& c = vertices[indices[i + 2]];
        Vec3 n = cross(b.pos - a.pos, c.pos - a.pos);
        if (!smooth) {
            a.normal += n; b.normal += n; c.normal += n;
        } else {
            a.normal += n; b.normal += n; c.normal += n;
        }
    }
    for (auto& v : vertices) v.normal = v.normal.normalized();
}

void Mesh::addSubMesh(int materialIndex, uint32_t firstIndex, uint32_t count) {
    SubMesh s;
    s.materialIndex = materialIndex;
    s.indexOffset = firstIndex;
    s.indexCount = count;
    submeshes.push_back(s);
}

void Mesh::append(const Mesh& other, int materialIndex) {
    uint32_t base = (uint32_t)vertices.size();
    vertices.insert(vertices.end(), other.vertices.begin(), other.vertices.end());
    uint32_t first = (uint32_t)indices.size();
    for (uint32_t idx : other.indices) indices.push_back(idx + base);
    addSubMesh(materialIndex, first, (uint32_t)other.indices.size());
    skinned = skinned || other.skinned;
    computeBounds();
}

void Mesh::transform(const Mat4& m) {
    Mat4 nrm = m.normalMatrix();
    for (auto& v : vertices) {
        v.pos = m.transformPoint(v.pos);
        v.normal = nrm.transformDir(v.normal).normalized();
    }
    computeBounds();
}

// ------------------------------------------------------------- container
static const char kMeshMagic[8] = {'N', 'F', 'M', 'S', 'H', '0', '0', '1'};

std::vector<uint8_t> Mesh::serialize() const {
    std::vector<uint8_t> out;
    auto put = [&](const void* p, size_t n) {
        const uint8_t* b = (const uint8_t*)p;
        out.insert(out.end(), b, b + n);
    };
    auto put32 = [&](uint32_t v) { put(&v, 4); };
    auto putF = [&](float v) { put(&v, 4); };
    put(kMeshMagic, 8);
    put32((uint32_t)name.size());
    put(name.data(), name.size());
    put32(skinned ? 1u : 0u);
    put32((uint32_t)vertices.size());
    put32((uint32_t)indices.size());
    put32((uint32_t)submeshes.size());
    putF(bounds.min.x); putF(bounds.min.y); putF(bounds.min.z);
    putF(bounds.max.x); putF(bounds.max.y); putF(bounds.max.z);
    // interleaved vertex stream (compact, deterministic)
    for (const Vertex& v : vertices) {
        putF(v.pos.x); putF(v.pos.y); putF(v.pos.z);
        putF(v.normal.x); putF(v.normal.y); putF(v.normal.z);
        putF(v.uv.x); putF(v.uv.y);
        putF(v.color.x); putF(v.color.y); putF(v.color.z); putF(v.color.w);
        if (skinned) {
            uint16_t j[4] = {v.joints[0], v.joints[1], v.joints[2], v.joints[3]};
            float w4[4] = {v.weights[0], v.weights[1], v.weights[2], v.weights[3]};
            put(j, 8);
            put(w4, 16);
        }
    }
    put(indices.data(), indices.size() * 4);
    for (const SubMesh& s : submeshes) {
        put32((uint32_t)s.materialIndex);
        put32(s.indexOffset);
        put32(s.indexCount);
    }
    return out;
}

bool Mesh::deserialize(const uint8_t* data, size_t size, std::string* error) {
    size_t off = 0;
    auto need = [&](size_t n) {
        if (off + n > size) {
            if (error) *error = "truncated .nfmesh file";
            return false;
        }
        return true;
    };
    if (!need(8) || memcmp(data, kMeshMagic, 8) != 0) {
        if (error) *error = "not a NovaForge mesh file (bad magic)";
        return false;
    }
    off += 8;
    uint32_t nameLen = 0;
    if (!need(4)) return false;
    memcpy(&nameLen, data + off, 4);
    off += 4;
    if (!need(nameLen)) return false;
    name.assign((const char*)data + off, nameLen);
    off += nameLen;
    uint32_t flags = 0, vcount = 0, icount = 0, scount = 0;
    if (!need(28)) return false;
    memcpy(&flags, data + off, 4); off += 4;
    memcpy(&vcount, data + off, 4); off += 4;
    memcpy(&icount, data + off, 4); off += 4;
    memcpy(&scount, data + off, 4); off += 4;
    float bmin[3], bmax[3];
    memcpy(bmin, data + off, 12); off += 12;
    memcpy(bmax, data + off, 12); off += 12;
    skinned = (flags & 1) != 0;
    bounds.min = Vec3(bmin[0], bmin[1], bmin[2]);
    bounds.max = Vec3(bmax[0], bmax[1], bmax[2]);
    if (vcount > 80000000u || icount > 240000000u) {
        if (error) *error = "implausible mesh size";
        return false;
    }
    const size_t vstride = skinned ? 72 : 48;
    if (!need((size_t)vcount * vstride)) return false;
    vertices.resize(vcount);
    for (uint32_t i = 0; i < vcount; ++i) {
        const float* f = (const float*)(data + off);
        Vertex v;
        v.pos = Vec3(f[0], f[1], f[2]);
        v.normal = Vec3(f[3], f[4], f[5]);
        v.uv = Vec2(f[6], f[7]);
        v.color = Vec4(f[8], f[9], f[10], f[11]);
        if (skinned) {
            const uint16_t* j = (const uint16_t*)(data + off + 48);
            v.joints[0] = j[0]; v.joints[1] = j[1]; v.joints[2] = j[2]; v.joints[3] = j[3];
            const float* w = (const float*)(data + off + 56);
            v.weights[0] = w[0]; v.weights[1] = w[1]; v.weights[2] = w[2]; v.weights[3] = w[3];
            off += 72;
        } else {
            off += 48;
        }
        vertices[i] = v;
    }
    if (!need((size_t)icount * 4)) return false;
    indices.resize(icount);
    memcpy(indices.data(), data + off, (size_t)icount * 4);
    off += (size_t)icount * 4;
    if (!need((size_t)scount * 12)) return false;
    submeshes.resize(scount);
    for (uint32_t i = 0; i < scount; ++i) {
        uint32_t t[3];
        memcpy(t, data + off, 12);
        off += 12;
        submeshes[i].materialIndex = (int)t[0];
        submeshes[i].indexOffset = t[1];
        submeshes[i].indexCount = t[2];
    }
    return true;
}

bool Mesh::save(const std::string& path) const {
    return fs::writeBinary(path, serialize());
}

bool Mesh::load(const std::string& path, std::string* error) {
    fs::Bytes bytes = fs::readBinary(path);
    if (bytes.empty()) {
        if (error) *error = "cannot read mesh file: " + path;
        return false;
    }
    return deserialize(bytes.data(), bytes.size(), error);
}

// ------------------------------------------------------------- skinning
void applySkinning(const Mesh& mesh, const std::vector<Mat4>& jointMatrices,
                   std::vector<Vertex>& out) {
    out.resize(mesh.vertices.size());
    for (size_t i = 0; i < mesh.vertices.size(); ++i) {
        const Vertex& v = mesh.vertices[i];
        Vec3 p(0, 0, 0), n(0, 0, 0);
        float total = 0;
        for (int k = 0; k < 4; ++k) {
            float w = v.weights[k];
            if (w <= 0.0001f) continue;
            size_t j = v.joints[k];
            if (j >= jointMatrices.size()) continue;
            const Mat4& m = jointMatrices[j];
            p += m.transformPoint(v.pos) * w;
            n += m.normalMatrix().transformDir(v.normal) * w;
            total += w;
        }
        Vertex o = v;
        if (total > 0.0001f) {
            o.pos = p / total;
            o.normal = n.normalized();
        }
        out[i] = o;
    }
}

// ------------------------------------------------------------- primitives
namespace primitives {

Mesh cube(float size, int subdiv) {
    Mesh m;
    m.name = "Cube";
    if (subdiv < 1) subdiv = 1;
    const float h = size * 0.5f;
    struct Face {
        Vec3 n, u, v, origin;
    };
    Face faces[6] = {
        {{0, 0, 1}, {1, 0, 0}, {0, 1, 0}, {0, 0, h}},    // +Z
        {{0, 0, -1}, {-1, 0, 0}, {0, 1, 0}, {0, 0, -h}},  // -Z
        {{1, 0, 0}, {0, 0, -1}, {0, 1, 0}, {h, 0, 0}},    // +X
        {{-1, 0, 0}, {0, 0, 1}, {0, 1, 0}, {-h, 0, 0}},   // -X
        {{0, 1, 0}, {1, 0, 0}, {0, 0, -1}, {0, h, 0}},    // +Y
        {{0, -1, 0}, {1, 0, 0}, {0, 0, 1}, {0, -h, 0}},   // -Y
    };
    for (int f = 0; f < 6; ++f) {
        uint32_t base = (uint32_t)m.vertices.size();
        for (int y = 0; y <= subdiv; ++y) {
            for (int x = 0; x <= subdiv; ++x) {
                float fx = (float)x / subdiv, fy = (float)y / subdiv;
                Vertex v;
                v.pos = faces[f].origin + faces[f].u * ((fx - 0.5f) * size) +
                        faces[f].v * ((fy - 0.5f) * size);
                v.normal = faces[f].n;
                v.uv = Vec2(fx, fy);
                m.vertices.push_back(v);
            }
        }
        for (int y = 0; y < subdiv; ++y) {
            for (int x = 0; x < subdiv; ++x) {
                uint32_t a = base + (uint32_t)(y * (subdiv + 1) + x);
                uint32_t b = a + 1;
                uint32_t c = a + (uint32_t)(subdiv + 1);
                uint32_t d = c + 1;
                m.indices.push_back(a); m.indices.push_back(c); m.indices.push_back(b);
                m.indices.push_back(b); m.indices.push_back(c); m.indices.push_back(d);
            }
        }
    }
    m.addSubMesh(0, 0, (uint32_t)m.indices.size());
    m.computeBounds();
    return m;
}

Mesh plane(float size, int subdiv, float uvTiling) {
    Mesh m;
    m.name = "Plane";
    if (subdiv < 1) subdiv = 1;
    for (int y = 0; y <= subdiv; ++y) {
        for (int x = 0; x <= subdiv; ++x) {
            float fx = (float)x / subdiv, fy = (float)y / subdiv;
            Vertex v;
            v.pos = Vec3((fx - 0.5f) * size, 0, (fy - 0.5f) * size);
            v.normal = Vec3(0, 1, 0);
            v.uv = Vec2(fx * uvTiling, fy * uvTiling);
            m.vertices.push_back(v);
        }
    }
    for (int y = 0; y < subdiv; ++y)
        for (int x = 0; x < subdiv; ++x) {
            uint32_t a = (uint32_t)(y * (subdiv + 1) + x);
            uint32_t b = a + 1;
            uint32_t c = a + (uint32_t)(subdiv + 1);
            uint32_t d = c + 1;
            m.indices.push_back(a); m.indices.push_back(c); m.indices.push_back(b);
            m.indices.push_back(b); m.indices.push_back(c); m.indices.push_back(d);
        }
    m.addSubMesh(0, 0, (uint32_t)m.indices.size());
    m.computeBounds();
    return m;
}

Mesh quad(float size) { return plane(size, 1, 1.0f); }

Mesh sphere(float radius, int segments, int rings) {
    Mesh m;
    m.name = "Sphere";
    if (segments < 3) segments = 3;
    if (rings < 2) rings = 2;
    for (int y = 0; y <= rings; ++y) {
        float v = (float)y / rings;
        float phi = v * PI;
        for (int x = 0; x <= segments; ++x) {
            float u = (float)x / segments;
            float theta = u * 2.0f * PI;
            Vertex vert;
            Vec3 n(std::sin(phi) * std::cos(theta), std::cos(phi), std::sin(phi) * std::sin(theta));
            vert.pos = n * radius;
            vert.normal = n;
            vert.uv = Vec2(u, 1.0f - v);
            m.vertices.push_back(vert);
        }
    }
    for (int y = 0; y < rings; ++y)
        for (int x = 0; x < segments; ++x) {
            uint32_t a = (uint32_t)(y * (segments + 1) + x);
            uint32_t b = a + 1;
            uint32_t c = a + (uint32_t)(segments + 1);
            uint32_t d = c + 1;
            m.indices.push_back(a); m.indices.push_back(c); m.indices.push_back(b);
            m.indices.push_back(b); m.indices.push_back(c); m.indices.push_back(d);
        }
    m.addSubMesh(0, 0, (uint32_t)m.indices.size());
    m.computeBounds();
    return m;
}

Mesh cylinder(float radius, float height, int segments) {
    Mesh m;
    m.name = "Cylinder";
    if (segments < 3) segments = 3;
    const float h = height * 0.5f;
    // side
    for (int y = 0; y <= 1; ++y)
        for (int x = 0; x <= segments; ++x) {
            float u = (float)x / segments;
            float theta = u * 2.0f * PI;
            Vertex v;
            Vec3 n(std::cos(theta), 0, std::sin(theta));
            v.pos = Vec3(n.x * radius, y ? h : -h, n.z * radius);
            v.normal = n;
            v.uv = Vec2(u, (float)y);
            m.vertices.push_back(v);
        }
    for (int x = 0; x < segments; ++x) {
        uint32_t a = (uint32_t)x, b = a + 1, c = a + (uint32_t)(segments + 1),
                 d = c + 1;
        m.indices.push_back(a); m.indices.push_back(c); m.indices.push_back(b);
        m.indices.push_back(b); m.indices.push_back(c); m.indices.push_back(d);
    }
    // caps
    for (int cap = 0; cap < 2; ++cap) {
        float y = cap ? h : -h;
        uint32_t center = (uint32_t)m.vertices.size();
        Vertex cv;
        cv.pos = Vec3(0, y, 0);
        cv.normal = Vec3(0, cap ? 1 : -1, 0);
        cv.uv = Vec2(0.5f, 0.5f);
        m.vertices.push_back(cv);
        for (int x = 0; x <= segments; ++x) {
            float theta = (float)x / segments * 2.0f * PI;
            Vertex v;
            v.pos = Vec3(std::cos(theta) * radius, y, std::sin(theta) * radius);
            v.normal = cv.normal;
            v.uv = Vec2(0.5f + std::cos(theta) * 0.5f, 0.5f + std::sin(theta) * 0.5f);
            m.vertices.push_back(v);
        }
        for (int x = 0; x < segments; ++x) {
            uint32_t a = center + 1 + (uint32_t)x, b = a + 1;
            if (cap) {
                m.indices.push_back(center); m.indices.push_back(b); m.indices.push_back(a);
            } else {
                m.indices.push_back(center); m.indices.push_back(a); m.indices.push_back(b);
            }
        }
    }
    m.addSubMesh(0, 0, (uint32_t)m.indices.size());
    m.computeBounds();
    return m;
}

Mesh cone(float radius, float height, int segments) {
    Mesh m;
    m.name = "Cone";
    if (segments < 3) segments = 3;
    const float h = height * 0.5f;
    float slope = radius / (height > 0.0001f ? height : 1.0f);
    for (int x = 0; x <= segments; ++x) {
        float u = (float)x / segments;
        float theta = u * 2.0f * PI;
        Vec3 n = Vec3(std::cos(theta), slope, std::sin(theta)).normalized();
        Vertex v0, v1;
        v0.pos = Vec3(std::cos(theta) * radius, -h, std::sin(theta) * radius);
        v0.normal = n;
        v0.uv = Vec2(u, 0);
        v1.pos = Vec3(0, h, 0);
        v1.normal = n;
        v1.uv = Vec2(u, 1);
        m.vertices.push_back(v0);
        m.vertices.push_back(v1);
        if (x < segments) {
            uint32_t a = (uint32_t)(x * 2), b = a + 1, c = a + 2, d = a + 3;
            m.indices.push_back(a); m.indices.push_back(b); m.indices.push_back(c);
            m.indices.push_back(b); m.indices.push_back(d); m.indices.push_back(c);
        }
    }
    // base
    uint32_t center = (uint32_t)m.vertices.size();
    Vertex cv;
    cv.pos = Vec3(0, -h, 0);
    cv.normal = Vec3(0, -1, 0);
    cv.uv = Vec2(0.5f, 0.5f);
    m.vertices.push_back(cv);
    for (int x = 0; x <= segments; ++x) {
        float theta = (float)x / segments * 2.0f * PI;
        Vertex v;
        v.pos = Vec3(std::cos(theta) * radius, -h, std::sin(theta) * radius);
        v.normal = cv.normal;
        v.uv = Vec2(0.5f + std::cos(theta) * 0.5f, 0.5f + std::sin(theta) * 0.5f);
        m.vertices.push_back(v);
    }
    for (int x = 0; x < segments; ++x)
        m.indices.push_back(center), m.indices.push_back(center + 1 + x),
            m.indices.push_back(center + 2 + x);
    m.addSubMesh(0, 0, (uint32_t)m.indices.size());
    m.computeBounds();
    return m;
}

Mesh capsule(float radius, float height, int segments, int rings) {
    Mesh m;
    m.name = "Capsule";
    const float h = height * 0.5f;
    for (int r = 0; r <= rings * 2; ++r) {
        float t = (float)r / (rings * 2);          // 0..1 top->bottom
        float phi = t * PI;                        // 0..PI
        float y = std::cos(phi) * radius;
        y += (t < 0.5f ? h : -h);
        for (int s = 0; s <= segments; ++s) {
            float u = (float)s / segments;
            float theta = u * 2.0f * PI;
            Vertex v;
            Vec3 n(std::sin(phi) * std::cos(theta), std::cos(phi), std::sin(phi) * std::sin(theta));
            v.pos = Vec3(n.x * radius, y, n.z * radius);
            v.normal = n;
            v.uv = Vec2(u, 1.0f - t);
            m.vertices.push_back(v);
        }
    }
    for (int r = 0; r < rings * 2; ++r)
        for (int s = 0; s < segments; ++s) {
            uint32_t a = (uint32_t)(r * (segments + 1) + s);
            uint32_t b = a + 1;
            uint32_t c = a + (uint32_t)(segments + 1);
            uint32_t d = c + 1;
            m.indices.push_back(a); m.indices.push_back(c); m.indices.push_back(b);
            m.indices.push_back(b); m.indices.push_back(c); m.indices.push_back(d);
        }
    m.addSubMesh(0, 0, (uint32_t)m.indices.size());
    m.computeBounds();
    return m;
}

Mesh torus(float major, float minor, int segsMajor, int segsMinor) {
    Mesh m;
    m.name = "Torus";
    for (int i = 0; i <= segsMajor; ++i) {
        float u = (float)i / segsMajor * 2.0f * PI;
        Vec3 center(std::cos(u) * major, 0, std::sin(u) * major);
        Vec3 dir(std::cos(u), 0, std::sin(u));
        for (int j = 0; j <= segsMinor; ++j) {
            float v = (float)j / segsMinor * 2.0f * PI;
            Vec3 n = dir * std::cos(v) + Vec3(0, 1, 0) * std::sin(v);
            Vertex vert;
            vert.pos = center + n * minor;
            vert.normal = n;
            vert.uv = Vec2((float)i / segsMajor, (float)j / segsMinor);
            m.vertices.push_back(vert);
        }
    }
    for (int i = 0; i < segsMajor; ++i)
        for (int j = 0; j < segsMinor; ++j) {
            uint32_t a = (uint32_t)(i * (segsMinor + 1) + j);
            uint32_t b = a + 1;
            uint32_t c = a + (uint32_t)(segsMinor + 1);
            uint32_t d = c + 1;
            m.indices.push_back(a); m.indices.push_back(c); m.indices.push_back(b);
            m.indices.push_back(b); m.indices.push_back(c); m.indices.push_back(d);
        }
    m.addSubMesh(0, 0, (uint32_t)m.indices.size());
    m.computeBounds();
    return m;
}

}  // namespace primitives
}  // namespace nf
