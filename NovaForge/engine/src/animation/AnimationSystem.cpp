// NovaForge Engine - animation/AnimationSystem.cpp
#include "animation/AnimationSystem.h"
#include "core/Log.h"

namespace nf {

static u64 g_evaluations = 0;

u64 AnimationSystem::EvaluationCount() { return g_evaluations; }
void AnimationSystem::ResetStats() { g_evaluations = 0; }

// ------------------------------------------------------------------ tracks
f32 AnimationTrack::SampleTranslationOrScale(f32 t, Vec3* out) const {
  if (times.empty() || values.empty()) return 0.0f;
  if (t <= times.front()) {
    *out = values.front().xyz();
    return 0.0f;
  }
  if (t >= times.back()) {
    *out = values.back().xyz();
    return (f32)(times.size() - 1);
  }
  usize index = 1;
  while (index < times.size() && times[index] < t) index++;
  f32 t0 = times[index - 1], t1 = times[index];
  f32 alpha = (t1 - t0) > 1e-6f ? (t - t0) / (t1 - t0) : 0.0f;
  Vec3 a = values[index - 1].xyz();
  Vec3 b = values[index].xyz();
  *out = Lerp(a, b, alpha);
  return (f32)(index - 1) + alpha;
}

Quat AnimationTrack::SampleRotation(f32 t) const {
  if (times.empty() || values.empty()) return Quat::Identity();
  if (t <= times.front()) return Quat(values.front().x, values.front().y, values.front().z, values.front().w).Normalized();
  if (t >= times.back())
    return Quat(values.back().x, values.back().y, values.back().z, values.back().w).Normalized();
  usize index = 1;
  while (index < times.size() && times[index] < t) index++;
  f32 t0 = times[index - 1], t1 = times[index];
  f32 alpha = (t1 - t0) > 1e-6f ? (t - t0) / (t1 - t0) : 0.0f;
  Quat a(values[index - 1].x, values[index - 1].y, values[index - 1].z, values[index - 1].w);
  Quat b(values[index].x, values[index].y, values[index].z, values[index].w);
  return Quat::Slerp(a.Normalized(), b.Normalized(), alpha);
}

// ------------------------------------------------------------------ evaluation
namespace {

void EvaluateLocalTransforms(const Model& model, const AnimationClip* clip, f32 time,
                             std::vector<Transform>& locals) {
  locals.resize(model.skeleton.bones.size());
  for (usize i = 0; i < model.skeleton.bones.size(); i++) locals[i] = model.skeleton.bones[i].localBind;
  if (!clip) return;

  f32 duration = clip->duration > 0.0f ? clip->duration : 1.0f;
  f32 sampleTime = clip->loop ? Fmod(std::max(0.0f, time), duration) : Clamp(time, 0.0f, duration);

  for (const auto& track : clip->tracks) {
    if (track.boneIndex < 0 || (usize)track.boneIndex >= locals.size()) continue;
    Transform& local = locals[(usize)track.boneIndex];
    switch (track.path) {
      case AnimPath::Translation: {
        Vec3 value;
        track.SampleTranslationOrScale(sampleTime, &value);
        local.position = value;
        break;
      }
      case AnimPath::Scale: {
        Vec3 value;
        track.SampleTranslationOrScale(sampleTime, &value);
        local.scale = value;
        break;
      }
      case AnimPath::Rotation:
        local.rotation = track.SampleRotation(sampleTime);
        break;
      default:
        break;
    }
  }
}

void ComputeBoneMatrices(const Model& model, const std::vector<Transform>& locals,
                         std::vector<Mat4>& out) {
  usize count = model.skeleton.bones.size();
  out.assign(count, Mat4::Identity());
  std::vector<Mat4> world(count, Mat4::Identity());
  std::vector<bool> computed(count, false);

  // iterative evaluation with cycle protection
  std::function<Mat4(usize, int)> compute = [&](usize index, int depth) -> Mat4 {
    if (index >= count || depth > 64) return Mat4::Identity();
    if (computed[index]) return world[index];
    Mat4 local = locals[index].Matrix();
    int parent = model.skeleton.bones[index].parent;
    Mat4 parentMatrix = parent >= 0 ? compute((usize)parent, depth + 1) : Mat4::Identity();
    world[index] = parentMatrix * local;
    computed[index] = true;
    return world[index];
  };

  for (usize i = 0; i < count; i++) {
    compute(i, 0);
    out[i] = world[i] * model.skeleton.bones[i].inverseBindMatrix;
  }
}

} // namespace

AnimationPose AnimationSystem::Evaluate(const Model& model, int clipIndex, f32 time) {
  AnimationPose pose;
  if (!model.skeleton.IsValid()) return pose;
  g_evaluations++;
  const AnimationClip* clip = nullptr;
  if (clipIndex >= 0 && (usize)clipIndex < model.animations.size())
    clip = &model.animations[(usize)clipIndex];
  std::vector<Transform> locals;
  EvaluateLocalTransforms(model, clip, time, locals);
  ComputeBoneMatrices(model, locals, pose.boneMatrices);
  pose.valid = true;
  return pose;
}

AnimationPose AnimationSystem::EvaluateBlended(const Model& model, int clipA, f32 timeA, int clipB,
                                               f32 timeB, f32 blend) {
  AnimationPose pose;
  if (!model.skeleton.IsValid()) return pose;
  g_evaluations++;
  blend = Saturate(blend);
  std::vector<Transform> localsA, localsB;
  const AnimationClip* a = (clipA >= 0 && (usize)clipA < model.animations.size())
                               ? &model.animations[(usize)clipA]
                               : nullptr;
  const AnimationClip* b = (clipB >= 0 && (usize)clipB < model.animations.size())
                               ? &model.animations[(usize)clipB]
                               : nullptr;
  EvaluateLocalTransforms(model, a, timeA, localsA);
  EvaluateLocalTransforms(model, b, timeB, localsB);
  std::vector<Transform> blended(localsA.size());
  for (usize i = 0; i < localsA.size(); i++) {
    blended[i].position = Lerp(localsA[i].position, localsB[i].position, blend);
    blended[i].rotation = Quat::Slerp(localsA[i].rotation, localsB[i].rotation, blend);
    blended[i].scale = Lerp(localsA[i].scale, localsB[i].scale, blend);
  }
  ComputeBoneMatrices(model, blended, pose.boneMatrices);
  pose.valid = true;
  return pose;
}

AnimationPose AnimationSystem::BindPose(const Model& model) {
  return Evaluate(model, -1, 0.0f);
}

} // namespace nf
