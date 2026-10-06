// NovaForge Engine - renderer/SceneExtractor.cpp
#include "renderer/SceneExtractor.h"
#include "scene/Scene.h"
#include "core/Log.h"

namespace nf {

RenderView SceneExtractor::MakeView(const Transform& cameraTransform, f32 fovDegrees, f32 nearZ,
                                    f32 farZ, bool orthographic, f32 orthoSize, f32 aspect,
                                    const Vec3& clearColor) {
  RenderView view;
  view.position = cameraTransform.position;
  view.forward = cameraTransform.Forward();
  view.up = cameraTransform.Up();
  view.nearZ = nearZ;
  view.farZ = farZ;
  view.fovY = fovDegrees * kDegToRad;
  view.clearColor = clearColor;
  view.view = Mat4::LookAt(cameraTransform.position, cameraTransform.position + view.forward, cameraTransform.Up());
  if (orthographic) {
    f32 halfHeight = orthoSize * 0.5f;
    f32 halfWidth = halfHeight * (aspect > 0.0001f ? aspect : 1.0f);
    view.projection = Mat4::Ortho(-halfWidth, halfWidth, -halfHeight, halfHeight, nearZ, farZ);
  } else {
    view.projection = Mat4::Perspective(view.fovY, aspect > 0.0001f ? aspect : 1.0f, nearZ, farZ);
  }
  view.viewProjection = view.projection * view.view;
  view.frustum = Frustum::FromMatrix(view.viewProjection);
  return view;
}

void SceneExtractor::ExtractLights(Scene& scene, RenderScene& out, const Vec3& cameraPosition,
                                   int maxDynamicLights) {
  struct Candidate {
    RenderLight light;
    f32 distance = 0.0f;
    bool directional = false;
  };
  std::vector<Candidate> candidates;
  for (auto& object : scene.AllObjects()) {
    const LightComponent* light = object->Get<LightComponent>();
    if (!light || !object->active) continue;
    Transform world = scene.WorldTransform(object->id);
    Candidate candidate;
    candidate.light.type = light->lightType;
    candidate.light.position = world.position;
    candidate.light.direction = Normalize(world.rotation * Vec3(0, 0, -1));
    candidate.light.color = light->color;
    candidate.light.intensity = light->intensity;
    candidate.light.range = light->range;
    candidate.light.castShadows = light->castShadows;
    candidate.light.shadowBias = light->shadowBias;
    candidate.light.shadowStrength = light->shadowStrength;
    candidate.light.entity = object->id;
    f32 innerRad = Clamp(light->innerAngle, 0.1f, 89.9f) * kDegToRad;
    f32 outerRad = Clamp(std::max(light->outerAngle, light->innerAngle + 0.1f), 0.2f, 89.9f) * kDegToRad;
    candidate.light.innerCos = Cos(innerRad);
    candidate.light.outerCos = Cos(outerRad);
    candidate.directional = light->lightType == 0;
    candidate.distance = candidate.directional ? 0.0f : Distance(world.position, cameraPosition);
    candidates.push_back(candidate);
  }
  // directionals always win; dynamic lights are picked by distance to the camera
  std::sort(candidates.begin(), candidates.end(), [](const Candidate& a, const Candidate& b) {
    if (a.directional != b.directional) return a.directional;
    return a.distance < b.distance;
  });
  int dynamicCount = 0;
  for (auto& candidate : candidates) {
    if (!candidate.directional) {
      if (dynamicCount >= maxDynamicLights) continue;
      dynamicCount++;
    }
    out.lights.push_back(candidate.light);
  }
}

void SceneExtractor::Extract(Scene& scene, const RenderView& view, RenderScene& out,
                            ExtractionStats& stats, const Options& options) {
  out.Clear();
  stats = ExtractionStats{};
  scene.UpdateTransforms();

  const SceneEnvironment& environment = scene.Environment();
  out.ambientColor = environment.ambientColor;
  out.ambientIntensity = environment.ambientIntensity;
  out.skyTop = environment.skyTop;
  out.skyBottom = environment.skyBottom;
  out.showSkybox = environment.showSkybox;
  out.fogEnabled = environment.fogEnabled && options.settings.fogEnabled;
  out.fogColor = environment.fogColor;
  out.fogStart = environment.fogStart;
  out.fogEnd = environment.fogEnd;

  AssetDatabase& assets = scene.Assets();
  ExtractionStats local;

  for (auto& object : scene.AllObjects()) {
    if (!object->active) continue;
    const MeshRendererComponent* renderer = object->Get<MeshRendererComponent>();
    if (!renderer) continue;
    local.totalObjects++;
    if (!renderer->visible) {
      local.invisible++;
      continue;
    }
    std::string meshError;
    std::shared_ptr<Mesh> mesh = renderer->ResolveMesh(assets, &meshError);
    if (!mesh || !mesh->IsValid()) {
      local.missingMesh++;
      if (!meshError.empty())
        NF_ERROR(LogCategory::Render, "%s", meshError.c_str());
      continue;
    }
    if (!meshError.empty()) NF_ERROR(LogCategory::Render, "%s", meshError.c_str());

    Mat4 world = scene.WorldMatrix(object->id);
    AABB worldBounds = AABB::Transform(mesh->bounds, world);
    if (!view.frustum.TestAABB(worldBounds)) {
      local.culled++;
      continue;
    }

    // animation pose (shared between all submeshes of the object)
    std::shared_ptr<const std::vector<Mat4>> boneMatrices;
    if (options.updateAnimationPoses) {
      if (const AnimatorComponent* animator = object->Get<AnimatorComponent>()) {
        std::string clipPath = animator->animationAsset.empty() ? renderer->meshAsset
                                                                : animator->animationAsset;
        auto model = clipPath.empty() ? nullptr : assets.LoadModel(clipPath);
        if (model && model->animations.empty() == false && model->skeleton.IsValid()) {
          f32 duration = model->animations.empty() ? 1.0f : model->animations[0].duration;
          NF_UNUSED(duration);
          AnimationPose pose = AnimationSystem::Evaluate(*model, animator->clipIndex, animator->time);
          if (pose.valid) {
            auto shared = std::make_shared<std::vector<Mat4>>(std::move(pose.boneMatrices));
            boneMatrices = shared;
          }
        }
      }
    }

    Material baseMaterial = renderer->ResolveMaterial(assets);
    usize subMeshCount = mesh->submeshes.empty() ? 1 : mesh->submeshes.size();
    for (usize subIndex = 0; subIndex < subMeshCount; subIndex++) {
      RenderItem item;
      item.entity = object->id;
      item.world = world;
      item.normalMatrix = world.NormalMatrix();
      item.mesh = mesh;
      item.subMeshIndex = (u32)subIndex;
      item.worldBounds = worldBounds;
      item.distanceToCamera = Distance(worldBounds.Center(), view.position);
      item.castShadows = renderer->castShadows && options.settings.shadowsEnabled;
      item.receiveShadows = renderer->receiveShadows;
      item.boneMatrices = boneMatrices;

      // per-submesh material: a model's own materials win over the inline material,
      // the inline material still provides the tint unless a material asset is used.
      Material material = baseMaterial;
      int materialIndex = subIndex < mesh->submeshes.size() ? mesh->submeshes[subIndex].materialIndex : 0;
      if (!renderer->useMaterialFile && !renderer->meshAsset.empty()) {
        auto model = assets.LoadModel(renderer->meshAsset);
        if (model) {
          if (const Material* modelMaterial = model->MaterialAt(materialIndex)) {
            material = *modelMaterial;
            material.castShadows = renderer->castShadows;
            material.receiveShadows = renderer->receiveShadows;
            if (renderer->baseColor != Vec4(0.82f, 0.82f, 0.86f, 1.0f)) {
              material.baseColor = Vec4(material.baseColor.x * renderer->baseColor.x,
                                        material.baseColor.y * renderer->baseColor.y,
                                        material.baseColor.z * renderer->baseColor.z,
                                        material.baseColor.w * renderer->baseColor.w);
            }
          }
        }
      }
      if (renderer->uvTiling != 1.0f) {
        // encoded into the batch key so tiling variations do not share an instance batch
      }
      material.baseColor.w *= renderer->opacity;
      item.material = material;
      item.transparent = material.baseColor.w < 0.999f || material.opacity < 0.999f;
      item.doubleSided = material.doubleSided || material.unlit;

      // batch key: identical mesh + material + tiling can be instanced
      usize hash = std::hash<const void*>()(mesh.get());
      hash ^= std::hash<u32>()((u32)subIndex * 2654435761u);
      hash ^= std::hash<f32>()(material.baseColor.x * 255.0f) << 1;
      hash ^= std::hash<f32>()(material.baseColor.y * 255.0f) << 2;
      hash ^= std::hash<f32>()(material.baseColor.z * 255.0f) << 3;
      hash ^= std::hash<f32>()(material.roughness) << 4;
      hash ^= std::hash<f32>()(material.metallic) << 5;
      hash ^= std::hash<std::string>()(material.baseColorTexture) << 6;
      hash ^= std::hash<std::string>()(material.normalTexture) << 7;
      hash ^= std::hash<f32>()(renderer->uvTiling) << 8;
      hash ^= std::hash<int>()(material.unlit ? 1 : 0) << 9;
      hash ^= std::hash<int>()(item.transparent ? 1 : 0) << 10;
      hash ^= std::hash<int>()(item.boneMatrices ? 1 : 0) << 11;
      item.batchKey = (u32)(hash & 0xFFFFFFFFu);

      if (item.transparent) out.transparentItems.push_back(item);
      else out.items.push_back(item);
      if (local.submitted == 0 || out.items.size() + out.transparentItems.size() > local.submitted)
        local.submitted = out.items.size() + out.transparentItems.size();
    }
  }

  // sort opaque items by batch key (state changes) then front-to-back for early-z
  std::sort(out.items.begin(), out.items.end(), [](const RenderItem& a, const RenderItem& b) {
    if (a.batchKey != b.batchKey) return a.batchKey < b.batchKey;
    return a.distanceToCamera < b.distanceToCamera;
  });
  // transparent items are drawn back-to-front
  std::sort(out.transparentItems.begin(), out.transparentItems.end(),
            [](const RenderItem& a, const RenderItem& b) {
              return a.distanceToCamera > b.distanceToCamera;
            });

  // instancing statistics (how many draws would collapse into an instanced call)
  if (options.settings.instancingEnabled && !out.items.empty()) {
    usize index = 0;
    while (index < out.items.size()) {
      usize end = index;
      while (end < out.items.size() && out.items[end].batchKey == out.items[index].batchKey) end++;
      if (end - index > 1) {
        local.instancedBatches++;
        local.instancedDraws += 1;
      } else {
        local.instancedDraws += 1;
      }
      index = end;
    }
  } else {
    local.instancedDraws = out.items.size() + out.transparentItems.size();
  }

  ExtractLights(scene, out, view.position, options.settings.maxDynamicLights);
  stats = local;
}

} // namespace nf
