// NovaForge Engine - animation/AnimationSystem.h
// Skeletal animation evaluation: turns an AnimationClip at time t into a palette of
// skinning matrices. Runs identically in the editor viewport, in play mode and in
// the exported game.
#pragma once

#include "core/Base.h"
#include "core/Math.h"
#include "assets/Model.h"

namespace nf {

struct AnimationPose {
  std::vector<Mat4> boneMatrices;    // model-space skinning matrices (world * inverseBind)
  bool valid = false;
};

class AnimationSystem {
public:
  // Evaluates the clip at `time` and writes boneMatrices for the model's skeleton.
  static AnimationPose Evaluate(const Model& model, int clipIndex, f32 time);

  // Blends two clips (used for walk->run style transitions).
  static AnimationPose EvaluateBlended(const Model& model, int clipA, f32 timeA, int clipB, f32 timeB,
                                       f32 blend);

  // The bind pose (no animation).
  static AnimationPose BindPose(const Model& model);

  // Total number of animation evaluations performed (diagnostics / tests).
  static u64 EvaluationCount();
  static void ResetStats();
};

} // namespace nf
