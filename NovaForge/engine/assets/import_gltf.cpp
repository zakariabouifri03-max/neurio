// NovaForge Engine - glTF 2.0 / GLB importer
//
// Converts a glTF scene into engine native assets:
//   *.nfmesh         one binary mesh per glTF mesh (sub-meshes = primitives)
//   *.nfmat.json     one editable material per glTF material
//   *.png            embedded/external images decoded and re-encoded as PNG
//   *.nfmodel.json   node hierarchy, skins and animation clips
#include "assets/import.h"

#include "assets/material.h"
#include "assets/mesh.h"
#include "assets/model.h"
#include "core/fs.h"
#include "core/guid.h"
#include "core/image.h"
#include "core/json.h"
#include "core/log.h"

#include <cctype>
#include <cstring>
#include <map>

namespace nf {

namespace {

struct GltfContext {
    Json gltf;
    std::vector<std::vector<uint8_t>> buffers;
    std::string sourceDir;
    ImportOptions opts;
    std::string baseName;
    std::vector<std::string> warnings;
    std::vector<std::string> created;
    std::map<int, std::string> imageToPath;      // image index -> project relative png
    std::map<int, std::string> textureToPath;    // texture index -> project relative png
    std::map<int, std::string> materialToPath;   // material index -> project relative nfmat
};

bool hasAnyNormal(const Mesh& m) {
    for (const Vertex& v : m.vertices)
        if (v.normal.sqLength() > 0.0001f) return true;
    return false;
}

bool meshIsSkinned(const Model& m) {
    for (const ModelPart& p : m.parts)
        if (p.mesh && p.mesh->skinned) return true;
    return false;
}

std::string sanitizeName(const std::string& in) {
    std::string out;
    for (char c : in) {
        if (isalnum((unsigned char)c) || c == '_' || c == '-') out.push_back(c);
        else if (c == ' ' || c == '.' || c == '/') out.push_back('_');
    }
    while (!out.empty() && out.front() == '_') out.erase(out.begin());
    while (!out.empty() && out.back() == '_') out.pop_back();
    if (out.empty()) out = "asset";
    if (out.size() > 48) out.resize(48);
    return out;
}

bool loadGltfFile(const std::string& path, GltfContext& ctx, std::string& error) {
    fs::Bytes bytes = fs::readBinary(path);
    if (bytes.size() < 12) {
        error = "file is empty or too small to be a glTF/GLB file";
        return false;
    }
    std::string jsonText;
    std::vector<uint8_t> binChunk;
    if (memcmp(bytes.data(), "glTF", 4) == 0) {
        uint32_t version = 0, total = 0;
        memcpy(&version, bytes.data() + 4, 4);
        memcpy(&total, bytes.data() + 8, 4);
        if (version != 2) {
            error = "unsupported GLB version " + std::to_string(version) + " (only glTF 2.0)";
            return false;
        }
        size_t off = 12;
        while (off + 8 <= bytes.size()) {
            uint32_t clen = 0, ctype = 0;
            memcpy(&clen, bytes.data() + off, 4);
            memcpy(&ctype, bytes.data() + off + 4, 4);
            off += 8;
            if (off + clen > bytes.size()) {
                error = "GLB chunk is truncated";
                return false;
            }
            if (ctype == 0x4E4F534A) {  // 'JSON'
                jsonText.assign((const char*)bytes.data() + off, clen);
            } else if (ctype == 0x004E4942) {  // 'BIN'
                binChunk.assign(bytes.begin() + off, bytes.begin() + off + clen);
            }
            off += clen;
        }
        if (jsonText.empty()) {
            error = "GLB has no JSON chunk";
            return false;
        }
    } else {
        jsonText.assign((const char*)bytes.data(), bytes.size());
    }

    std::string parseErr;
    ctx.gltf = Json::parse(jsonText, &parseErr);
    if (!parseErr.empty()) {
        error = "invalid glTF JSON: " + parseErr;
        return false;
    }
    if (!ctx.gltf.has("asset")) {
        error = "not a glTF document (missing 'asset' block)";
        return false;
    }
    std::string version = ctx.gltf["asset"]["version"].asString("2.0");
    if (version.rfind("2.", 0) != 0)
        ctx.warnings.push_back("glTF asset version is " + version + ", importing as 2.0");

    // Buffers: index 0 comes from the GLB binary chunk when it has no URI.
    const Json& buffers = ctx.gltf["buffers"];
    for (size_t i = 0; i < buffers.size(); ++i) {
        const Json& b = buffers[i];
        std::string uri = b["uri"].asString("");
        std::vector<uint8_t> data;
        if (uri.empty() && i == 0 && !binChunk.empty()) {
            data = binChunk;
        } else if (uri.rfind("data:", 0) == 0) {
            size_t comma = uri.find(',');
            if (comma == std::string::npos) {
                error = "malformed data URI in buffer " + std::to_string(i);
                return false;
            }
            data = fs::base64Decode(uri.substr(comma + 1));
        } else if (!uri.empty()) {
            std::string decoded = uri;
            // percent decoding of the file name
            std::string clean;
            for (size_t k = 0; k < decoded.size(); ++k) {
                if (decoded[k] == '%' && k + 2 < decoded.size()) {
                    int v = (int)strtol(decoded.substr(k + 1, 2).c_str(), nullptr, 16);
                    clean.push_back((char)v);
                    k += 2;
                } else {
                    clean.push_back(decoded[k]);
                }
            }
            std::string full = fs::join(ctx.sourceDir, clean);
            data = fs::readBinary(full);
            if (data.empty()) {
                error = "external buffer '" + clean + "' is missing";
                return false;
            }
        }
        ctx.buffers.push_back(std::move(data));
    }
    return true;
}

size_t componentSize(int componentType) {
    switch (componentType) {
        case 5120: case 5121: return 1;  // byte / ubyte
        case 5122: case 5123: return 2;  // short / ushort
        case 5125: case 5126: return 4;  // uint / float
        default: return 0;
    }
}

size_t typeComponents(const std::string& t) {
    if (t == "SCALAR") return 1;
    if (t == "VEC2") return 2;
    if (t == "VEC3") return 3;
    if (t == "VEC4") return 4;
    if (t == "MAT2") return 4;
    if (t == "MAT3") return 9;
    if (t == "MAT4") return 16;
    return 0;
}

// Reads an accessor as float4 tuples.
bool readAccessor(const GltfContext& ctx, int accessorIndex, std::vector<Vec4>& out,
                  std::string& error) {
    const Json& accessors = ctx.gltf["accessors"];
    if (accessorIndex < 0 || (size_t)accessorIndex >= accessors.size()) {
        error = "accessor index out of range";
        return false;
    }
    const Json& acc = accessors[accessorIndex];
    size_t count = (size_t)acc["count"].asInt(0);
    int ctype = acc["componentType"].asInt(0);
    size_t comps = typeComponents(acc["type"].asString("SCALAR"));
    bool normalized = acc["normalized"].asBool(false);
    out.assign(count, Vec4(0, 0, 0, 0));
    if (count == 0) return true;
    if (!acc.has("bufferView")) {
        // sparse accessor without base data: zeros are valid
        return true;
    }
    int bvIndex = acc["bufferView"].asInt(-1);
    const Json& bufferViews = ctx.gltf["bufferViews"];
    if (bvIndex < 0 || (size_t)bvIndex >= bufferViews.size()) {
        error = "bufferView index out of range";
        return false;
    }
    const Json& bv = bufferViews[bvIndex];
    int bufferIdx = bv["buffer"].asInt(0);
    if (bufferIdx < 0 || (size_t)bufferIdx >= ctx.buffers.size()) {
        error = "buffer index out of range";
        return false;
    }
    const std::vector<uint8_t>& buf = ctx.buffers[bufferIdx];
    size_t baseOffset = (size_t)bv["byteOffset"].asInt(0) + (size_t)acc["byteOffset"].asInt(0);
    size_t csize = componentSize(ctype);
    size_t stride = (size_t)bv["byteStride"].asInt(0);
    if (stride == 0) stride = csize * comps;
    if (csize == 0 || comps == 0) {
        error = "unsupported accessor componentType/type";
        return false;
    }
    for (size_t i = 0; i < count; ++i) {
        size_t off = baseOffset + i * stride;
        if (off + csize * comps > buf.size()) {
            error = "accessor reads past the end of the buffer (file truncated?)";
            return false;
        }
        Vec4 v(0, 0, 0, 0);
        for (size_t c = 0; c < comps && c < 4; ++c) {
            const uint8_t* p = buf.data() + off + c * csize;
            float value = 0;
            switch (ctype) {
                case 5120: value = (float)(int8_t)p[0]; break;
                case 5121: value = (float)p[0]; break;
                case 5122: { int16_t s; memcpy(&s, p, 2); value = (float)s; break; }
                case 5123: { uint16_t s; memcpy(&s, p, 2); value = (float)s; break; }
                case 5125: { uint32_t s; memcpy(&s, p, 4); value = (float)s; break; }
                case 5126: { float f; memcpy(&f, p, 4); value = f; break; }
                default: break;
            }
            if (normalized) {
                if (ctype == 5121) value /= 255.0f;
                else if (ctype == 5123) value /= 65535.0f;
                else if (ctype == 5120) value = std::max(value / 127.0f, -1.0f);
                else if (ctype == 5122) value = std::max(value / 32767.0f, -1.0f);
            }
            v[(int)c] = value;
        }
        out[i] = v;
    }
    return true;
}

bool readIndexAccessor(const GltfContext& ctx, int accessorIndex, std::vector<uint32_t>& out,
                       std::string& error) {
    const Json& accessors = ctx.gltf["accessors"];
    if (accessorIndex < 0 || (size_t)accessorIndex >= accessors.size()) {
        error = "index accessor out of range";
        return false;
    }
    const Json& acc = accessors[accessorIndex];
    size_t count = (size_t)acc["count"].asInt(0);
    int ctype = acc["componentType"].asInt(5123);
    const Json& bv = ctx.gltf["bufferViews"][acc["bufferView"].asInt(-1)];
    int bufferIdx = bv["buffer"].asInt(0);
    if (bufferIdx < 0 || (size_t)bufferIdx >= ctx.buffers.size()) {
        error = "index buffer out of range";
        return false;
    }
    const std::vector<uint8_t>& buf = ctx.buffers[bufferIdx];
    size_t csize = componentSize(ctype);
    size_t stride = (size_t)bv["byteStride"].asInt(0);
    if (stride == 0) stride = csize;
    size_t base = (size_t)bv["byteOffset"].asInt(0) + (size_t)acc["byteOffset"].asInt(0);
    out.resize(count);
    for (size_t i = 0; i < count; ++i) {
        size_t off = base + i * stride;
        if (off + csize > buf.size()) {
            error = "index buffer truncated";
            return false;
        }
        const uint8_t* p = buf.data() + off;
        switch (ctype) {
            case 5121: out[i] = p[0]; break;
            case 5123: { uint16_t s; memcpy(&s, p, 2); out[i] = s; break; }
            case 5125: { uint32_t s; memcpy(&s, p, 4); out[i] = s; break; }
            default: error = "unsupported index componentType"; return false;
        }
    }
    return true;
}

std::string importImage(GltfContext& ctx, int imageIndex) {
    auto it = ctx.imageToPath.find(imageIndex);
    if (it != ctx.imageToPath.end()) return it->second;
    const Json& images = ctx.gltf["images"];
    if (imageIndex < 0 || (size_t)imageIndex >= images.size()) return "";
    const Json& img = images[imageIndex];
    std::string uri = img["uri"].asString("");
    fs::Bytes raw;
    std::string ext = "png";
    if (!uri.empty() && uri.rfind("data:", 0) == 0) {
        size_t comma = uri.find(',');
        raw = fs::base64Decode(uri.substr(comma + 1));
        if (uri.find("image/jpeg") != std::string::npos || uri.find("image/jpg") != std::string::npos)
            ext = "jpg";
    } else if (!uri.empty()) {
        raw = fs::readBinary(fs::join(ctx.sourceDir, uri));
        if (!raw.empty()) ext = fs::extension(uri);
    } else if (img.has("bufferView")) {
        int bvIndex = img["bufferView"].asInt(-1);
        const Json& bv = ctx.gltf["bufferViews"][bvIndex];
        int bufferIdx = bv["buffer"].asInt(0);
        std::string mime = img["mimeType"].asString("image/png");
        ext = mime.find("jpeg") != std::string::npos ? "jpg" : "png";
        if (bufferIdx >= 0 && (size_t)bufferIdx < ctx.buffers.size()) {
            const std::vector<uint8_t>& buf = ctx.buffers[bufferIdx];
            size_t off = (size_t)bv["byteOffset"].asInt(0);
            size_t len = (size_t)bv["byteLength"].asInt(0);
            if (off + len <= buf.size()) raw.assign(buf.begin() + off, buf.begin() + off + len);
        }
    }
    if (raw.empty()) {
        std::string msg = "image " + std::to_string(imageIndex) + " has no usable data";
        ctx.warnings.push_back(msg);
        NF_LOG_WARN("Import", "%s", msg.c_str());
        return "";
    }
    // Re-encode to PNG so textures can be inspected and edited by the user.
    ImageData decoded;
    std::string err;
    if (!decodeImage(raw.data(), raw.size(), decoded, 4, false, &err)) {
        ctx.warnings.push_back("image " + std::to_string(imageIndex) + ": " + err);
        return "";
    }
    std::string name = img["name"].asString("");
    if (name.empty())
        name = ctx.baseName + "_tex" + std::to_string(imageIndex);
    std::string rel = ctx.opts.texturesFolder + "/" + sanitizeName(name) + ".png";
    std::string full = fs::join(ctx.opts.projectRoot, rel);
    if (!writePng(full, decoded.pixels.data(), decoded.width, decoded.height)) return "";
    ctx.created.push_back(rel);
    ctx.imageToPath[imageIndex] = rel;
    return rel;
}

std::string texturePath(GltfContext& ctx, int textureIndex, bool* outIsSrgb = nullptr) {
    (void)outIsSrgb;
    auto it = ctx.textureToPath.find(textureIndex);
    if (it != ctx.textureToPath.end()) return it->second;
    const Json& textures = ctx.gltf["textures"];
    if (textureIndex < 0 || (size_t)textureIndex >= textures.size()) return "";
    int source = textures[textureIndex]["source"].asInt(-1);
    std::string p = source >= 0 ? importImage(ctx, source) : "";
    ctx.textureToPath[textureIndex] = p;
    return p;
}

std::string importMaterial(GltfContext& ctx, int materialIndex, const std::string& hint) {
    auto it = ctx.materialToPath.find(materialIndex);
    if (it != ctx.materialToPath.end()) return it->second;
    Material m;
    m.id = generateGuid();
    std::string name = hint.empty() ? (ctx.baseName + "_mat") : hint;
    if (materialIndex >= 0 && (size_t)materialIndex < ctx.gltf["materials"].size()) {
        const Json& jm = ctx.gltf["materials"][materialIndex];
        if (jm.has("name")) name = jm["name"].asString(name);
        const Json& pbr = jm["pbrMetallicRoughness"];
        if (pbr.has("baseColorFactor") && pbr["baseColorFactor"].size() >= 4) {
            const Json& c = pbr["baseColorFactor"];
            m.baseColor = Vec3(c[0].asFloat(1.0f), c[1].asFloat(1.0f), c[2].asFloat(1.0f));
            m.opacity = c[3].asFloat(1.0f);
        }
        m.metallic = pbr["metallicFactor"].asFloat(0.0f);
        m.roughness = pbr["roughnessFactor"].asFloat(0.85f);
        if (pbr.has("baseColorTexture"))
            m.albedoTexture = texturePath(ctx, pbr["baseColorTexture"]["index"].asInt(-1));
        if (jm.has("emissiveFactor") && jm["emissiveFactor"].size() >= 3) {
            const Json& e = jm["emissiveFactor"];
            m.emissive = Vec3(e[0].asFloat(0.0f), e[1].asFloat(0.0f), e[2].asFloat(0.0f));
            m.emissiveStrength = m.emissive.sqLength() > 0.0001f ? 1.0f : 0.0f;
        }
        std::string alphaMode = jm["alphaMode"].asString("OPAQUE");
        if (alphaMode == "BLEND") m.opacity = std::min(m.opacity, 0.999f);
        m.doubleSided = jm["doubleSided"].asBool(false);
    }
    m.name = name;
    std::string rel = ctx.opts.materialsFolder + "/" + sanitizeName(ctx.baseName + "_" + name) +
                      ".nfmat.json";
    if (!m.save(fs::join(ctx.opts.projectRoot, rel))) return "";
    ctx.created.push_back(rel);
    ctx.materialToPath[materialIndex] = rel;
    return rel;
}

}  // namespace

ImportResult importGltf(const std::string& sourceFile, const ImportOptions& opts) {
    ImportResult result;
    GltfContext ctx;
    ctx.opts = opts;
    ctx.sourceDir = fs::parent(sourceFile);
    ctx.baseName = sanitizeName(opts.nameOverride.empty() ? fs::stem(sourceFile) : opts.nameOverride);

    std::string error;
    if (!loadGltfFile(sourceFile, ctx, error))
        return ImportResult::failure("Unable to import '" + fs::filename(sourceFile) +
                                    "'\n  Reason: " + error);

    Model model;
    model.name = opts.nameOverride.empty() ? fs::stem(sourceFile) : opts.nameOverride;

    // ---------------------------------------------------------------- nodes
    const Json& nodesJson = ctx.gltf["nodes"];
    std::vector<int> parent((size_t)nodesJson.size(), -1);
    for (size_t i = 0; i < nodesJson.size(); ++i)
        for (const Json& c : nodesJson[(int)i]["children"].items()) {
            int ci = c.asInt(-1);
            if (ci >= 0 && ci < (int)nodesJson.size()) parent[ci] = (int)i;
        }
    for (size_t i = 0; i < nodesJson.size(); ++i) {
        const Json& jn = nodesJson[(int)i];
        ModelNode n;
        n.name = jn["name"].asString("Node" + std::to_string(i));
        n.parent = parent[i];
        if (jn.has("matrix") && jn["matrix"].size() >= 16) {
            Mat4 m;
            for (int k = 0; k < 16; ++k) m.m[k] = jn["matrix"][k].asFloat(k % 5 == 0 ? 1.0f : 0.0f);
            m.decompose(n.translation, n.rotation, n.scale);
        } else {
            if (jn.has("translation") && jn["translation"].size() >= 3)
                n.translation = Vec3(jn["translation"][0].asFloat(), jn["translation"][1].asFloat(),
                                     jn["translation"][2].asFloat());
            if (jn.has("rotation") && jn["rotation"].size() >= 4)
                n.rotation = Quat(jn["rotation"][0].asFloat(), jn["rotation"][1].asFloat(),
                                  jn["rotation"][2].asFloat(), jn["rotation"][3].asFloat(1.0f));
            if (jn.has("scale") && jn["scale"].size() >= 3)
                n.scale = Vec3(jn["scale"][0].asFloat(1.0f), jn["scale"][1].asFloat(1.0f),
                               jn["scale"][2].asFloat(1.0f));
        }
        model.nodes.push_back(n);
    }
    for (size_t i = 0; i < model.nodes.size(); ++i)
        if (model.nodes[i].parent >= 0)
            model.nodes[model.nodes[i].parent].children.push_back((int)i);

    // ---------------------------------------------------------------- skins
    if (ctx.gltf.has("skins")) {
        for (const Json& js : ctx.gltf["skins"].items()) {
            Skin skin;
            skin.name = js["name"].asString("Skin");
            for (const Json& j : js["joints"].items()) skin.joints.push_back(j.asInt(-1));
            if (js.has("inverseBindMatrices")) {
                std::vector<Vec4> mats;
                std::string aerr;
                if (readAccessor(ctx, js["inverseBindMatrices"].asInt(-1), mats, aerr)) {
                    size_t n = mats.size() / 4;
                    for (size_t i = 0; i < n; ++i) {
                        Mat4 m;
                        for (int k = 0; k < 16; ++k) {
                            // MAT4 accessors are 4 columns of VEC4
                            int col = k / 4, row = k % 4;
                            m.m[k] = mats[i * 4 + col][row];
                        }
                        skin.inverseBind.push_back(m);
                    }
                } else {
                    ctx.warnings.push_back("skin inverse bind matrices: " + aerr);
                }
            }
            while (skin.inverseBind.size() < skin.joints.size()) skin.inverseBind.push_back(Mat4());
            model.skins.push_back(std::move(skin));
        }
    }

    // ---------------------------------------------------------------- meshes
    const Json& meshesJson = ctx.gltf["meshes"];
    std::vector<std::pair<int, int>> nodeMesh;  // (node, meshIndex)
    for (size_t i = 0; i < nodesJson.size(); ++i)
        if (nodesJson[(int)i].has("mesh"))
            nodeMesh.emplace_back((int)i, nodesJson[(int)i]["mesh"].asInt(-1));

    for (size_t mi = 0; mi < meshesJson.size(); ++mi) {
        const Json& jmesh = meshesJson[(int)mi];
        Mesh mesh;
        std::string meshName = jmesh["name"].asString("Mesh" + std::to_string(mi));
        mesh.name = meshName;
        bool meshSkinned = false;
        std::vector<std::string> partMaterials;
        const Json& prims = jmesh["primitives"];
        for (size_t pi = 0; pi < prims.size(); ++pi) {
            const Json& prim = prims[(int)pi];
            int mode = prim["mode"].asInt(4);
            if (mode != 4) {
                ctx.warnings.push_back("mesh '" + meshName + "' primitive " + std::to_string(pi) +
                                       " uses mode " + std::to_string(mode) +
                                       " (only TRIANGLES=4 is supported) - skipped");
                continue;
            }
            if (!prim.has("attributes") || !prim["attributes"].has("POSITION")) {
                ctx.warnings.push_back("mesh '" + meshName + "' primitive " + std::to_string(pi) +
                                       " has no POSITION attribute - skipped");
                continue;
            }
            std::vector<Vec4> positions, normals, uvs, colors, joints, weights;
            std::string aerr;
            if (!readAccessor(ctx, prim["attributes"]["POSITION"].asInt(-1), positions, aerr)) {
                ctx.warnings.push_back("mesh '" + meshName + "': " + aerr);
                continue;
            }
            const Json& attrs = prim["attributes"];
            bool hasNormals = attrs.has("NORMAL") &&
                              readAccessor(ctx, attrs["NORMAL"].asInt(-1), normals, aerr);
            bool hasUv = (attrs.has("TEXCOORD_0") &&
                          readAccessor(ctx, attrs["TEXCOORD_0"].asInt(-1), uvs, aerr));
            bool hasColor = attrs.has("COLOR_0") &&
                            readAccessor(ctx, attrs["COLOR_0"].asInt(-1), colors, aerr);
            bool hasJoints = attrs.has("JOINTS_0") &&
                             readAccessor(ctx, attrs["JOINTS_0"].asInt(-1), joints, aerr);
            bool hasWeights = attrs.has("WEIGHTS_0") &&
                              readAccessor(ctx, attrs["WEIGHTS_0"].asInt(-1), weights, aerr);
            if (hasJoints && hasWeights) meshSkinned = true;

            uint32_t base = (uint32_t)mesh.vertices.size();
            for (size_t v = 0; v < positions.size(); ++v) {
                Vertex vert;
                vert.pos = Vec3(positions[v].x, positions[v].y, positions[v].z) * opts.scale;
                if (hasNormals && v < normals.size())
                    vert.normal = Vec3(normals[v].x, normals[v].y, normals[v].z).normalized();
                else
                    vert.normal = Vec3(0, 0, 0);
                if (hasUv && v < uvs.size()) vert.uv = Vec2(uvs[v].x, 1.0f - uvs[v].y);
                if (hasColor && v < colors.size())
                    vert.color = Vec4(colors[v].x, colors[v].y, colors[v].z,
                                      colors[v].w > 0 ? colors[v].w : 1.0f);
                if (hasJoints && hasWeights && v < joints.size() && v < weights.size()) {
                    for (int k = 0; k < 4; ++k) {
                        vert.joints[k] = (uint16_t)clampf(joints[v][k], 0, 65535);
                        vert.weights[k] = std::max(0.0f, weights[v][k]);
                    }
                    float total = vert.weights[0] + vert.weights[1] + vert.weights[2] +
                                  vert.weights[3];
                    if (total > 0.0001f)
                        for (int k = 0; k < 4; ++k) vert.weights[k] /= total;
                }
                mesh.vertices.push_back(vert);
            }
            std::vector<uint32_t> indices;
            if (prim.has("indices")) {
                if (!readIndexAccessor(ctx, prim["indices"].asInt(-1), indices, aerr)) {
                    ctx.warnings.push_back("mesh '" + meshName + "': " + aerr);
                    continue;
                }
            } else {
                indices.resize(positions.size());
                for (size_t v = 0; v < positions.size(); ++v) indices[v] = (uint32_t)v;
            }
            uint32_t first = (uint32_t)mesh.indices.size();
            for (uint32_t idx : indices) mesh.indices.push_back(base + idx);
            int materialIndexLocal = (int)partMaterials.size();
            mesh.addSubMesh(materialIndexLocal, first, (uint32_t)indices.size());
            std::string matPath = importMaterial(ctx, prim.has("material") ? prim["material"].asInt(-1) : -1,
                                                meshName);
            partMaterials.push_back(matPath);
        }
        if (mesh.vertices.empty()) continue;
        mesh.skinned = meshSkinned;
        if (!hasAnyNormal(mesh)) mesh.computeNormals();
        mesh.computeBounds();
        std::string relMesh = opts.meshesFolder + "/" + ctx.baseName + "_" + sanitizeName(meshName) +
                              ".nfmesh";
        if (!mesh.save(fs::join(opts.projectRoot, relMesh))) {
            return ImportResult::failure("failed to write mesh file " + relMesh);
        }
        ctx.created.push_back(relMesh);
        ModelPart part;
        part.name = meshName;
        part.mesh = std::make_shared<Mesh>(std::move(mesh));
        part.meshPath = relMesh;
        part.node = -1;
        for (auto& nm : nodeMesh)
            if (nm.second == (int)mi) {
                part.node = nm.first;
                if (nodesJson[nm.first].has("skin"))
                    part.skin = nodesJson[nm.first]["skin"].asInt(-1);
                break;
            }
        part.subMaterialPaths = partMaterials;
        if (!partMaterials.empty() && !partMaterials[0].empty())
            part.materialPath = partMaterials[0];
        if (partMaterials.size() > 1)
            ctx.warnings.push_back("mesh '" + meshName + "' has " +
                                   std::to_string(partMaterials.size()) +
                                   " materials - each sub-mesh keeps its own material");
        if (partMaterials.empty() && opts.generateMissingMaterials) {
            Material m = Material::defaultMaterial();
            m.name = meshName;
            std::string rel = opts.materialsFolder + "/" + ctx.baseName + "_" + sanitizeName(meshName) +
                              ".nfmat.json";
            m.save(fs::join(opts.projectRoot, rel));
            ctx.created.push_back(rel);
            part.materialPath = rel;
        }
        model.parts.push_back(std::move(part));
    }

    // ------------------------------------------------------------ animations
    if (opts.importAnimations && ctx.gltf.has("animations")) {
        for (const Json& ja : ctx.gltf["animations"].items()) {
            AnimationClip clip;
            clip.name = ja["name"].asString("Clip" + std::to_string(model.animations.size()));
            const Json& samplers = ja["samplers"];
            for (const Json& jc : ja["channels"].items()) {
                const Json& target = jc["target"];
                int node = target["node"].asInt(-1);
                std::string path = target["path"].asString("");
                int samplerIdx = jc["sampler"].asInt(-1);
                if (node < 0 || samplerIdx < 0 || (size_t)samplerIdx >= samplers.size()) continue;
                AnimationChannel ch;
                ch.node = node;
                if (path == "translation") ch.path = AnimationChannel::Path::Translation;
                else if (path == "scale") ch.path = AnimationChannel::Path::Scale;
                else if (path == "rotation") ch.path = AnimationChannel::Path::Rotation;
                else continue;
                const Json& sampler = samplers[samplerIdx];
                std::string interp = sampler["interpolation"].asString("LINEAR");
                if (interp == "CUBICSPLINE")
                    ctx.warnings.push_back("animation '" + clip.name +
                                           "' uses CUBICSPLINE; sampled as LINEAR");
                std::vector<Vec4> times, values;
                std::string aerr;
                if (!readAccessor(ctx, sampler["input"].asInt(-1), times, aerr) ||
                    !readAccessor(ctx, sampler["output"].asInt(-1), values, aerr)) {
                    ctx.warnings.push_back("animation '" + clip.name + "': " + aerr);
                    continue;
                }
                // CUBICSPLINE stores 3 values per key; keep the middle one
                size_t stride = (interp == "CUBICSPLINE") ? 3 : 1;
                for (size_t i = 0; i < times.size(); ++i) {
                    ch.times.push_back(times[i].x);
                    size_t vi = i * stride + (stride == 3 ? 1 : 0);
                    if (vi < values.size()) ch.values.push_back(values[vi]);
                }
                if (!ch.times.empty()) {
                    clip.duration = std::max(clip.duration, ch.times.back());
                    clip.channels.push_back(std::move(ch));
                }
            }
            if (clip.valid()) model.animations.push_back(std::move(clip));
        }
    }

    if (model.parts.empty()) {
        return ImportResult::failure("Unable to import '" + fs::filename(sourceFile) +
                                     "'\n  Reason: no triangle geometry found in the file");
    }
    model.skinned = meshIsSkinned(model);
    model.computeBounds();

    std::string relModel = opts.modelsFolder + "/" + ctx.baseName + ".nfmodel.json";
    if (!model.save(fs::join(opts.projectRoot, relModel), opts.projectRoot)) {
        return ImportResult::failure("failed to write model file " + relModel);
    }
    ctx.created.push_back(relModel);

    result.ok = true;
    result.modelPath = relModel;
    result.assetPath = relModel;
    result.assetType = "Model";
    result.createdFiles = ctx.created;
    result.warnings = ctx.warnings;
    result.triangleCount = model.triangleCount();
    result.partCount = model.parts.size();
    result.animationCount = model.animations.size();
    char buf[512];
    snprintf(buf, sizeof(buf),
             "Imported '%s': %zu parts, %zu triangles, %zu animation(s), %zu file(s) written",
             fs::filename(sourceFile).c_str(), result.partCount, result.triangleCount,
             result.animationCount, result.createdFiles.size());
    result.message = buf;
    NF_LOG_INFO("Import", "%s", result.message.c_str());
    for (auto& w : result.warnings) NF_LOG_WARN("Import", "  %s", w.c_str());
    return result;
}

}  // namespace nf
