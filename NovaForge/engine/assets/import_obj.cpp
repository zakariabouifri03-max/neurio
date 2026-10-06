// NovaForge Engine - Wavefront OBJ (+MTL) importer
#include "assets/import.h"

#include "assets/material.h"
#include "assets/mesh.h"
#include "assets/model.h"
#include "core/fs.h"
#include "core/guid.h"
#include "core/log.h"

#include <cctype>
#include <cstdlib>
#include <map>
#include <sstream>
#include <unordered_map>

namespace nf {
namespace {

struct ObjIndex {
    int v = -1, vt = -1, vn = -1;
    bool operator<(const ObjIndex& o) const {
        if (v != o.v) return v < o.v;
        if (vt != o.vt) return vt < o.vt;
        return vn < o.vn;
    }
};

std::string sanitize(const std::string& in) {
    std::string out;
    for (char c : in) {
        if (isalnum((unsigned char)c) || c == '_' || c == '-') out.push_back(c);
        else if (c == ' ' || c == '.' || c == '/') out.push_back('_');
    }
    return out.empty() ? "obj" : out;
}

// Very small MTL reader: diffuse/specular colours, shininess, opacity, diffuse map.
struct MtlEntry {
    Vec3 diffuse{0.8f, 0.8f, 0.8f};
    Vec3 specular{0.0f, 0.0f, 0.0f};
    Vec3 emissive{0, 0, 0};
    float shininess = 32.0f;
    float opacity = 1.0f;
    std::string diffuseMap;
};

void parseMtl(const std::string& path, std::map<std::string, MtlEntry>& out) {
    std::string text = fs::readText(path);
    if (text.empty()) return;
    std::istringstream in(text);
    std::string line, current;
    while (std::getline(in, line)) {
        if (line.empty() || line[0] == '#') continue;
        std::istringstream ls(line);
        std::string key;
        ls >> key;
        if (key == "newmtl") {
            ls >> current;
        } else if (key == "Kd" && !current.empty()) {
            ls >> out[current].diffuse.x >> out[current].diffuse.y >> out[current].diffuse.z;
        } else if (key == "Ks" && !current.empty()) {
            ls >> out[current].specular.x >> out[current].specular.y >> out[current].specular.z;
        } else if (key == "Ke" && !current.empty()) {
            ls >> out[current].emissive.x >> out[current].emissive.y >> out[current].emissive.z;
        } else if (key == "Ns" && !current.empty()) {
            ls >> out[current].shininess;
        } else if (key == "d" && !current.empty()) {
            ls >> out[current].opacity;
        } else if (key == "Tr" && !current.empty()) {
            float tr = 0;
            ls >> tr;
            out[current].opacity = 1.0f - tr;
        } else if (key == "map_Kd" && !current.empty()) {
            std::string rest;
            std::getline(ls, rest);
            while (!rest.empty() && (rest[0] == ' ' || rest[0] == '\t')) rest.erase(rest.begin());
            out[current].diffuseMap = rest;
        }
    }
}

}  // namespace

ImportResult importObj(const std::string& sourceFile, const ImportOptions& opts) {
    std::string text = fs::readText(sourceFile);
    if (text.empty())
        return ImportResult::failure("Unable to import '" + fs::filename(sourceFile) +
                                     "'\n  Reason: file is empty or unreadable");
    ImportResult result;
    const std::string base = sanitize(opts.nameOverride.empty() ? fs::stem(sourceFile)
                                                                : opts.nameOverride);
    const std::string srcDir = fs::parent(sourceFile);

    std::vector<Vec3> positions, normals;
    std::vector<Vec2> uvs;
    std::map<std::string, MtlEntry> mtlLib;
    std::string currentMaterial;

    Mesh mesh;
    mesh.name = base;
    struct Group {
        int materialIndex;
        std::vector<uint32_t> indices;
    };
    std::vector<Group> groups;
    std::map<std::string, int> materialToGroup;
    std::map<std::string, std::string> materialAssetPath;
    std::unordered_map<std::string, uint32_t> vertexCache;
    std::vector<std::string> created;
    std::vector<std::string> warnings;

    auto groupFor = [&](const std::string& matName) -> Group& {
        auto it = materialToGroup.find(matName);
        if (it != materialToGroup.end()) return groups[it->second];
        int idx = (int)groups.size();
        materialToGroup[matName] = idx;
        groups.push_back(Group{idx, {}});
        return groups.back();
    };

    std::istringstream in(text);
    std::string line;
    int lineNo = 0;
    size_t faceCount = 0;
    while (std::getline(in, line)) {
        lineNo++;
        if (line.empty() || line[0] == '#') continue;
        std::istringstream ls(line);
        std::string key;
        ls >> key;
        if (key == "v") {
            Vec3 p;
            ls >> p.x >> p.y >> p.z;
            positions.push_back(p);
        } else if (key == "vn") {
            Vec3 n;
            ls >> n.x >> n.y >> n.z;
            normals.push_back(n);
        } else if (key == "vt") {
            Vec2 t;
            ls >> t.x >> t.y;
            uvs.push_back(t);
        } else if (key == "mtllib") {
            std::string lib;
            std::getline(ls, lib);
            while (!lib.empty() && (lib[0] == ' ' || lib[0] == '\t')) lib.erase(lib.begin());
            parseMtl(fs::join(srcDir, lib), mtlLib);
        } else if (key == "usemtl") {
            ls >> currentMaterial;
        } else if (key == "f") {
            std::vector<ObjIndex> face;
            std::string token;
            while (ls >> token) {
                ObjIndex idx;
                size_t s1 = token.find('/');
                if (s1 == std::string::npos) {
                    idx.v = atoi(token.c_str());
                } else {
                    idx.v = atoi(token.substr(0, s1).c_str());
                    size_t s2 = token.find('/', s1 + 1);
                    if (s2 == std::string::npos) {
                        idx.vt = atoi(token.substr(s1 + 1).c_str());
                    } else {
                        if (s2 > s1 + 1) idx.vt = atoi(token.substr(s1 + 1, s2 - s1 - 1).c_str());
                        if (s2 + 1 < token.size()) idx.vn = atoi(token.substr(s2 + 1).c_str());
                    }
                }
                face.push_back(idx);
            }
            if (face.size() < 3) continue;
            // fan triangulation (handles quads and n-gons)
            for (size_t i = 2; i < face.size(); ++i) {
                size_t tri[3] = {0, i - 1, i};
                Group& g = groupFor(currentMaterial);
                for (int k = 0; k < 3; ++k) {
                    const ObjIndex& oi = face[tri[k]];
                    auto resolve = [&](int idx, size_t count) -> int {
                        if (idx > 0) return idx - 1;
                        if (idx < 0) return (int)count + idx;
                        return -1;
                    };
                    int vi = resolve(oi.v, positions.size());
                    if (vi < 0 || vi >= (int)positions.size()) {
                        vi = 0;
                    }
                    int ti = resolve(oi.vt, uvs.size());
                    int ni = resolve(oi.vn, normals.size());
                    std::string key2 = std::to_string(vi) + "/" + std::to_string(ti) + "/" +
                                       std::to_string(ni);
                    auto cacheIt = vertexCache.find(key2);
                    if (cacheIt == vertexCache.end()) {
                        Vertex vert;
                        vert.pos = positions[vi] * opts.scale;
                        if (ni >= 0 && ni < (int)normals.size()) vert.normal = normals[ni];
                        if (ti >= 0 && ti < (int)uvs.size())
                            vert.uv = Vec2(uvs[ti].x, 1.0f - uvs[ti].y);
                        uint32_t newIndex = (uint32_t)mesh.vertices.size();
                        mesh.vertices.push_back(vert);
                        vertexCache[key2] = newIndex;
                        g.indices.push_back(newIndex);
                    } else {
                        g.indices.push_back(cacheIt->second);
                    }
                }
                faceCount++;
            }
        }
    }

    if (mesh.vertices.empty())
        return ImportResult::failure("Unable to import '" + fs::filename(sourceFile) +
                                     "'\n  Reason: no 'f' (face) statements found - the file has "
                                     "no polygons");
    for (auto& g : groups) {
        uint32_t first = (uint32_t)mesh.indices.size();
        for (uint32_t idx : g.indices) mesh.indices.push_back(idx);
        mesh.addSubMesh(g.materialIndex, first, (uint32_t)g.indices.size());
    }
    if (mesh.submeshes.empty()) mesh.addSubMesh(0, 0, (uint32_t)mesh.indices.size());
    mesh.computeNormals();
    mesh.computeBounds();

    // materials: one .nfmat.json per OBJ material (or one default material)
    std::vector<std::string> materialPaths(mesh.submeshes.size());
    for (auto& kv : materialToGroup) {
        const std::string& name = kv.first;
        Material m;
        m.id = generateGuid();
        m.name = name.empty() ? (base + "_default") : name;
        auto mtlIt = mtlLib.find(name);
        if (mtlIt != mtlLib.end()) {
            const MtlEntry& e = mtlIt->second;
            m.baseColor = e.diffuse;
            m.roughness = clampf(1.0f - std::sqrt(clampf(e.shininess, 0.0f, 1000.0f) / 1000.0f), 0.05f, 1.0f);
            m.emissive = e.emissive;
            m.emissiveStrength = e.emissive.sqLength() > 0.0001f ? 1.0f : 0.0f;
            m.opacity = clampf(e.opacity, 0.0f, 1.0f);
            if (!e.diffuseMap.empty()) {
                std::string src = fs::join(srcDir, e.diffuseMap);
                if (fs::exists(src)) {
                    std::string rel = opts.texturesFolder + "/" + base + "_" +
                                      sanitize(fs::stem(e.diffuseMap)) + "." + fs::extension(src);
                    if (fs::copyFile(src, fs::join(opts.projectRoot, rel))) {
                        m.albedoTexture = rel;
                        created.push_back(rel);
                    } else {
                        warnings.push_back("could not copy texture '" + e.diffuseMap + "'");
                    }
                } else {
                    warnings.push_back("material '" + name + "' references missing texture '" +
                                       e.diffuseMap + "'");
                }
            }
        }
        std::string rel = opts.materialsFolder + "/" + base + "_" + sanitize(m.name) + ".nfmat.json";
        if (!m.save(fs::join(opts.projectRoot, rel))) {
            warnings.push_back("failed to write material " + rel);
            continue;
        }
        created.push_back(rel);
        materialPaths[kv.second] = rel;
    }
    if (materialPaths.empty()) materialPaths.push_back("");
    for (auto& mp : materialPaths)
        if (mp.empty()) mp = materialPaths[0];

    // write mesh + model
    std::string relMesh = opts.meshesFolder + "/" + base + ".nfmesh";
    if (!mesh.save(fs::join(opts.projectRoot, relMesh)))
        return ImportResult::failure("failed to write mesh file " + relMesh);
    created.push_back(relMesh);

    Model model;
    model.name = opts.nameOverride.empty() ? fs::stem(sourceFile) : opts.nameOverride;
    ModelNode root;
    root.name = model.name;
    model.nodes.push_back(root);
    ModelPart part;
    part.name = base;
    part.mesh = std::make_shared<Mesh>(std::move(mesh));
    part.meshPath = relMesh;
    part.node = 0;
    part.materialPath = materialPaths[0];
    part.subMaterialPaths = materialPaths;
    model.parts.push_back(std::move(part));
    model.computeBounds();

    std::string relModel = opts.modelsFolder + "/" + base + ".nfmodel.json";
    if (!model.save(fs::join(opts.projectRoot, relModel), opts.projectRoot))
        return ImportResult::failure("failed to write model file " + relModel);
    created.push_back(relModel);

    result.ok = true;
    result.modelPath = relModel;
    result.assetPath = relModel;
    result.assetType = "Model";
    result.createdFiles = created;
    result.warnings = warnings;
    result.triangleCount = model.triangleCount();
    result.partCount = 1;
    result.animationCount = 0;
    result.message = "Imported OBJ '" + fs::filename(sourceFile) + "': " +
                     std::to_string(result.triangleCount) + " triangles, " +
                     std::to_string(positions.size()) + " vertices, " +
                     std::to_string(materialPaths.size()) + " material(s)" +
                     (uvs.empty() ? " (no UVs found)" : "");
    NF_LOG_INFO("Import", "%s", result.message.c_str());
    for (auto& w : result.warnings) NF_LOG_WARN("Import", "  %s", w.c_str());
    return result;
}

}  // namespace nf
