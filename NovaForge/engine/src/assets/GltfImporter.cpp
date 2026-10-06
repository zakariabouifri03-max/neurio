// NovaForge Engine - assets/GltfImporter.cpp
// glTF 2.0 importer: .gltf (JSON + external/base64 buffers) and .glb (binary container).
// Imports meshes, materials, textures (extracted to disk), skins and animations.
#include "assets/MeshImport.h"
#include "core/FileSystem.h"
#include "core/StringUtil.h"
#include "core/Log.h"

#include <unordered_map>

namespace nf {

namespace {

struct GltfBuffer {
  std::vector<u8> data;
};

struct GltfContext {
  JsonValue root;
  std::string filePath;
  std::string dir;
  std::vector<GltfBuffer> buffers;
  std::vector<std::shared_ptr<Texture>> textures;
  MeshImportOptions options;
  std::string warning;
  std::vector<std::string> textureFiles;   // asset path per glTF texture index
  std::unordered_map<int, int> nodeToBone; // glTF node index -> skeleton bone index

  bool Fail(std::string* error, const std::string& reason) {
    if (error) *error = "Unable to load " + fs::FileName(filePath) + "\nReason: " + reason;
    return false;
  }
};

// ----------------------------------------------------------------- base64
std::vector<u8> Base64Decode(const std::string& input) {
  static int8_t table[256];
  static bool init = false;
  if (!init) {
    for (int i = 0; i < 256; i++) table[i] = -1;
    const char* alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (int i = 0; i < 64; i++) table[(u8)alpha[i]] = (int8_t)i;
    init = true;
  }
  std::vector<u8> out;
  out.reserve(input.size() * 3 / 4 + 3);
  u32 buffer = 0;
  int bits = 0;
  for (char c : input) {
    if (c == '=' || c == '\n' || c == '\r') continue;
    int8_t v = table[(u8)c];
    if (v < 0) continue;
    buffer = (buffer << 6) | (u32)v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push_back((u8)((buffer >> bits) & 0xFF));
    }
  }
  return out;
}

std::string ExtensionToFormat(const std::string& uriOrName) {
  auto ext = ToLower(fs::Extension(uriOrName));
  if (ext.empty()) return "png";
  return ext;
}

// ----------------------------------------------------------------- accessors
struct AccessorReader {
  const GltfContext* ctx = nullptr;
  JsonValue accessor;
  int componentType = 5126;
  int count = 0;
  int components = 1;
  usize elementSize = 0;
  const u8* base = nullptr;
  usize stride = 0;

  static int ComponentsPerType(const std::string& type) {
    if (type == "SCALAR") return 1;
    if (type == "VEC2") return 2;
    if (type == "VEC3") return 3;
    if (type == "VEC4") return 4;
    if (type == "MAT2") return 4;
    if (type == "MAT3") return 9;
    if (type == "MAT4") return 16;
    return 1;
  }
  static usize SizeOfComponent(int type) {
    switch (type) {
      case 5120: case 5121: return 1;
      case 5122: case 5123: return 2;
      case 5125: case 5126: return 4;
      default: return 4;
    }
  }

  bool Init(const GltfContext* c, int accessorIndex) {
    ctx = c;
    const JsonValue& accessors = c->root["accessors"];
    if (!accessors.IsArray() || accessorIndex < 0 || (usize)accessorIndex >= accessors.Size())
      return false;
    accessor = accessors[(usize)accessorIndex];
    count = accessor["count"].AsInt(0);
    componentType = accessor["componentType"].AsInt(5126);
    components = ComponentsPerType(accessor["type"].AsString("SCALAR"));
    elementSize = SizeOfComponent(componentType) * (usize)components;

    int bufferViewIndex = accessor["bufferView"].AsInt(-1);
    if (bufferViewIndex < 0) return count == 0;   // sparse / all-zero accessor
    const JsonValue& views = c->root["bufferViews"];
    if (!views.IsArray() || (usize)bufferViewIndex >= views.Size()) return false;
    JsonValue view = views[(usize)bufferViewIndex];
    int bufferIndex = view["buffer"].AsInt(0);
    if (bufferIndex < 0 || (usize)bufferIndex >= c->buffers.size()) return false;
    usize viewOffset = (usize)view["byteOffset"].AsUInt64(0);
    usize accessorOffset = (usize)accessor["byteOffset"].AsUInt64(0);
    stride = (usize)view["byteStride"].AsUInt64(0);
    if (stride == 0) stride = elementSize;
    const auto& buf = c->buffers[(usize)bufferIndex].data;
    if (viewOffset + accessorOffset >= buf.size() && count > 0) return false;
    base = buf.data() + viewOffset + accessorOffset;
    return true;
  }

