// NovaForge Engine - FBX importer (static meshes)
//
// Scope (V1): binary FBX 7.x and ASCII FBX, polygonal geometry with normals,
// UVs and per-polygon material assignment. Skinning and FBX animation are
// *not* imported - use glTF/GLB for animated and skinned characters. When an
// unsupported feature is detected the importer reports it explicitly instead
// of silently producing a wrong result.
#include "assets/import.h"

#include "assets/material.h"
#include "assets/mesh.h"
#include "assets/model.h"
#include "core/fs.h"
#include "core/guid.h"
#include "core/log.h"

#include "miniz.h"

#include <cctype>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <vector>

namespace nf {
namespace {

// ------------------------------------------------------------ binary reader
struct BinReader {
    const uint8_t* data = nullptr;
    size_t size = 0, pos = 0;
    bool ok = true;

    uint8_t u8() {
        if (pos + 1 > size) { ok = false; return 0; }
        return data[pos++];
    }
    uint32_t u32() {
        if (pos + 4 > size) { ok = false; return 0; }
        uint32_t v;
        memcpy(&v, data + pos, 4);
        pos += 4;
        return v;
    }
    uint64_t u64() {
        if (pos + 8 > size) { ok = false; return 0; }
        uint64_t v;
        memcpy(&v, data + pos, 8);
        pos += 8;
        return v;
    }
    std::string str(size_t n) {
        if (pos + n > size) { ok = false; return {}; }
        std::string s((const char*)data + pos, n);
        pos += n;
        return s;
    }
    void skip(size_t n) {
        pos += n;
        if (pos > size) { pos = size; ok = false; }
    }
};

struct FbxProp {
    enum class Type { Int32, Int64, Float, Double, String, Raw, IntArray, DoubleArray } type;
    int64_t i = 0;
    double d = 0;
    std::string s;
    std::vector<int32_t> ints;
    std::vector<double> doubles;
};

struct FbxNode {
    std::string name;
    std::vector<FbxProp> props;
    std::vector<FbxNode> children;

