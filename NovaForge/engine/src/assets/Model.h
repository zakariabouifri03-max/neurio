// NovaForge Engine - assets/Model.h
// A model asset: combined geometry + material slots + optional skeleton/animations.
#pragma once

#include "core/Base.h"
#include "assets/Mesh.h"
#include "assets/Material.h"
#include "assets/Texture.h"

namespace nf {

struct Bone {
  std::string name;
  int parent = -1;
  Mat4 inverseBindMatrix = Mat4::Identity();
  Transform localBind;               // bind pose local transform
};

struct Skeleton {
  std::vector<Bone> bones;
  bool IsValid() const { return !bones.empty(); }
  int FindBone(const std::string& name) const {
    for (usize i = 0; i < bones.size(); i++) if (bones[i].name == name) return (int)i;
    return -1;
  }
};

enum class AnimPath { Translation = 0, Rotation, Scale, Weights };

struct AnimationTrack {
  int boneIndex = -1;                // index into Skeleton::bones
  AnimPath path = AnimPath::Rotation;
  std::vector<f32> times;            // seconds
  std::vector<Vec4> values;          // xyz = translation/scale, xyzw = quaternion (dense storage)
  f32 SampleTranslationOrScale(f32 t, Vec3* out) const;
  Quat SampleRotation(f32 t) const;
};

struct AnimationClip {
  std::string name = "Clip";
  f32 duration = 0.0f;
  std::vector<AnimationTrack> tracks;
  bool loop = true;
};

// The result of importing a mesh file. One Model == one .glb/.gltf/.obj/.fbx asset.
struct Model {
  std::string name;
  std::string sourcePath;
  std::shared_ptr<Mesh> mesh;
  std::vector<Material> materials;              // material slot table (index = slot)
  std::vector<std::shared_ptr<Texture>> textures;
  Skeleton skeleton;
  std::vector<AnimationClip> animations;
  std::string importWarning;                    // non-fatal import problems (shown in Console)

  bool HasAnimations() const { return !animations.empty() && skeleton.IsValid(); }
  const Material* MaterialAt(int index) const {
    if (index < 0 || index >= (int)materials.size()) return nullptr;
    return &materials[(usize)index];
  }
};

} // namespace nf
