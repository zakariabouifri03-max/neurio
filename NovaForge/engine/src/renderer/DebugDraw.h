// NovaForge Engine - renderer/DebugDraw.h
// Immediate-mode line/box/sphere overlay used for editor gizmos, collider wireframes,
// AI patrol routes and the runtime's debug view. Collected per frame, drawn by the
// renderer, and also implemented by the software rasterizer (so the head-less
// verification renders the same information).
#pragma once

#include "core/Base.h"
#include "core/Math.h"

namespace nf {

struct DebugLine {
  Vec3 from;
  Vec3 to;
  Vec3 color;
  f32 thickness = 1.0f;
  bool depthTest = true;
  bool overlay = false;   // drawn on top of everything (selection outlines)
};

class DebugDrawList {
public:
  void Clear() { lines_.clear(); }
  bool IsEmpty() const { return lines_.empty(); }
  const std::vector<DebugLine>& Lines() const { return lines_; }

  void AddLine(const Vec3& from, const Vec3& to, const Vec3& color, f32 thickness = 1.0f,
               bool depthTest = true, bool overlay = false) {
    if (lines_.size() >= kMaxLines) return;
    bool isOverlay = overlay || overlayMode_;
    lines_.push_back({from, to, color, thickness, depthTest && !overlayMode_, isOverlay});
  }

  // Everything added between BeginOverlay()/EndOverlay() is drawn on top of the scene
  // (selection outlines, gizmo handles, editor helpers).
  bool BeginOverlay() {
    overlayMode_ = true;
    return true;
  }
  void EndOverlay() { overlayMode_ = false; }
  void AddWireBox(const AABB& box, const Vec3& color, const Quat& rotation = Quat::Identity()) {
    Vec3 corners[8] = {
        {box.min.x, box.min.y, box.min.z}, {box.max.x, box.min.y, box.min.z},
        {box.min.x, box.max.y, box.min.z}, {box.max.x, box.max.y, box.min.z},
        {box.min.x, box.min.y, box.max.z}, {box.max.x, box.min.y, box.max.z},
        {box.min.x, box.max.y, box.max.z}, {box.max.x, box.max.y, box.max.z}};
    if (rotation.x != 0 || rotation.y != 0 || rotation.z != 0 || rotation.w != 1.0f) {
      Vec3 center = box.Center();
      for (auto& corner : corners) corner = rotation * (corner - center) + center;
    }
    const int edges[12][2] = {{0,1},{2,3},{4,5},{6,7},{0,2},{1,3},{4,6},{5,7},{0,4},{1,5},{2,6},{3,7}};
    for (auto& e : edges) AddLine(corners[e[0]], corners[e[1]], color);
  }
  void AddWireSphere(const Vec3& center, f32 radius, const Vec3& color, int segments = 16) {
    for (int axis = 0; axis < 3; axis++) {
      Vec3 previous;
      for (int i = 0; i <= segments; i++) {
        f32 angle = (f32)i / (f32)segments * kTwoPi;
        Vec3 point = center;
        if (axis == 0) { point.x += std::cos(angle) * radius; point.y += std::sin(angle) * radius; }
        else if (axis == 1) { point.y += std::cos(angle) * radius; point.z += std::sin(angle) * radius; }
        else { point.x += std::cos(angle) * radius; point.z += std::sin(angle) * radius; }
        if (i > 0) AddLine(previous, point, color);
        previous = point;
      }
    }
  }
  void AddArrow(const Vec3& from, const Vec3& to, const Vec3& color) {
    AddLine(from, to, color);
    Vec3 direction = Normalize(to - from);
    Vec3 up = Abs(direction.y) > 0.9f ? Vec3(1, 0, 0) : Vec3(0, 1, 0);
    Vec3 right = Normalize(Cross(direction, up));
    Vec3 tip = to - direction * 0.25f;
    AddLine(to, tip + right * 0.12f, color);
    AddLine(to, tip - right * 0.12f, color);
  }
  void AddCircle(const Vec3& center, f32 radius, const Vec3& normal, const Vec3& color,
                 int segments = 32) {
    Vec3 up = Abs(normal.y) > 0.9f ? Vec3(1, 0, 0) : Vec3(0, 1, 0);
    Vec3 right = Normalize(Cross(normal, up));
    Vec3 forward = Cross(normal, right);
    Vec3 previous;
    for (int i = 0; i <= segments; i++) {
      f32 angle = (f32)i / (f32)segments * kTwoPi;
      Vec3 point = center + right * (std::cos(angle) * radius) + forward * (std::sin(angle) * radius);
      if (i > 0) AddLine(previous, point, color);
      previous = point;
    }
  }

private:
  static constexpr usize kMaxLines = 65536;
  std::vector<DebugLine> lines_;
  bool overlayMode_ = false;
};

} // namespace nf
