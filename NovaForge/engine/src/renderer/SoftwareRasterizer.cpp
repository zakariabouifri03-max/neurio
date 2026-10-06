// NovaForge Engine - renderer/SoftwareRasterizer.cpp
#include "renderer/SoftwareRasterizer.h"
#include "assets/AssetDatabase.h"
#include "core/FileSystem.h"
#include "core/Log.h"

namespace nf {

// implemented in ImageImporter.cpp (stb_image_write)
bool WritePng(const std::string& path, const u8* rgba, int width, int height);

bool SoftwareRasterizer::WritePng(const std::string& path, const std::vector<u8>& rgba, int width,
                                  int height) {
  if (rgba.empty() || width <= 0 || height <= 0) return false;
  if (!nf::WritePng(path, rgba.data(), width, height)) {
    NF_ERROR(LogCategory::Render, "Could not write PNG %s", path.c_str());
    return false;
  }
  return true;
}

// -------------------------------------------------------------------- helpers
static Vec3 ShadeAmbientAndLights(const RenderScene& scene, const Vec3& worldPosition,
                                  const Vec3& normal, const Vec3& albedo, const Material& material,
                                  const Vec3& cameraPosition) {
  Vec3 viewDirection = Normalize(cameraPosition - worldPosition);
  f32 metallic = Clamp(material.metallic, 0.0f, 1.0f);
  f32 roughness = Clamp(material.roughness, 0.05f, 1.0f);
  f32 shininess = Lerp(4.0f, 128.0f, 1.0f - roughness);

  Vec3 color = albedo * scene.ambientColor * scene.ambientIntensity;
  for (const auto& light : scene.lights) {
    Vec3 toLight;
    f32 attenuation = 1.0f;
    f32 spotFactor = 1.0f;
    if (light.type == 0) {
      toLight = Normalize(-light.direction);
    } else {
      Vec3 offset = light.position - worldPosition;
      f32 distance = Length(offset);
      if (distance > light.range) continue;
      toLight = distance > 0.0001f ? offset / distance : Vec3(0, 1, 0);
      f32 ratio = Clamp(1.0f - distance / std::max(0.0001f, light.range), 0.0f, 1.0f);
      attenuation = ratio * ratio;
      if (light.type == 2) {
        f32 cosAngle = Dot(-toLight, Normalize(light.direction));
        if (cosAngle < light.outerCos) continue;
        spotFactor = Saturate((cosAngle - light.outerCos) / std::max(0.0001f, light.innerCos - light.outerCos));
      }
    }
    f32 ndotl = std::max(0.0f, Dot(normal, toLight));
    if (ndotl <= 0.0f) continue;
    Vec3 halfVector = Normalize(toLight + viewDirection);
    f32 specular = std::pow(std::max(0.0f, Dot(normal, halfVector)), shininess);
    Vec3 lightColor = light.color * light.intensity * attenuation * spotFactor;
    Vec3 diffuse = albedo * (1.0f - metallic);
    Vec3 specularColor = Lerp(Vec3(0.04f), albedo, metallic);
    color += lightColor * (diffuse * ndotl + specularColor * specular * (1.0f - roughness * 0.7f));
  }
  if (material.emissiveStrength > 0.0f) color += material.emissiveColor * material.emissiveStrength;
  return color;
}

// ------------------------------------------------------------------- render
void SoftwareRasterizer::Clear(const RenderScene& scene, const RenderView& view) {
  color_.resize((usize)width_ * height_ * 4);
  depth_.resize((usize)width_ * height_ * 4);
  for (usize i = 0; i < depth_.size(); i++) depth_[i] = 1.0f;
  NF_UNUSED(scene);
  NF_UNUSED(view);
}

void SoftwareRasterizer::DrawSky(const RenderScene& scene, const RenderView& view,
                                 const RenderSettings& settings) {
  NF_UNUSED(view);
  NF_UNUSED(settings);
  for (int y = 0; y < height_; y++) {
    f32 t = (f32)y / (f32)std::max(1, height_ - 1);
    Vec3 sky = scene.showSkybox ? Lerp(scene.skyTop, scene.skyBottom, t)
                                : scene.fogColor * 0.8f + Vec3(0.05f);
    if (scene.fogEnabled) {
      // fog is applied to geometry; the sky itself stays clear
    }
    u8 r = (u8)(Saturate(sky.x) * 255.0f);
    u8 g = (u8)(Saturate(sky.y) * 255.0f);
    u8 b = (u8)(Saturate(sky.z) * 255.0f);
    for (int x = 0; x < width_; x++) {
      usize index = ((usize)y * width_ + x) * 4;
      color_[index + 0] = r;
      color_[index + 1] = g;
      color_[index + 2] = b;
      color_[index + 3] = 255;
    }
  }
}

Vec4 SoftwareRasterizer::SampleTexture(const std::string& assetPath, const Vec2& uv,
                                       const Vec4& fallback) {
  if (assetPath.empty() || !assets_) return fallback;
  auto texture = assets_->LoadTexture(assetPath);
  if (!texture || !texture->IsValid()) return fallback;
  // wrap + nearest sampling (cheap and deterministic for reference frames)
  f32 u = uv.x - Floor(uv.x);
  f32 v = 1.0f - (uv.y - Floor(uv.y));
  u32 x = (u32)Clamp(u * (f32)texture->width, 0.0f, (f32)(texture->width - 1));
  u32 y = (u32)Clamp(v * (f32)texture->height, 0.0f, (f32)(texture->height - 1));
  usize index = ((usize)y * texture->width + x) * texture->channels;
  if (index + 3 >= texture->pixels.size()) return fallback;
  return Vec4(texture->pixels[index] / 255.0f, texture->pixels[index + 1] / 255.0f,
              texture->pixels[index + 2] / 255.0f, texture->pixels[index + 3] / 255.0f);
}

Vec3 SoftwareRasterizer::ShadeLighting(const Vec3& worldPosition, const Vec3& normal,
                                       const Vec3& albedo, const Material& material) const {
  return ShadeAmbientAndLights(scene_, worldPosition, normal, albedo, material, view_.position);
}

void SoftwareRasterizer::ShadePixel(int x, int y, const VSOut& interpolated, const Vec3& faceNormal,
                                    const Material& material, bool depthWrite) {
  if (x < 0 || y < 0 || x >= width_ || y >= height_) return;
  f32 depth = interpolated.viewDepth;
  if (depth <= 0.0f || depth >= 1.0f) return;
  usize index = (usize)y * width_ + x;
  if (depthWrite) {
    if (depth >= depth_[index]) {
      stats_.depthRejected++;
      return;
    }
    depth_[index] = depth;
  } else {
    if (depth > depth_[index] + 0.002f) return;
  }

  Vec3 normal = LengthSq(interpolated.normal) > 1e-6f ? Normalize(interpolated.normal) : faceNormal;
  if (Dot(normal, Normalize(view_.position - interpolated.world)) < 0.0f && !material.doubleSided)
    normal = -normal;

  Vec3 albedo = material.baseColor.xyz();
  if (!material.baseColorTexture.empty())
    albedo = albedo * SampleTexture(material.baseColorTexture, interpolated.uv,
                                    Vec4(1, 1, 1, 1)).xyz();
  albedo = albedo * interpolated.color;

  Vec3 lit = material.unlit ? albedo
                            : ShadeAmbientAndLights(scene_, interpolated.world, normal, albedo,
                                                    material, view_.position);

  if (scene_.fogEnabled) {
    f32 fogT = Saturate((interpolated.viewDepth * (view_.farZ - view_.nearZ) + view_.nearZ -
                         scene_.fogStart) /
                        std::max(0.0001f, scene_.fogEnd - scene_.fogStart));
    lit = Lerp(lit, scene_.fogColor, fogT);
  }

  f32 alpha = Saturate(material.baseColor.w * material.opacity);
  usize colorIndex = index * 4;
  if (alpha >= 0.999f) {
    color_[colorIndex + 0] = (u8)(Saturate(lit.x) * 255.0f);
    color_[colorIndex + 1] = (u8)(Saturate(lit.y) * 255.0f);
    color_[colorIndex + 2] = (u8)(Saturate(lit.z) * 255.0f);
    color_[colorIndex + 3] = 255;
  } else {
    for (int c = 0; c < 3; c++) {
      f32 existing = color_[colorIndex + c] / 255.0f;
      f32 blended = Lerp(existing, lit[c], alpha);
      color_[colorIndex + c] = (u8)(Saturate(blended) * 255.0f);
    }
  }
  stats_.shadedPixels++;
}

void SoftwareRasterizer::RasterizeTriangle(const VSOut& a, const VSOut& b, const VSOut& c,
                                           const Material& material, bool doubleSided,
                                           bool depthWrite) {
  // perspective divide
  auto toScreen = [&](const VSOut& v, Vec3* out) {
    if (v.clip.w <= 1e-6f) return false;
    f32 invW = 1.0f / v.clip.w;
    f32 ndcX = v.clip.x * invW;
    f32 ndcY = v.clip.y * invW;
    f32 ndcZ = v.clip.z * invW;
    out->x = (ndcX * 0.5f + 0.5f) * (f32)(width_ - 1);
    out->y = (1.0f - (ndcY * 0.5f + 0.5f)) * (f32)(height_ - 1);
    out->z = ndcZ;
    return true;
  };
  Vec3 sa, sb, sc;
  if (!toScreen(a, &sa) || !toScreen(b, &sb) || !toScreen(c, &sc)) return;

  f32 area = (sb.x - sa.x) * (sc.y - sa.y) - (sc.x - sa.x) * (sb.y - sa.y);
  if (Abs(area) < 1e-8f) return;
  if (area > 0.0f && !doubleSided) {
    stats_.backfaceCulled++;
    return;
  }
  if (area < 0.0f && doubleSided) area = -area;

  f32 minX = std::max(0.0f, Floor(std::min(sa.x, std::min(sb.x, sc.x))));
  f32 maxX = std::min((f32)width_ - 1.0f, std::ceil(std::max(sa.x, std::max(sb.x, sc.x))));
  f32 minY = std::max(0.0f, Floor(std::min(sa.y, std::min(sb.y, sc.y))));
  f32 maxY = std::min((f32)height_ - 1.0f, std::ceil(std::max(sa.y, std::max(sb.y, sc.y))));
  if (maxX < minX || maxY < minY) return;

  f32 inverseArea = 1.0f / area;
  Vec3 faceNormal = Normalize(Cross(b.world - a.world, c.world - a.world));

  for (int y = (int)minY; y <= (int)maxY; y++) {
    for (int x = (int)minX; x <= (int)maxX; x++) {
      f32 px = (f32)x + 0.5f, py = (f32)y + 0.5f;
      f32 w0 = ((sb.x - px) * (sc.y - py) - (sc.x - px) * (sb.y - py)) * inverseArea;
      f32 w1 = ((sc.x - px) * (sa.y - py) - (sa.x - px) * (sc.y - py)) * inverseArea;
      f32 w2 = 1.0f - w0 - w1;
      if (w0 < -0.0001f || w1 < -0.0001f || w2 < -0.0001f) continue;

      VSOut interpolated;
      interpolated.clip.w = 1.0f;
      interpolated.viewDepth = w0 * sa.z + w1 * sb.z + w2 * sc.z;
      interpolated.world = a.world * w0 + b.world * w1 + c.world * w2;
      interpolated.normal = a.normal * w0 + b.normal * w1 + c.normal * w2;
      interpolated.uv = a.uv * w0 + b.uv * w1 + c.uv * w2;
      interpolated.color = a.color * w0 + b.color * w1 + c.color * w2;
      ShadePixel(x, y, interpolated, faceNormal, material, depthWrite);
    }
  }
}

void SoftwareRasterizer::ProjectLine(const Vec3& world, Vec3* outScreen, f32* outDepth) const {
  Vec4 clip = view_.viewProjection * Vec4(world, 1.0f);
  if (clip.w <= 1e-6f) {
    *outDepth = 1e9f;
    return;
  }
  f32 invW = 1.0f / clip.w;
  outScreen->x = ((clip.x * invW) * 0.5f + 0.5f) * (f32)(width_ - 1);
  outScreen->y = (1.0f - ((clip.y * invW) * 0.5f + 0.5f)) * (f32)(height_ - 1);
  *outDepth = clip.z * invW;
}

void SoftwareRasterizer::DrawDebugLines(const DebugDrawList& debug, const RenderView& view,
                                        const RenderSettings& settings) {
  NF_UNUSED(view);
  NF_UNUSED(settings);
  for (const auto& line : debug.Lines()) {
    Vec3 from, to;
    f32 depthFrom = 0, depthTo = 0;
    ProjectLine(line.from, &from, &depthFrom);
    ProjectLine(line.to, &to, &depthTo);
    if (depthFrom > 1.0f && depthTo > 1.0f) continue;
    f32 dx = to.x - from.x, dy = to.y - from.y;
    int steps = (int)std::max(Abs(dx), Abs(dy));
    if (steps <= 0) steps = 1;
    if (steps > 4096) steps = 4096;
    for (int i = 0; i <= steps; i++) {
      f32 t = (f32)i / (f32)steps;
      int x = (int)(from.x + dx * t);
      int y = (int)(from.y + dy * t);
      if (x < 0 || y < 0 || x >= width_ || y >= height_) continue;
      f32 depth = Lerp(depthFrom, depthTo, t);
      usize index = (usize)y * width_ + x;
      if (line.depthTest && (depth <= 0.0f || depth >= depth_[index])) continue;
      usize colorIndex = index * 4;
      color_[colorIndex + 0] = (u8)(Saturate(line.color.x) * 255.0f);
      color_[colorIndex + 1] = (u8)(Saturate(line.color.y) * 255.0f);
      color_[colorIndex + 2] = (u8)(Saturate(line.color.z) * 255.0f);
      color_[colorIndex + 3] = 255;
    }
  }
}

bool SoftwareRasterizer::Render(const RenderScene& scene, const RenderView& view,
                                const RenderSettings& settings, const DebugDrawList* debug) {
  width_ = settings.width > 0 ? settings.width : 960;
  height_ = settings.height > 0 ? settings.height : 540;
  if (settings.renderScale > 0.0f && settings.renderScale != 1.0f) {
    width_ = (int)((f32)width_ * settings.renderScale);
    height_ = (int)((f32)height_ * settings.renderScale);
  }
  depth_.resize((usize)width_ * height_);
  stats_ = Stats{};
  scene_ = scene;
  view_ = view;
  view_.viewProjection = view.projection * view.view;

  Clear(scene, view);
  DrawSky(scene, view, settings);

  auto emitItem = [&](const RenderItem& item, bool depthWrite) {
    if (!item.mesh || item.mesh->indices.empty()) return;
    stats_.drawCalls++;
    const std::vector<Vertex>& vertices = item.mesh->vertices;
    const std::vector<SkinnedVertex>& skinned = item.mesh->skinnedVertices;
    bool skinnedPath = item.mesh->hasSkinData && !skinned.empty() && item.boneMatrices;
    usize vertexCount = skinnedPath ? skinned.size() : vertices.size();

    auto fetch = [&](usize index, VSOut* out) {
      Vec3 position;
      Vec3 normal;
      Vec2 uv;
      if (skinnedPath) {
        const SkinnedVertex& v = skinned[index];
        Vec4 skinnedPosition(0, 0, 0, 0);
        Vec3 skinnedNormal(0, 0, 0);
        for (int k = 0; k < 4; k++) {
          f32 weight = v.weights[k];
          if (weight <= 0.0001f) continue;
          usize bone = v.joints[k];
          if (bone >= item.boneMatrices->size()) continue;
          const Mat4& matrix = (*item.boneMatrices)[bone];
          skinnedPosition =
              skinnedPosition + Vec4(matrix.TransformPoint(v.position), 0.0f) * weight;
          skinnedNormal = skinnedNormal + matrix.TransformDir(v.normal) * weight;
        }
        position = item.world.TransformPoint(skinnedPosition.xyz());
        normal = Normalize(item.normalMatrix.TransformDir(skinnedNormal));
        uv = v.uv;
      } else {
        const Vertex& v = vertices[index];
        position = item.world.TransformPoint(v.position);
        normal = Normalize(item.normalMatrix.TransformDir(v.normal));
        uv = v.uv;
      }
      out->world = position;
      out->normal = normal;
      out->uv = uv;
      out->color = Vec3(1, 1, 1);
      Vec4 clip = view_.viewProjection * Vec4(position, 1.0f);
      out->clip = clip;
      out->viewDepth = clip.w > 1e-6f ? clip.z / clip.w : 1.0f;
    };

    usize offset = 0;
    usize count = item.mesh->indices.size();
    if (item.subMeshIndex < item.mesh->submeshes.size()) {
      offset = item.mesh->submeshes[item.subMeshIndex].indexOffset;
      count = item.mesh->submeshes[item.subMeshIndex].indexCount;
    }
    bool doubleSided = item.doubleSided;
    for (usize i = 0; i + 2 < count; i += 3) {
      u32 i0 = item.mesh->indices[offset + i];
      u32 i1 = item.mesh->indices[offset + i + 1];
      u32 i2 = item.mesh->indices[offset + i + 2];
      if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) continue;
      VSOut a, b, c;
      fetch(i0, &a);
      fetch(i1, &b);
      fetch(i2, &c);
      // trivial clip rejection
      if ((a.clip.w <= 0 && b.clip.w <= 0 && c.clip.w <= 0)) continue;
      stats_.triangles++;
      RasterizeTriangle(a, b, c, item.material, doubleSided, depthWrite);
      stats_.rasterized++;
    }
  };

  for (const auto& item : scene.items) emitItem(item, true);
  for (const auto& item : scene.transparentItems) emitItem(item, false);

  if (debug && settings.showGizmos) DrawDebugLines(*debug, view, settings);
  return true;
}

} // namespace nf