  template <typename T>
  T ReadRaw(usize element, int component) const {
    const u8* p = base + element * stride + (usize)component * SizeOfComponent(componentType);
    T out{};
    switch (componentType) {
      case 5120: out = (T)(*(const i8*)p); break;
      case 5121: out = (T)(*(const u8*)p); break;
      case 5122: out = (T)(*(const i16*)p); break;
      case 5123: out = (T)(*(const u16*)p); break;
      case 5125: out = (T)(*(const u32*)p); break;
      default: out = (T)(*(const f32*)p); break;
    }
    return out;
  }

  bool Normalized() const { return accessor.Has("normalized") && accessor["normalized"].AsBool(false); }

  // Reads a component as float, applying normalization for integer types.
  f32 Float(usize element, int component) const {
    const u8* p = base + element * stride + (usize)component * SizeOfComponent(componentType);
    switch (componentType) {
      case 5120: return *(const i8*)p / 127.0f;
      case 5121: return *(const u8*)p / 255.0f;
      case 5122: return *(const i16*)p / 32767.0f;
      case 5123: return *(const u16*)p / 65535.0f;
      case 5125: return (f32)(*(const u32*)p);
      default: return *(const f32*)p;
    }
  }
  u32 UInt(usize element, int component) const {
    const u8* p = base + element * stride + (usize)component * SizeOfComponent(componentType);
    switch (componentType) {
      case 5121: return *(const u8*)p;
      case 5123: return *(const u16*)p;
      case 5125: return *(const u32*)p;
      case 5120: return (u32)std::max(0, (int)(*(const i8*)p));
      case 5122: return (u32)std::max(0, (int)(*(const i16*)p));
      default: return (u32)(*(const f32*)p);
    }
  }
  Vec2 Vec2At(usize e) const { return {Float(e, 0), Float(e, 1)}; }
  Vec3 Vec3At(usize e) const { return {Float(e, 0), Float(e, 1), Float(e, 2)}; }
  Vec4 Vec4At(usize e) const {
    return {Float(e, 0), Float(e, 1), Float(e, 2), components > 3 ? Float(e, 3) : 1.0f};
  }
  Mat4 Mat4At(usize e) const {
    Mat4 m;
    for (int c = 0; c < 4; c++)
      for (int r = 0; r < 4; r++) m.At(r, c) = Float(e, c * 4 + r);
    return m;
  }
};

// ----------------------------------------------------------------- buffers
bool LoadBuffers(GltfContext& ctx, std::string* error) {
  const JsonValue& buffers = ctx.root["buffers"];
  ctx.buffers.resize(buffers.IsArray() ? buffers.Size() : 0);
  for (usize i = 0; i < ctx.buffers.size(); i++) {
    JsonValue b = buffers[i];
    std::string uri = b["uri"].AsString();
    if (uri.empty()) {
      continue;   // GLB binary chunk is filled in by the caller
    }
    if (StartsWith(uri, "data:")) {
      auto comma = uri.find(',');
      if (comma == std::string::npos)
        return ctx.Fail(error, "invalid data URI in buffer " + std::to_string(i));
      ctx.buffers[i].data = Base64Decode(uri.substr(comma + 1));
    } else {
      std::string decoded = uri;
      // percent-decode the few characters that appear in practice
      decoded = ReplaceAll(decoded, "%20", " ");
      std::string path = fs::Join(ctx.dir, decoded);
      std::string err;
      ctx.buffers[i].data = fs::ReadBinary(path, &err);
      if (ctx.buffers[i].data.empty()) {
        return ctx.Fail(error, "external buffer not found: " + decoded + " (" + err + ")");
      }
    }
  }
  return true;
}

// ----------------------------------------------------------------- textures
std::string ExtractTexture(GltfContext& ctx, int textureIndex, const std::string& baseName) {
  if (textureIndex < 0) return {};
  const JsonValue& textures = ctx.root["textures"];
  if (!textures.IsArray() || (usize)textureIndex >= textures.Size()) return {};
  JsonValue tex = textures[(usize)textureIndex];
  int sourceIndex = tex["source"].AsInt(-1);
  // KHR_texture_basisu / EXT_texture_webp fall back to their fallback source
  if (sourceIndex < 0) {
    auto ext = tex["extensions"];
    if (ext.Has("KHR_texture_basisu")) sourceIndex = ext["KHR_texture_basisu"]["source"].AsInt(-1);
  }
  if (sourceIndex < 0) return {};
  const JsonValue& images = ctx.root["images"];
  if (!images.IsArray() || (usize)sourceIndex >= images.Size()) return {};

  auto ExistingFile = [&](int idx) -> std::string {
    if (idx < (int)ctx.textureFiles.size() && !ctx.textureFiles[(usize)idx].empty())
      return ctx.textureFiles[(usize)idx];
    return {};
  };
  if (auto e = ExistingFile(sourceIndex); !e.empty()) return e;

  JsonValue image = images[(usize)sourceIndex];
  std::string uri = image["uri"].AsString();
  std::string outDir = ctx.options.textureOutputDir.empty()
                           ? fs::Join(ctx.dir, "Textures")
                           : ctx.options.textureOutputDir;
  std::string stem = SanitizeIdentifier(baseName) + "_Tex" + std::to_string(sourceIndex);

  std::vector<u8> bytes;
  std::string extension = "png";
  if (!uri.empty()) {
    if (StartsWith(uri, "data:")) {
      auto comma = uri.find(',');
      auto meta = uri.substr(5, comma - 5);
      if (meta.find("image/jpeg") != std::string::npos) extension = "jpg";
      else if (meta.find("image/webp") != std::string::npos) extension = "webp";
      bytes = Base64Decode(uri.substr(comma + 1));
    } else {
      std::string decoded = ReplaceAll(uri, "%20", " ");
      // external image: reference it directly if it lives next to the model
      std::string src = fs::Join(ctx.dir, decoded);
      extension = ExtensionToFormat(decoded);
      if (!fs::Exists(src)) {
        ctx.warning += "texture not found: " + decoded + "; ";
        return {};
      }
      std::string dest = fs::Join(outDir, stem + "." + extension);
      if (!ctx.options.importTextures) return src;
      if (!fs::Copy(src, dest)) {
        ctx.warning += "could not copy texture " + decoded + "; ";
        return src;
      }
      ctx.textureFiles.resize(std::max(ctx.textureFiles.size(), (usize)sourceIndex + 1));
      ctx.textureFiles[(usize)sourceIndex] = dest;
      return dest;
    }
  } else {
    int bufferView = image["bufferView"].AsInt(-1);
    const JsonValue& views = ctx.root["bufferViews"];
    if (bufferView < 0 || !views.IsArray() || (usize)bufferView >= views.Size()) return {};
    JsonValue view = views[(usize)bufferView];
    int bufferIndex = view["buffer"].AsInt(0);
    usize offset = (usize)view["byteOffset"].AsUInt64(0);
    usize length = (usize)view["byteLength"].AsUInt64(0);
    if (bufferIndex < 0 || (usize)bufferIndex >= ctx.buffers.size()) return {};
    const auto& buf = ctx.buffers[(usize)bufferIndex].data;
    if (offset + length > buf.size()) return {};
    bytes.assign(buf.begin() + (i64)offset, buf.begin() + (i64)(offset + length));
    std::string mime = image["mimeType"].AsString("image/png");
    if (mime.find("jpeg") != std::string::npos) extension = "jpg";
    else if (mime.find("webp") != std::string::npos) extension = "webp";
  }

  if (bytes.empty()) {
    ctx.warning += "empty texture data for image " + std::to_string(sourceIndex) + "; ";
    return {};
  }
  if (!ctx.options.importTextures) return {};

  std::string dest = fs::Join(outDir, stem + "." + extension);
  if (!fs::WriteBinary(dest, bytes.data(), bytes.size())) {
    ctx.warning += "could not write texture " + fs::Stem(dest) + "; ";
    return {};
  }
  ctx.textureFiles.resize(std::max(ctx.textureFiles.size(), (usize)sourceIndex + 1));
  ctx.textureFiles[(usize)sourceIndex] = dest;
  return dest;
}

// ----------------------------------------------------------------- materials
struct GltfMaterialInfo {
  int gltfIndex = -1;
  int materialSlot = 0;
  bool skinned = false;
};

// ----------------------------------------------------------------- node math
void BuildNodeLocal(const JsonValue& node, Transform* out) {
  if (node.Has("matrix")) {
    *out = Transform::FromMatrix(node["matrix"].AsQuat().w != 0 ? Mat4::Identity() : Mat4::Identity());
    Mat4 m;
    for (int c = 0; c < 4; c++)
      for (int r = 0; r < 4; r++) m.At(r, c) = node["matrix"][(usize)(c * 4 + r)].AsFloat();
    *out = Transform::FromMatrix(m);
    return;
  }
  out->position = node["translation"].AsVec3(Vec3(0, 0, 0));
  out->rotation = node["rotation"].AsQuat(Quat(0, 0, 0, 1));
  out->scale = node["scale"].AsVec3(Vec3(1, 1, 1));
}

std::vector<Mat4> ComputeNodeWorldMatrices(const JsonValue& nodes, int rootNode,
                                           const std::vector<int>& parents) {
  std::vector<Mat4> local(nodes.Size());
  for (usize i = 0; i < nodes.Size(); i++) {
    Transform t;
    BuildNodeLocal(nodes[i], &t);
    local[i] = t.Matrix();
  }
  std::vector<Mat4> world(nodes.Size(), Mat4::Identity());
  std::function<void(int, const Mat4&)> walk = [&](int index, const Mat4& parent) {
    if (index < 0 || (usize)index >= nodes.Size()) return;
    world[(usize)index] = parent * local[(usize)index];
    if (nodes[(usize)index]["children"].IsArray()) {
      for (usize c = 0; c < nodes[(usize)index]["children"].Size(); c++) {
        int child = nodes[(usize)index]["children"][c].AsInt(-1);
        if (child >= 0) walk(child, world[(usize)index]);
      }
    }
  };
  if (rootNode >= 0) {
    walk(rootNode, Mat4::Identity());
  } else {
    // default scene: all roots
    for (usize i = 0; i < nodes.Size(); i++)
      if (i < parents.size() && parents[i] < 0) walk((int)i, Mat4::Identity());
  }
  return world;
}

} // namespace