    const FbxNode* find(const std::string& n) const {
        for (auto& c : children)
            if (c.name == n) return &c;
        return nullptr;
    }
    std::vector<const FbxNode*> findAll(const std::string& n) const {
        std::vector<const FbxNode*> out;
        for (auto& c : children)
            if (c.name == n) out.push_back(&c);
        return out;
    }
    double num(size_t idx, double def = 0) const {
        if (idx >= props.size()) return def;
        const FbxProp& p = props[idx];
        switch (p.type) {
            case FbxProp::Type::Int32:
            case FbxProp::Type::Int64: return (double)p.i;
            case FbxProp::Type::Float:
            case FbxProp::Type::Double: return p.d;
            default: return def;
        }
    }
    std::string text(size_t idx, const std::string& def = "") const {
        if (idx >= props.size()) return def;
        return props[idx].type == FbxProp::Type::String ? props[idx].s : def;
    }
};

bool inflateZlib(const uint8_t* src, size_t srcLen, std::vector<uint8_t>& out, size_t expected) {
    out.resize(expected);
    size_t outLen = 0;
    void* res = tinfl_decompress_mem_to_heap(src, srcLen, &outLen, TINFL_FLAG_PARSE_ZLIB_HEADER);
    if (!res) return false;
    if (outLen != expected) {
        mz_free(res);
        return false;
    }
    memcpy(out.data(), res, outLen);
    mz_free(res);
    return true;
}

bool readArray(BinReader& r, char elemType, FbxProp& prop) {
    uint32_t len = r.u32();
    uint32_t encoding = r.u32();
    uint32_t compLen = r.u32();
    if (!r.ok) return false;
    size_t elemSize = (elemType == 'd' || elemType == 'l') ? 8 : 4;
    if (len > 200000000u) {
        r.ok = false;
        return false;
    }
    std::vector<uint8_t> raw;
    if (encoding == 0) {
        if (r.pos + (size_t)len * elemSize > r.size) return false;
        raw.assign(r.data + r.pos, r.data + r.pos + (size_t)len * elemSize);
        r.pos += (size_t)len * elemSize;
    } else {
        const uint8_t* src = r.data + r.pos;
        if (r.pos + compLen > r.size) return false;
        if (!inflateZlib(src, compLen, raw, (size_t)len * elemSize)) {
            NF_LOG_ERROR("Import", "FBX: failed to inflate a compressed array");
            r.ok = false;
            return false;
        }
        r.pos += compLen;
    }
    if (elemType == 'd') {
        prop.type = FbxProp::Type::DoubleArray;
        prop.doubles.resize(len);
        memcpy(prop.doubles.data(), raw.data(), (size_t)len * 8);
    } else if (elemType == 'i') {
        prop.type = FbxProp::Type::IntArray;
        prop.ints.resize(len);
        memcpy(prop.ints.data(), raw.data(), (size_t)len * 4);
    } else if (elemType == 'f') {
        prop.type = FbxProp::Type::DoubleArray;
        prop.doubles.resize(len);
        const float* f = (const float*)raw.data();
        for (size_t i = 0; i < len; ++i) prop.doubles[i] = f[i];
    } else {  // 'l'
        prop.type = FbxProp::Type::IntArray;
        prop.ints.resize(len);
        const int64_t* l = (const int64_t*)raw.data();
        for (size_t i = 0; i < len; ++i) prop.ints[i] = (int32_t)l[i];
    }
    return true;
}

bool readProperty(BinReader& r, FbxProp& prop) {
    char t = (char)r.u8();
    if (!r.ok) return false;
    switch (t) {
        case 'Y': { int16_t v; if (r.pos + 2 > r.size) return false; memcpy(&v, r.data + r.pos, 2); r.pos += 2;
                    prop.type = FbxProp::Type::Int32; prop.i = v; return true; }
        case 'C': prop.type = FbxProp::Type::Int32; prop.i = r.u8(); return r.ok;
        case 'I': prop.type = FbxProp::Type::Int32; prop.i = (int32_t)r.u32(); return r.ok;
        case 'L': prop.type = FbxProp::Type::Int64; prop.i = (int64_t)r.u64(); return r.ok;
        case 'F': { prop.type = FbxProp::Type::Float; uint32_t v = r.u32(); float f; memcpy(&f, &v, 4); prop.d = f; return r.ok; }
        case 'D': { prop.type = FbxProp::Type::Double; uint64_t v = r.u64(); memcpy(&prop.d, &v, 8); return r.ok; }
        case 'S': case 'R': {
            uint32_t len = r.u32();
            if (!r.ok || len > r.size) return false;
            prop.type = FbxProp::Type::String;
            prop.s = r.str(len);
            return r.ok;
        }
        case 'f': case 'd': case 'l': case 'i':
            return readArray(r, t, prop);
        default:
            NF_LOG_ERROR("Import", "FBX: unknown property type '%c' (0x%02x)", t, (unsigned char)t);
            return false;
    }
}

bool readNode(BinReader& r, FbxNode& node, uint32_t version) {
    bool wide = version >= 7500;
    uint64_t endOffset = wide ? r.u64() : r.u32();
    uint64_t numProps = wide ? r.u64() : r.u32();
    uint64_t propListLen = wide ? r.u64() : r.u32();
    uint8_t nameLen = r.u8();
    if (!r.ok) return false;
    if (endOffset == 0 && numProps == 0 && propListLen == 0 && nameLen == 0) return false;  // null record
    node.name = r.str(nameLen);
    for (uint64_t i = 0; i < numProps; ++i) {
        FbxProp p;
        if (!readProperty(r, p)) return false;
        node.props.push_back(std::move(p));
    }
    if (endOffset == 0 || endOffset > r.size) return false;
    while (r.pos < endOffset && r.ok) {
        FbxNode child;
        size_t before = r.pos;
        if (!readNode(r, child, version)) break;
        if (r.pos <= before) break;
        node.children.push_back(std::move(child));
    }
    r.pos = (size_t)endOffset;
    return true;
}

// ------------------------------------------------------------ ASCII reader
std::vector<double> parseNumberList(const std::string& body) {
    std::vector<double> out;
    const char* p = body.c_str();
    while (*p) {
        while (*p && !isdigit((unsigned char)*p) && *p != '-' && *p != '+') ++p;
        if (!*p) break;
        char* end = nullptr;
        double v = strtod(p, &end);
        if (end == p) { ++p; continue; }
        out.push_back(v);
        p = end;
    }
    return out;
}

struct AsciiFbx {
    std::string text;
    // returns the body (between the first '{' after `key` and the matching '}')
    std::string block(const std::string& key, size_t from = 0) const {
        size_t pos = text.find(key, from);
        if (pos == std::string::npos) return {};
        size_t open = text.find('{', pos);
        if (open == std::string::npos) return {};
        int depth = 0;
        for (size_t i = open; i < text.size(); ++i) {
            if (text[i] == '{') depth++;
            else if (text[i] == '}') {
                depth--;
                if (depth == 0) return text.substr(open + 1, i - open - 1);
            }
        }
        return {};
    }
    std::vector<double> numbers(const std::string& key, size_t from = 0) const {
        std::string b = block(key, from);
        return parseNumberList(b);
    }
};

struct RawGeometry {
    std::vector<double> verts;       // 3 per vertex
    std::vector<int32_t> polyIndices; // negative-last-index encoding
    std::vector<double> normals;
    std::vector<int32_t> normalIndex;
    std::vector<double> uvs;
    std::vector<int32_t> uvIndex;
    std::vector<int32_t> materials;  // per polygon
    std::string name;
};

bool buildMeshFromRaw(const RawGeometry& raw, float scale, Vec3 axisSign, Mesh& mesh,
                      std::vector<std::string>& warnings) {
    size_t vertexCount = raw.verts.size() / 3;
    if (vertexCount == 0 || raw.polyIndices.empty()) return false;
    bool hasNormals = raw.normals.size() / 3 >= vertexCount && !raw.normals.empty();
    bool hasUv = raw.uvs.size() / 2 > 0;
    bool perPolyUv = raw.uvIndex.size() == raw.polyIndices.size();
    bool perPolyNormal = raw.normalIndex.size() == raw.polyIndices.size();

    auto convert = [&](double x, double y, double z) {
        // FBX is Z-up right handed; Y-up left->right handed conversion
        return Vec3((float)x * axisSign.x * scale, (float)z * axisSign.y * scale,
                    (float)-y * axisSign.z * scale);
    };

    std::vector<Mesh> materialMeshes;
    auto meshForMaterial = [&](int matIndex) -> Mesh& {
        while ((int)materialMeshes.size() <= matIndex) materialMeshes.push_back(Mesh());
        return materialMeshes[matIndex];
    };

    size_t triangles = 0;
    std::vector<uint32_t> poly;
    for (size_t i = 0; i < raw.polyIndices.size(); ++i) {
        int32_t idx = raw.polyIndices[i];
        bool last = idx < 0;
        uint32_t vertexIndex = (uint32_t)(last ? (~idx) : idx);
        poly.push_back(vertexIndex);
        if (!last) continue;
        if (poly.size() >= 3) {
            int matIndex = 0;
            if (!raw.materials.empty()) {
                size_t polyIndex = 0;
                for (size_t k = 0; k <= i; ++k)
                    if (raw.polyIndices[k] < 0) polyIndex++;
                polyIndex = polyIndex > 0 ? polyIndex - 1 : 0;
                if (polyIndex < raw.materials.size()) matIndex = raw.materials[polyIndex];
                if (matIndex < 0) matIndex = 0;
            }
            Mesh& target = meshForMaterial(matIndex);
            for (size_t t = 2; t < poly.size(); ++t) {
                size_t tri[3] = {0, t - 1, t};
                for (int k = 0; k < 3; ++k) {
                    uint32_t vi = poly[tri[k]];
                    if (vi * 3 + 2 >= raw.verts.size()) continue;
                    Vertex v;
                    v.pos = convert(raw.verts[vi * 3], raw.verts[vi * 3 + 1], raw.verts[vi * 3 + 2]);
                    size_t flat = 0;
                    for (size_t q = 0; q <= i; ++q)
                        if (q == i || raw.polyIndices[q] < 0) {
                            if (raw.polyIndices[q] < 0) {
                                flat = q;
                                break;
                            }
                        }
                    (void)flat;
                    if (perPolyNormal) {
                        int32_t ni = raw.normalIndex[i];
                        if (ni >= 0 && (size_t)ni * 3 + 2 < raw.normals.size()) {
                            Vec3 n((float)raw.normals[ni * 3], (float)raw.normals[ni * 3 + 1],
                                   (float)raw.normals[ni * 3 + 2]);
                            v.normal = Vec3(n.x * axisSign.x, n.z * axisSign.y, -n.y * axisSign.z)
                                           .normalized();
                        }
                    } else if (hasNormals && vi * 3 + 2 < raw.normals.size()) {
                        Vec3 n((float)raw.normals[vi * 3], (float)raw.normals[vi * 3 + 1],
                               (float)raw.normals[vi * 3 + 2]);
                        v.normal = Vec3(n.x * axisSign.x, n.z * axisSign.y, -n.y * axisSign.z)
                                       .normalized();
                    }
                    if (perPolyUv) {
                        int32_t ui = raw.uvIndex[i];
                        if (ui >= 0 && (size_t)ui * 2 + 1 < raw.uvs.size())
                            v.uv = Vec2((float)raw.uvs[ui * 2], 1.0f - (float)raw.uvs[ui * 2 + 1]);
                    } else if (hasUv && vi * 2 + 1 < raw.uvs.size()) {
                        v.uv = Vec2((float)raw.uvs[vi * 2], 1.0f - (float)raw.uvs[vi * 2 + 1]);
                    }
                    target.indices.push_back((uint32_t)target.vertices.size());
                    target.vertices.push_back(v);
                }
                triangles++;
            }
        }
        poly.clear();
    }
    if (triangles == 0) return false;

    mesh = Mesh();
    mesh.name = raw.name.empty() ? "FBXMesh" : raw.name;
    for (Mesh& m : materialMeshes) {
        if (m.indices.empty()) continue;
        m.computeNormals();
        uint32_t base = (uint32_t)mesh.vertices.size();
        for (auto& v : m.vertices) mesh.vertices.push_back(v);
        uint32_t first = (uint32_t)mesh.indices.size();
        for (uint32_t idx : m.indices) mesh.indices.push_back(idx + base);
        if (mesh.vertices.empty()) continue;
        int matIndex = (int)(&m - materialMeshes.data());
        mesh.addSubMesh(matIndex, first, (uint32_t)m.indices.size());
    }
    if (mesh.submeshes.empty()) mesh.addSubMesh(0, 0, (uint32_t)mesh.indices.size());
    mesh.computeBounds();
    if (triangles > 0 && !warnings.empty()) (void)triangles;
    return true;
}

}  // namespace

ImportResult importFbx(const std::string& sourceFile, const ImportOptions& opts) {
    fs::Bytes bytes = fs::readBinary(sourceFile);
    if (bytes.empty())
        return ImportResult::failure("Unable to import '" + fs::filename(sourceFile) +
                                     "'\n  Reason: file is empty or unreadable");

    std::vector<std::string> created, warnings;
    const std::string base = opts.nameOverride.empty() ? fs::stem(sourceFile) : opts.nameOverride;
    RawGeometry raw;
    float unitScale = 0.01f;   // FBX default unit is centimetres
    bool isBinary = false;
    FbxNode root;

    if (bytes.size() > 27 && memcmp(bytes.data(), "Kaydara FBX Binary", 18) == 0) {
        isBinary = true;
        BinReader r{bytes.data(), bytes.size(), 23};
        uint32_t version = r.u32();
        if (version < 7000) {
            return ImportResult::failure(
                "Unable to import '" + fs::filename(sourceFile) +
                "'\n  Reason: FBX binary version 6.x and older is not supported (export as FBX 7.x "
                "binary or ASCII, or use glTF/GLB)");
        }
        while (r.ok && r.pos + 30 < r.size) {
            FbxNode node;
            size_t before = r.pos;
            if (!readNode(r, node, version)) break;
            if (r.pos <= before) break;
            root.children.push_back(std::move(node));
        }
        if (!r.ok && root.children.empty()) {
            return ImportResult::failure("Unable to import '" + fs::filename(sourceFile) +
                                         "'\n  Reason: malformed FBX binary structure");
        }
        // Global settings -> unit scale
        if (const FbxNode* settings = root.find("GlobalSettings")) {
            if (const FbxNode* props = settings->find("Properties70")) {
                for (const FbxNode* p : props->findAll("P")) {
                    if (p->text(0) == "UnitScaleFactor") unitScale = (float)p->num(4, 1.0) * 0.01f;
                }
            }
        }
        for (const FbxNode* obj : root.findAll("Objects")) {
            for (const FbxNode* geo : obj->findAll("Geometry")) {
                std::string name = geo->text(1);
                size_t sep = name.find("::");
                if (sep != std::string::npos) name = name.substr(sep + 2);
                if (const FbxNode* v = geo->find("Vertices")) {
                    if (!v->props.empty() && v->props[0].type == FbxProp::Type::DoubleArray)
                        raw.verts = v->props[0].doubles;
                }
                if (const FbxNode* pi = geo->find("PolygonVertexIndex")) {
                    if (!pi->props.empty() && pi->props[0].type == FbxProp::Type::IntArray)
                        for (int32_t i : pi->props[0].ints) raw.polyIndices.push_back(i);
                }
                if (const FbxNode* le = geo->find("LayerElementNormal")) {
                    if (const FbxNode* n = le->find("Normals")) {
                        if (!n->props.empty() && n->props[0].type == FbxProp::Type::DoubleArray)
                            raw.normals = n->props[0].doubles;
                    }
                    if (const FbxNode* ni = le->find("NormalsIndex")) {
                        if (!ni->props.empty() && ni->props[0].type == FbxProp::Type::IntArray)
                            raw.normalIndex = ni->props[0].ints;
                    }
                }
                if (const FbxNode* le = geo->find("LayerElementUV")) {
                    if (const FbxNode* uv = le->find("UV")) {
                        if (!uv->props.empty() && uv->props[0].type == FbxProp::Type::DoubleArray)
                            raw.uvs = uv->props[0].doubles;
                    }
                    if (const FbxNode* ui = le->find("UVIndex")) {
                        if (!ui->props.empty() && ui->props[0].type == FbxProp::Type::IntArray)
                            raw.uvIndex = ui->props[0].ints;
                    }
                }
                if (const FbxNode* le = geo->find("LayerElementMaterial")) {
                    if (const FbxNode* m = le->find("Materials")) {
                        if (!m->props.empty() && m->props[0].type == FbxProp::Type::IntArray)
                            raw.materials = m->props[0].ints;
                    }
                }
                raw.name = name;
                break;  // V1: first geometry object
            }
        }
    } else {
        // ---- ASCII
        std::string text((const char*)bytes.data(), bytes.size());
        if (text.find("FBXHeaderExtension") == std::string::npos &&
            text.find("Objects:") == std::string::npos) {
            return ImportResult::failure(
                "Unable to import '" + fs::filename(sourceFile) +
                "'\n  Reason: not recognised as FBX (expected binary 'Kaydara FBX Binary' header or "
                "ASCII FBX text)");
        }
        AsciiFbx ascii{text};
        size_t geoPos = text.find("Geometry:");
        if (geoPos == std::string::npos) {
            return ImportResult::failure("Unable to import '" + fs::filename(sourceFile) +
                                         "'\n  Reason: FBX file contains no Geometry objects");
        }
        size_t nameStart = text.find('"', geoPos);
        if (nameStart != std::string::npos) {
            size_t nameEnd = text.find('"', nameStart + 1);
            std::string n = text.substr(nameStart + 1, nameEnd - nameStart - 1);
            size_t sep = n.find("::");
            raw.name = sep != std::string::npos ? n.substr(sep + 2) : n;
        }
        raw.verts = ascii.numbers("Vertices:", geoPos);
        raw.normals = ascii.numbers("Normals:", geoPos);
        raw.uvs = ascii.numbers("UV:", geoPos);
        raw.uvIndex.clear();
        raw.normalIndex.clear();
        std::vector<double> pi = ascii.numbers("PolygonVertexIndex:", geoPos);
        for (double d : pi) raw.polyIndices.push_back((int32_t)d);
        std::vector<double> mi = ascii.numbers("Materials:", geoPos);
        for (double d : mi) raw.materials.push_back((int32_t)d);
        std::vector<double> uvi = ascii.numbers("UVIndex:", geoPos);
        for (double d : uvi) raw.uvIndex.push_back((int32_t)d);
        std::vector<double> nri = ascii.numbers("NormalsIndex:", geoPos);
        for (double d : nri) raw.normalIndex.push_back((int32_t)d);
        size_t usPos = text.find("UnitScaleFactor");
        if (usPos != std::string::npos) {
            size_t colon = text.find(':', usPos);
            if (colon != std::string::npos)
                unitScale = (float)strtod(text.c_str() + colon + 1, nullptr) * 0.01f;
        }
    }

    if (raw.verts.empty() || raw.polyIndices.empty()) {
        return ImportResult::failure(
            "Unable to import '" + fs::filename(sourceFile) +
            "'\n  Reason: no polygon geometry found (NULL geometry, or the mesh is stored in a "
            "format variant this V1 importer does not read)");
    }
    Vec3 axisSign(1, 1, 1);
    Mesh mesh;
    if (!buildMeshFromRaw(raw, unitScale * opts.scale, axisSign, mesh, warnings)) {
        return ImportResult::failure("Unable to import '" + fs::filename(sourceFile) +
                                     "'\n  Reason: geometry present but no triangles could be "
                                     "assembled");
    }

    // materials (FBX material import is limited to neutral defaults in V1)
    size_t matCount = std::max<size_t>(1, mesh.submeshes.size());
    std::vector<std::string> materialPaths;
    for (size_t i = 0; i < matCount; ++i) {
        Material m = Material::colored("FBX_Material_" + std::to_string(i),
                                       Vec3(0.8f, 0.8f, 0.82f));
        m.id = generateGuid();
        m.roughness = 0.6f;
        std::string rel = opts.materialsFolder + "/" + base + "_mat" + std::to_string(i) +
                          ".nfmat.json";
        m.save(fs::join(opts.projectRoot, rel));
        created.push_back(rel);
        materialPaths.push_back(rel);
    }
    warnings.push_back(
        "FBX import in V1 covers static geometry (normals + UVs); FBX materials, skinning and FBX "
        "animations are not imported - use glTF/GLB for animated characters");

    std::string relMesh = opts.meshesFolder + "/" + base + ".nfmesh";
    if (!mesh.save(fs::join(opts.projectRoot, relMesh)))
        return ImportResult::failure("failed to write mesh file " + relMesh);
    created.push_back(relMesh);

    Model model;
    model.name = base;
    ModelNode rootNode;
    rootNode.name = base;
    model.nodes.push_back(rootNode);
    ModelPart part;
    part.name = raw.name.empty() ? base : raw.name;
    part.mesh = std::make_shared<Mesh>(std::move(mesh));
    part.meshPath = relMesh;
    part.node = 0;
    part.materialPath = materialPaths.empty() ? "" : materialPaths[0];
    part.subMaterialPaths = materialPaths;
    model.parts.push_back(std::move(part));
    model.computeBounds();

    std::string relModel = opts.modelsFolder + "/" + base + ".nfmodel.json";
    if (!model.save(fs::join(opts.projectRoot, relModel), opts.projectRoot))
        return ImportResult::failure("failed to write model file " + relModel);
    created.push_back(relModel);

    ImportResult result;
    result.ok = true;
    result.modelPath = relModel;
    result.assetPath = relModel;
    result.assetType = "Model";
    result.createdFiles = created;
    result.warnings = warnings;
    result.triangleCount = model.triangleCount();
    result.partCount = 1;
    result.message = std::string("Imported ") + (isBinary ? "binary" : "ASCII") + " FBX '" +
                     fs::filename(sourceFile) + "': " + std::to_string(result.triangleCount) +
                     " triangles";
    NF_LOG_INFO("Import", "%s", result.message.c_str());
    for (auto& w : result.warnings) NF_LOG_WARN("Import", "  %s", w.c_str());
    return result;
}

}  // namespace nf