MeshImportResult MeshImporter::ImportGltf(const std::string& path, const MeshImportOptions& options) {
  MeshImportResult result;
  GltfContext ctx;
  ctx.filePath = path;
  ctx.dir = fs::Parent(path);
  ctx.options = options;

  std::string error;

  // ---------------------------------------------------------------- container
  std::string fileError;
  std::vector<u8> bytes = fs::ReadBinary(path, &fileError);
  if (bytes.empty()) {
    result.error = "Unable to load " + fs::FileName(path) + "\nReason: " + fileError;
    return result;
  }
  std::vector<u8> binChunk;
  const u8* jsonBegin = bytes.data();
  usize jsonLength = bytes.size();
  if (bytes.size() > 12 && memcmp(bytes.data(), "glTF", 4) == 0) {
    u32 version = *(const u32*)(bytes.data() + 4);
    "      // GLB container";
    if (version != 2) {
      result.error = "Unable to load " + fs::FileName(path) +
                     "\nReason: unsupported GLB version " + std::to_string(version) +
                     " (only glTF 2.0 is supported)";
      return result;
    }
    usize cursor = 12;
    bool foundJson = false;
    while (cursor + 8 <= bytes.size()) {
      u32 chunkLength = *(const u32*)(bytes.data() + cursor);
      u32 chunkType = *(const u32*)(bytes.data() + cursor + 4);
      cursor += 8;
      if (cursor + chunkLength > bytes.size()) break;
      if (chunkType == 0x4E4F534A) {          // 'JSON'
        jsonBegin = bytes.data() + cursor;
        jsonLength = chunkLength;
        foundJson = true;
      } else if (chunkType == 0x004E4942) {   // 'BIN'
        binChunk.assign(bytes.begin() + (i64)cursor, bytes.begin() + (i64)(cursor + chunkLength));
      }
      cursor += chunkLength;
      cursor = (cursor + 3) & ~(usize)3;
    }
    if (!foundJson) {
      result.error = "Unable to load " + fs::FileName(path) + "\nReason: GLB has no JSON chunk";
      return result;
    }
  }

  std::string jsonText((const char*)jsonBegin, jsonLength);
  std::string parseError;
  ctx.root = JsonValue::Parse(jsonText, &parseError);
  if (!parseError.empty()) {
    result.error = "Unable to load " + fs::FileName(path) + "\nReason: invalid glTF JSON: " + parseError;
    return result;
  }

  if (!LoadBuffers(ctx, &error)) {
    result.error = error;
    return result;
  }
  // fill buffers that reference the GLB binary chunk
  const JsonValue& buffers = ctx.root["buffers"];
  for (usize i = 0; i < ctx.buffers.size(); i++) {
    if (ctx.buffers[i].data.empty() && !binChunk.empty()) ctx.buffers[i].data = binChunk;
    if (ctx.buffers[i].data.empty() && buffers[i]["byteLength"].AsUInt64(0) > 0) {
      result.error = "Unable to load " + fs::FileName(path) + "\nReason: buffer " +
                     std::to_string(i) + " could not be resolved (missing .bin file or BIN chunk)";
      return result;
    }
  }

  // ---------------------------------------------------------------- skeleton
  const JsonValue& nodes = ctx.root["nodes"];
  const JsonValue& skins = ctx.root["skins"];
  std::vector<int> parents(nodes.Size(), -1);
  if (nodes.IsArray()) {
    for (usize i = 0; i < nodes.Size(); i++) {
      const JsonValue& children = nodes[i]["children"];
      for (usize c = 0; c < children.Size(); c++) {
        int child = children[c].AsInt(-1);
        if (child >= 0 && (usize)child < nodes.Size()) parents[(usize)child] = (int)i;
      }
    }
  }

  auto model = std::make_shared<Model>();
  model->name = fs::Stem(path);
  model->sourcePath = path;
  model->mesh = std::make_shared<Mesh>();
  model->mesh->name = model->name;

  bool anySkinned = false;
  if (skins.IsArray() && skins.Size() > 0 && nodes.IsArray()) {
    JsonValue skin = skins[0];
    const JsonValue& joints = skin["joints"];
    std::vector<int> jointNodes;
    for (usize i = 0; i < joints.Size(); i++) jointNodes.push_back(joints[i].AsInt(-1));

    // node world transforms give the bind pose
    std::vector<Mat4> world = ComputeNodeWorldMatrices(nodes, -1, parents);
    std::vector<Mat4> inverseBind(jointNodes.size(), Mat4::Identity());
    int ibmAccessor = skin["inverseBindMatrices"].AsInt(-1);
    if (ibmAccessor >= 0) {
      AccessorReader reader;
      if (reader.Init(&ctx, ibmAccessor)) {
        for (usize i = 0; i < jointNodes.size() && i < (usize)reader.count; i++)
          inverseBind[i] = reader.Mat4At(i);
      }
    }

    for (usize i = 0; i < jointNodes.size(); i++) {
      int nodeIndex = jointNodes[i];
      Bone bone;
      bone.name = (nodeIndex >= 0 && (usize)nodeIndex < nodes.Size())
                      ? nodes[(usize)nodeIndex]["name"].AsString("Bone" + std::to_string(i))
                      : "Bone" + std::to_string(i);
      bone.inverseBindMatrix = inverseBind[i];
      // parent bone = nearest ancestor that is also a joint
      int parentNode = (nodeIndex >= 0 && (usize)nodeIndex < parents.size()) ? parents[(usize)nodeIndex] : -1;
      bone.parent = -1;
      while (parentNode >= 0) {
        auto it = ctx.nodeToBone.find(parentNode);
        if (it != ctx.nodeToBone.end()) { bone.parent = it->second; break; }
        parentNode = (usize)parentNode < parents.size() ? parents[(usize)parentNode] : -1;
      }
      if (nodeIndex >= 0) {
        Transform local;
        BuildNodeLocal(nodes[(usize)nodeIndex], &local);
        bone.localBind = local;
      }
      ctx.nodeToBone[nodeIndex] = (int)model->skeleton.bones.size();
      model->skeleton.bones.push_back(bone);
    }
    anySkinned = !model->skeleton.bones.empty();
  }

  // ---------------------------------------------------------------- meshes
  const JsonValue& meshes = ctx.root["meshes"];
  std::unordered_map<std::string, int> materialSlotByName;
  bool firstPrimitiveOfMeshDone = false;
  NF_UNUSED(firstPrimitiveOfMeshDone);

  for (usize meshIndex = 0; meshIndex < meshes.Size(); meshIndex++) {
    JsonValue mesh = meshes[meshIndex];
    std::string meshName = mesh["name"].AsString("Mesh" + std::to_string(meshIndex));
    const JsonValue& primitives = mesh["primitives"];
    for (usize primitiveIndex = 0; primitiveIndex < primitives.Size(); primitiveIndex++) {
      JsonValue primitive = primitives[(usize)primitiveIndex];
      int mode = primitive["mode"].AsInt(4);
      JsonValue attributes = primitive["attributes"];

      AccessorReader position, normal, uv, tangent, joints, weights, indices;
      if (!position.Init(&ctx, attributes["POSITION"].AsInt(-1))) {
        ctx.warning += "primitive without POSITION skipped; ";
        continue;
      }
      bool hasNormal = normal.Init(&ctx, attributes["NORMAL"].AsInt(-1));
      bool hasUV = uv.Init(&ctx, attributes["TEXCOORD_0"].AsInt(-1));
      bool hasTangent = tangent.Init(&ctx, attributes["TANGENT"].AsInt(-1));
      bool hasJoints = joints.Init(&ctx, attributes["JOINTS_0"].AsInt(-1));
      bool hasWeights = weights.Init(&ctx, attributes["WEIGHTS_0"].AsInt(-1));
      bool hasIndices = indices.Init(&ctx, primitive["indices"].AsInt(-1));

      u32 vertexBase = (u32)model->mesh->vertices.size();
      u32 skinnedBase = (u32)model->mesh->skinnedVertices.size();
      bool primitiveSkinned = anySkinned && hasJoints && hasWeights;

      for (int v = 0; v < position.count; v++) {
        Vec3 p = position.Vec3At((usize)v) * options.scale;
        Vec3 n = hasNormal ? normal.Vec3At((usize)v) : Vec3(0, 0, 0);
        Vec2 t = hasUV ? uv.Vec2At((usize)v) : Vec2(0, 0);
        if (options.flipUVs) t.y = 1.0f - t.y;
        Vec4 tan = hasTangent ? tangent.Vec4At((usize)v) : Vec4(1, 0, 0, 1);
        if (primitiveSkinned) {
          SkinnedVertex sv;
          sv.position = p;
          sv.normal = n;
          sv.uv = t;
          sv.tangent = tan;
          for (int k = 0; k < 4; k++) {
            sv.joints[k] = (u16)joints.UInt((usize)v, k);
            sv.weights[k] = weights.Float((usize)v, k);
          }
          model->mesh->skinnedVertices.push_back(sv);
        } else {
          Vertex vert;
          vert.position = p;
          vert.normal = n;
          vert.uv = t;
          vert.tangent = tan;
          model->mesh->vertices.push_back(vert);
        }
      }
      if (anySkinned && !primitiveSkinned) {
        // model has a skin but this primitive is static: fill skin data with full weight on
        // the root bone so the skinned shader leaves it in place.
        for (int v = 0; v < position.count; v++) {
          SkinnedVertex sv;
          const Vertex& src = model->mesh->vertices[vertexBase + (u32)v];
          sv.position = src.position;
          sv.normal = src.normal;
          sv.uv = src.uv;
          sv.tangent = src.tangent;
          sv.joints[0] = 0;
          sv.weights[0] = 1.0f;
          model->mesh->skinnedVertices.push_back(sv);
        }
        // remove the plain copies (they are re-added below through skinned storage)
        model->mesh->vertices.resize(vertexBase);
      }

      SubMesh sub;
      sub.indexOffset = (u32)model->mesh->indices.size();
      sub.vertexOffset = primitiveSkinned ? skinnedBase : vertexBase;
      sub.name = meshName + (primitives.Size() > 1 ? "_" + std::to_string(primitiveIndex) : "");

      usize indexCount = hasIndices ? (usize)indices.count : (usize)position.count;
      std::vector<u32> localIndices;
      localIndices.reserve(indexCount);
      for (usize i = 0; i < indexCount; i++)
        localIndices.push_back(hasIndices ? indices.UInt(i, 0) : (u32)i);
      NF_UNUSED(mode);

      // convert strips/fans to triangles so the runtime only ever sees triangles
      auto emitTriangle = [&](u32 a, u32 b, u32 c) {
        model->mesh->indices.push_back(a + vertexBase);
        model->mesh->indices.push_back(b + vertexBase);
        model->mesh->indices.push_back(c + vertexBase);
      };
      if (mode == 4) {
        for (usize i = 0; i + 2 < localIndices.size(); i += 3)
          emitTriangle(localIndices[i], localIndices[i + 1], localIndices[i + 2]);
      } else if (mode == 5) {   // TRIANGLE_STRIP
        for (usize i = 0; i + 2 < localIndices.size(); i++) {
          if (i % 2 == 0) emitTriangle(localIndices[i], localIndices[i + 1], localIndices[i + 2]);
          else emitTriangle(localIndices[i + 1], localIndices[i], localIndices[i + 2]);
        }
      } else if (mode == 6) {   // TRIANGLE_FAN
        for (usize i = 1; i + 1 < localIndices.size(); i++)
          emitTriangle(localIndices[0], localIndices[i], localIndices[i + 1]);
      } else {
        ctx.warning += "primitive mode " + std::to_string(mode) +
                       " (points/lines) skipped - NovaForge renders triangles; ";
        continue;
      }
      sub.indexCount = (u32)model->mesh->indices.size() - sub.indexOffset;

      // material
      int materialIndex = primitive["material"].AsInt(-1);
      sub.materialIndex = 0;
      if (options.importMaterials && materialIndex >= 0) {
        const JsonValue& gltfMaterials = ctx.root["materials"];
        JsonValue mat = ((usize)materialIndex < gltfMaterials.Size()) ? gltfMaterials[(usize)materialIndex]
                                                                     : JsonValue();
        std::string matName = mat["name"].AsString("Material" + std::to_string(materialIndex));
        Material m;
        m.name = matName;
        JsonValue pbr = mat["pbrMetallicRoughness"];
        m.baseColor = pbr["baseColorFactor"].AsVec4(Vec4(1, 1, 1, 1));
        m.metallic = pbr["metallicFactor"].AsFloat(1.0f);
        m.roughness = pbr["roughnessFactor"].AsFloat(1.0f);
        m.emissiveColor = mat["emissiveFactor"].AsVec3(Vec3(0, 0, 0));
        if (LengthSq(m.emissiveColor) > 0.001f) m.emissiveStrength = 1.0f;
        m.doubleSided = mat["doubleSided"].AsBool(false);
        std::string alphaMode = mat["alphaMode"].AsString("OPAQUE");
        if (alphaMode == "BLEND" || alphaMode == "MASK") {
          m.opacity = m.baseColor.w;
          if (alphaMode == "MASK") m.opacity = 1.0f;
        }
        JsonValue ext = mat["extensions"];
        if (ext.IsObject() && ext.Has("KHR_materials_unlit")) m.unlit = true;
        int baseTex = pbr["baseColorTexture"]["index"].AsInt(-1);
        int mrTex = pbr["metallicRoughnessTexture"]["index"].AsInt(-1);
        int normalTex = mat["normalTexture"]["index"].AsInt(-1);
        int emissiveTex = mat["emissiveTexture"]["index"].AsInt(-1);
        if (options.importTextures) {
          m.baseColorTexture = ExtractTexture(ctx, baseTex, model->name + "_" + matName + "_Base");
          m.metallicRoughnessTexture = ExtractTexture(ctx, mrTex, model->name + "_" + matName + "_MR");
          m.normalTexture = ExtractTexture(ctx, normalTex, model->name + "_" + matName + "_Normal");
          m.emissiveTexture = ExtractTexture(ctx, emissiveTex, model->name + "_" + matName + "_Emissive");
        }
        if (m.baseColorTexture.empty()) m.baseColor = m.baseColor;   // keep factor
        int existing = -1;
        for (usize mi = 0; mi < model->materials.size(); mi++)
          if (model->materials[mi].name == matName) { existing = (int)mi; break; }
        if (existing >= 0) {
          sub.materialIndex = existing;
        } else {
          sub.materialIndex = (int)model->materials.size();
          model->materials.push_back(m);
        }
      }
      model->mesh->submeshes.push_back(sub);
    }
  }

  // ---------------------------------------------------------------- animations
  const JsonValue& animations = ctx.root["animations"];
  if (options.importAnimations && animations.IsArray() && !ctx.nodeToBone.empty()) {
    for (usize a = 0; a < animations.Size(); a++) {
      JsonValue animation = animations[a];
      AnimationClip clip;
      clip.name = animation["name"].AsString("Animation" + std::to_string(a));
      const JsonValue& channels = animation["channels"];
      const JsonValue& samplers = animation["samplers"];
      for (usize c = 0; c < channels.Size(); c++) {
        JsonValue channel = channels[c];
        int samplerIndex = channel["sampler"].AsInt(-1);
        int nodeIndex = channel["target"]["node"].AsInt(-1);
        std::string targetPath = channel["target"]["path"].AsString("");
        auto boneIt = ctx.nodeToBone.find(nodeIndex);
        if (boneIt == ctx.nodeToBone.end() || samplerIndex < 0 ||
            (usize)samplerIndex >= samplers.Size())
          continue;
        if (targetPath != "translation" && targetPath != "rotation" && targetPath != "scale") continue;

        JsonValue sampler = samplers[(usize)samplerIndex];
        AccessorReader times, values;
        if (!times.Init(&ctx, sampler["input"].AsInt(-1))) continue;
        if (!values.Init(&ctx, sampler["output"].AsInt(-1))) continue;

        AnimationTrack track;
        track.boneIndex = boneIt->second;
        track.path = targetPath == "translation" ? AnimPath::Translation
                                                 : (targetPath == "scale" ? AnimPath::Scale
                                                                          : AnimPath::Rotation);
        usize keys = (usize)times.count;
        for (usize k = 0; k < keys; k++) {
          f32 t = times.Float(k, 0);
          Vec4 v;
          if (track.path == AnimPath::Rotation) v = values.Vec4At(k);
          else {
            Vec3 v3 = values.Vec3At(k);
            v = Vec4(v3.x, v3.y, v3.z, 0.0f);
          }
          track.times.push_back(t);
          track.values.push_back(v);
          if (t > clip.duration) clip.duration = t;
        }
        if (!track.times.empty()) clip.tracks.push_back(std::move(track));
      }
      if (!clip.tracks.empty()) model->animations.push_back(std::move(clip));
    }
  }

  if (anySkinned) {
    model->mesh->hasSkinData = true;
    model->mesh->vertices.clear();   // skinned storage is authoritative
  }

  // ---------------------------------------------------------------- finalise
  if (model->mesh->indices.empty()) {
    result.error = "Unable to load " + fs::FileName(path) +
                   "\nReason: file contains no triangle geometry";
    return result;
  }
  bool needsNormals = false;
  for (auto& v : model->mesh->vertices)
    if (LengthSq(v.normal) < 1e-6f) { needsNormals = true; break; }
  if (!model->mesh->vertices.empty() && needsNormals) model->mesh->RecalculateNormals();
  if (options.generateTangents && !model->mesh->vertices.empty())
    model->mesh->GenerateTangents();
  if (model->materials.empty()) model->materials.push_back(Material::Default());
  for (auto& sm : model->mesh->submeshes)
    if (sm.materialIndex < 0 || sm.materialIndex >= (int)model->materials.size()) sm.materialIndex = 0;
  model->mesh->RecalculateBounds();
  model->mesh->ComputeSubMeshBounds();
  model->importWarning = Trim(ctx.warning);

  result.success = true;
  result.warning = model->importWarning;
  result.models.push_back(model);
  NF_INFO(LogCategory::Asset,
          "Imported %s '%s': %zu verts, %zu tris, %zu material(s), %zu animation(s)",
          fs::Extension(path) == "glb" ? "GLB" : "glTF", fs::FileName(path).c_str(),
          model->mesh->VertexCount(), model->mesh->TriangleCount(), model->materials.size(),
          model->animations.size());
  if (!result.warning.empty())
    NF_WARN(LogCategory::Asset, "Import warnings for %s: %s", fs::FileName(path).c_str(),
            result.warning.c_str());
  return result;
}

} // namespace nf
