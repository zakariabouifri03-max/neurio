// NovaForge Engine - editor/EditorViewport.cpp
// The 3D viewport: renders the scene through the shared renderer into an offscreen
// target, handles editor camera navigation (orbit / pan / zoom / fly), mouse picking,
// the move / rotate / scale gizmos with snapping, the ground grid, object wireframes
// and asset drag & drop into the world.
#include "editor/EditorApp.h"
#include "core/StringUtil.h"
#include "core/Log.h"
#include "platform/Platform.h"

#include "imgui.h"
#include "imgui_internal.h"

#include <algorithm>

namespace nf {

namespace {

constexpr f32 kGizmoScreenRadius = 90.0f;
constexpr f32 kGizmoHitPixels = 9.0f;

Vec2 Vec2FromIm(const ImVec2& v) { return Vec2(v.x, v.y); }
} // namespace

void EditorApp::DrawViewportPanel() {
  if (!ctx_.HasProject()) return;
  ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
  bool open = ImGui::Begin("Viewport", &ctx_.showViewport, ImGuiWindowFlags_NoScrollbar |
                                                              ImGuiWindowFlags_NoScrollWithMouse);
  ImGui::PopStyleVar();
  if (!open) {
    ImGui::End();
    return;
  }

  ImVec2 size = ImGui::GetContentRegionAvail();
  ImVec2 origin = ImGui::GetCursorScreenPos();
  ViewportRect rect;
  rect.x = origin.x;
  rect.y = origin.y;
  rect.width = std::max(16.0f, size.x);
  rect.height = std::max(16.0f, size.y);
  rect.valid = true;
  lastViewport_ = rect;

  int width = (int)rect.width;
  int height = (int)rect.height;
  f32 aspect = (f32)width / (f32)std::max(1, height);

  RenderSettings settings;
  settings.width = width;
  settings.height = height;
  settings.quality = ctx_.qualityLevel;
  settings.shadowsEnabled = ctx_.shadowsEnabled;
  settings.wireframe = ctx_.renderWireframe;
  settings.showGrid = ctx_.showGrid;
  settings.showGizmos = true;
  settings.vsync = false;

  // ---- render the scene into an offscreen target
  RenderView view = ctx_.playing && ctx_.runtime ? ctx_.runtime->MakeGameView(aspect)
                                                 : MakeEditorView(aspect);
  BuildViewportDebugDraw(view);

  RenderScene renderScene;
  if (ctx_.playing && ctx_.runtime) {
    ctx_.runtime->ExtractRenderScene(view, renderScene, settings);
  } else {
    SceneExtractor::Options options;
    options.settings = settings;
    options.editorMode = true;
    options.updateAnimationPoses = true;
    ExtractionStats stats;
    SceneExtractor::Extract(ctx_.scene, view, renderScene, stats, options);
  }

  bool targetOk = ctx_.renderer->BeginTarget(width, height);
  ctx_.renderer->BeginFrame(settings);
  ctx_.renderer->RenderScene(renderScene, view, settings, &ctx_.debugDraw);
  u64 texture = targetOk ? ctx_.renderer->EndTarget() : 0;
  ctx_.renderer->EndFrame(false);

  if (texture != 0) {
    ImGui::Image((ImTextureID)(intptr_t)texture, ImVec2(rect.width, rect.height), ImVec2(0, 1),
                 ImVec2(1, 0));
  } else {
    ImGui::Dummy(ImVec2(rect.width, rect.height));
    ImGui::TextColored(ImVec4(1, 0.5f, 0.5f, 1), "Offscreen rendering unavailable");
  }
  ImGui::SetCursorScreenPos(origin);
  ImGui::InvisibleButton("##viewportinput", ImVec2(rect.width, rect.height),
                         ImGuiButtonFlags_MouseButtonLeft | ImGuiButtonFlags_MouseButtonRight |
                             ImGuiButtonFlags_MouseButtonMiddle);
  bool hovered = ImGui::IsItemHovered();

  HandleViewportNavigation(rect, hovered);
  if (!ctx_.playing) {
    HandleViewportPicking(rect);
    HandleGizmoInteraction(rect, view);
  }
  DrawViewportOverlay(rect);

  // drag & drop an asset from the browser into the world
  if (ImGui::BeginDragDropTarget()) {
    if (const ImGuiPayload* payload = ImGui::AcceptDragDropPayload("NF_ASSET")) {
      std::string assetPath((const char*)payload->Data, (usize)payload->DataSize - 1);
      Vec2 mouse = Vec2FromIm(ImGui::GetMousePos());
      Ray ray;
      Vec3 point = ctx_.cameraTarget;
      if (ScreenRay(rect, view, mouse, &ray)) {
        f32 t = 0.0f;
        if (RaycastPlane(ray, Vec3(0, 0, 0), Vec3(0, 1, 0), &t) && t > 0.0f) point = ray.At(t);
        else point = ray.At(10.0f);
      }
      ctx_.CommandSpawnAsset(assetPath, point);
    }
    ImGui::EndDragDropTarget();
  }

  if (!ImGui::IsItemHovered() && gizmoDrag_.active) gizmoDrag_.active = false;
  ImGui::End();
}

RenderView EditorApp::MakeEditorView(f32 aspect) const {
  f32 yaw = ctx_.cameraYaw * kDegToRad;
  f32 pitch = ctx_.cameraPitch * kDegToRad;
  Vec3 offset(Cos(pitch) * Sin(yaw) * ctx_.cameraDistance, Sin(pitch) * ctx_.cameraDistance,
              Cos(pitch) * Cos(yaw) * ctx_.cameraDistance);
  Vec3 position = ctx_.cameraTarget + offset;
  if (position.y < 0.1f) position.y = 0.1f;   // never go under the ground plane

  RenderView view;
  view.view = Mat4::LookAt(position, ctx_.cameraTarget, Vec3(0, 1, 0));
  if (ctx_.cameraOrthographic) {
    f32 halfHeight = ctx_.cameraOrthoHeight;
    view.projection = Mat4::Ortho(-halfHeight * aspect, halfHeight * aspect, -halfHeight,
                                  halfHeight, -1000.0f, 2000.0f);
  } else {
    view.projection = Mat4::Perspective(ctx_.cameraFov * kDegToRad, aspect, 0.05f, 4000.0f);
  }
  view.position = position;
  view.forward = Normalize(ctx_.cameraTarget - position);
  view.up = Vec3(0, 1, 0);
  view.nearZ = 0.05f;
  view.farZ = 4000.0f;
  view.fovY = ctx_.cameraFov * kDegToRad;
  view.clearColor = Vec3(0.10f, 0.11f, 0.13f);
  Vec3 right = Normalize(Cross(view.forward, view.up));
  Vec3 up = Cross(right, view.forward);
  view.frustum = Frustum::FromMatrix(view.projection * view.view);
  NF_UNUSED(up);
  return view;
}

void EditorApp::UpdateEditorCamera(f32 deltaTime) {
  NF_UNUSED(deltaTime);
}

void EditorApp::HandleViewportNavigation(ViewportRect rect, bool hovered) {
  ImGuiIO& io = ImGui::GetIO();

  // frame the viewport while playing: capture the mouse when clicked
  if (ctx_.playing && hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left) &&
      !ctx_.window->IsMouseCaptured()) {
    ctx_.window->SetMouseCaptured(true);
  }

  if (ctx_.playing && ctx_.window->IsMouseCaptured()) {
    // look around with the raw mouse delta
    Vec2 delta = ctx_.window->Input().MouseDelta();
    if (Abs(delta.x) > 0.0f || Abs(delta.y) > 0.0f) {
      // the runtime reads the mouse itself; nothing to do here
    }
    return;
  }

  if (!hovered && !ImGui::IsMouseDragging(ImGuiMouseButton_Right) &&
      !ImGui::IsMouseDragging(ImGuiMouseButton_Middle)) {
    return;
  }

  Vec2 delta = Vec2FromIm(io.MouseDelta);
  bool rightDown = ImGui::IsMouseDown(ImGuiMouseButton_Right);
  bool middleDown = ImGui::IsMouseDown(ImGuiMouseButton_Middle);

  if (rightDown) {
    // orbit (or mouselook while flying with WASD)
    ctx_.cameraYaw += delta.x * 0.25f;
    ctx_.cameraPitch = Clamp(ctx_.cameraPitch - delta.y * 0.25f, -88.0f, 88.0f);
  } else if (middleDown) {
    // pan: move the orbit target in the camera plane
    f32 scale = ctx_.cameraDistance * 0.0016f * (ctx_.cameraOrthographic ? 1.6f : 1.0f);
    f32 yaw = ctx_.cameraYaw * kDegToRad;
    f32 pitch = ctx_.cameraPitch * kDegToRad;
    Vec3 forward(-Cos(pitch) * Sin(yaw), -Sin(pitch), -Cos(pitch) * Cos(yaw));
    Vec3 right = Normalize(Cross(forward, Vec3(0, 1, 0)));
    Vec3 up = Normalize(Cross(right, forward));
    ctx_.cameraTarget = ctx_.cameraTarget - right * (delta.x * scale) + up * (delta.y * scale);
  }

  if (hovered && Abs(io.MouseWheel) > 0.0f) {
    if (ctx_.cameraOrthographic) {
      ctx_.cameraOrthoHeight = Clamp(ctx_.cameraOrthoHeight * (1.0f - io.MouseWheel * 0.12f), 0.5f, 400.0f);
    } else {
      ctx_.cameraDistance = Clamp(ctx_.cameraDistance * (1.0f - io.MouseWheel * 0.12f), 0.5f, 500.0f);
    }
  }

  // WASD free-fly while the right mouse button is held
  if (rightDown && hovered) {
    f32 speed = ctx_.cameraFlySpeed * (io.KeyShift ? 3.0f : 1.0f) * (io.DeltaTime > 0 ? io.DeltaTime * 60.0f : 1.0f);
    f32 yaw = ctx_.cameraYaw * kDegToRad;
    f32 pitch = ctx_.cameraPitch * kDegToRad;
    Vec3 forward(-Cos(pitch) * Sin(yaw), -Sin(pitch), -Cos(pitch) * Cos(yaw));
    Vec3 right = Normalize(Cross(forward, Vec3(0, 1, 0)));
    Vec3 movement(0, 0, 0);
    if (ImGui::IsKeyDown(ImGuiKey_W)) movement = movement + forward;
    if (ImGui::IsKeyDown(ImGuiKey_S)) movement = movement - forward;
    if (ImGui::IsKeyDown(ImGuiKey_D)) movement = movement + right;
    if (ImGui::IsKeyDown(ImGuiKey_A)) movement = movement - right;
    if (ImGui::IsKeyDown(ImGuiKey_Q)) movement = movement - Vec3(0, 1, 0);
    if (ImGui::IsKeyDown(ImGuiKey_E)) movement = movement + Vec3(0, 1, 0);
    if (LengthSq(movement) > 0.0f) {
      ctx_.cameraTarget = ctx_.cameraTarget + Normalize(movement) * (speed * 0.35f);
      ctx_.cameraFlying = true;
    }
  }

  // F focuses the selection (also available when the viewport is hovered)
  if (hovered && !io.WantTextInput && ImGui::IsKeyPressed(ImGuiKey_F, false)) ctx_.FocusSelection();
}

bool EditorApp::ScreenRay(const ViewportRect& rect, const RenderView& view, const Vec2& mouse,
                          Ray* out) const {
  if (rect.width <= 1.0f || rect.height <= 1.0f) return false;
  f32 ndcX = ((mouse.x - rect.x) / rect.width) * 2.0f - 1.0f;
  f32 ndcY = 1.0f - ((mouse.y - rect.y) / rect.height) * 2.0f;
  Mat4 inverseProjection = view.projection.Inverse();
  Mat4 inverseView = view.view.Inverse();
  Vec4 nearPoint = inverseProjection * Vec4(ndcX, ndcY, -1.0f, 1.0f);
  Vec4 farPoint = inverseProjection * Vec4(ndcX, ndcY, 1.0f, 1.0f);
  Vec3 nearWorld = inverseView.TransformPoint(Vec3(nearPoint.x / nearPoint.w, nearPoint.y / nearPoint.w,
                                                   nearPoint.z / nearPoint.w));
  Vec3 farWorld = inverseView.TransformPoint(
      Vec3(farPoint.x / farPoint.w, farPoint.y / farPoint.w, farPoint.z / farPoint.w));
  out->origin = view.position;
  out->direction = Normalize(farWorld - nearWorld);
  return true;
}

bool EditorApp::PickObject(const ViewportRect& rect, const RenderView& view, const Vec2& mouse,
                           EntityId* outId) const {
  Ray ray;
  if (!ScreenRay(rect, view, mouse, &ray)) return false;
  f32 bestDistance = 1e30f;
  EntityId best = 0;
  for (const auto& object : ctx_.scene.AllObjects()) {
    if (!object->active) continue;
    if (!object->Has(MeshRendererComponent::kTypeName) && !object->Has(ColliderComponent::kTypeName))
      continue;
    AABB bounds = ctx_.scene.WorldBounds(object->id);
    if (!bounds.IsValid()) continue;
    f32 distance = 0.0f;
    if (RaycastAABB(ray, bounds.Expanded(0.01f), &distance) && distance < bestDistance) {
      bestDistance = distance;
      best = object->id;
    }
  }
  if (best != 0) {
    *outId = best;
    return true;
  }
  return false;
}

void EditorApp::HandleViewportPicking(ViewportRect rect) {
  if (!ImGui::IsItemHovered() && !ImGui::IsWindowHovered()) return;
  if (gizmoDrag_.active) return;
  if (!ImGui::IsMouseClicked(ImGuiMouseButton_Left)) return;
  if (ImGui::GetIO().KeyAlt) return;

  // do not pick when the click is on the gizmo (handled by HandleGizmoInteraction)
  if (ImGui::IsAnyItemHovered()) return;

  Vec2 mouse = Vec2FromIm(ImGui::GetMousePos());
  f32 aspect = rect.width / std::max(1.0f, rect.height);
  RenderView view = MakeEditorView(aspect);
  EntityId picked = 0;
  if (PickObject(rect, view, mouse, &picked)) {
    ctx_.Select(picked, ImGui::GetIO().KeyCtrl);
  } else if (!ImGui::GetIO().KeyCtrl) {
    ctx_.Deselect();
  }
}

void EditorApp::BuildViewportDebugDraw(const RenderView& view) {
  ctx_.debugDraw.Clear();

  // ---- ground grid
  if (ctx_.showGrid) {
    const int halfLines = 40;
    const f32 spacing = 1.0f;
    Vec3 gridColor(0.24f, 0.26f, 0.30f);
    Vec3 majorColor(0.32f, 0.35f, 0.40f);
    for (int i = -halfLines; i <= halfLines; i++) {
      f32 offset = (f32)i * spacing;
      bool major = (i % 10 == 0);
      ctx_.debugDraw.AddLine(Vec3(offset, 0.0f, -(f32)halfLines * spacing),
                             Vec3(offset, 0.0f, (f32)halfLines * spacing),
                             major ? majorColor : gridColor);
      ctx_.debugDraw.AddLine(Vec3(-(f32)halfLines * spacing, 0.0f, offset),
                             Vec3((f32)halfLines * spacing, 0.0f, offset),
                             i == 0 ? Vec3(0.45f, 0.30f, 0.32f) : (major ? majorColor : gridColor));
    }
    ctx_.debugDraw.AddLine(Vec3(-2, 0.02f, 0), Vec3(2, 0.02f, 0), Vec3(0.85f, 0.30f, 0.32f));
    ctx_.debugDraw.AddLine(Vec3(0, 0.02f, -2), Vec3(0, 0.02f, 2), Vec3(0.35f, 0.55f, 0.95f));
    ctx_.debugDraw.AddLine(Vec3(0, 0.02f, 0), Vec3(0, 2, 0), Vec3(0.40f, 0.85f, 0.45f));
  }

  // ---- selection outlines / component gizmos
  if (ctx_.showColliders) {
    for (const auto& object : ctx_.scene.AllObjects()) {
      if (ColliderComponent* collider = object->Get<ColliderComponent>()) {
        if (collider->visibleInEditor) collider->DrawEditorGizmos(ctx_.scene);
      }
      if (ctx_.IsSelected(object->id)) {
        for (const auto& component : object->components) {
          if (component) component->DrawEditorGizmos(ctx_.scene);
        }
      }
    }
  }

  // selection bounding box
  if (ctx_.HasSelection()) {
    AABB bounds = ctx_.SelectionBounds();
    Vec3 color(1.0f, 0.68f, 0.18f);
    ctx_.debugDraw.AddWireBox(bounds, color);
  }

  // ---- gizmo geometry for the active object
  if (!ctx_.playing) DrawGizmoGeometry(view);
}

void EditorApp::DrawGizmoGeometry(const RenderView& view) {
  if (ctx_.selection.empty()) return;
  if (!ctx_.debugDraw.BeginOverlay()) return;

  Vec3 origin = ctx_.SelectionCenter();
  Transform reference = ctx_.scene.WorldTransform(ctx_.active != 0 ? ctx_.active : ctx_.PrimarySelection());
  Mat4 rotationMatrix = Mat4::Identity();
  if (ctx_.space == TransformSpace::Local) rotationMatrix = Mat4::TRS(Vec3(0, 0, 0), reference.rotation, Vec3(1, 1, 1));

  f32 distance = Length(origin - view.position);
  f32 scale = std::max(0.35f, distance * 0.12f);

  Vec3 axes[3] = {Vec3(1, 0, 0), Vec3(0, 1, 0), Vec3(0, 0, 1)};
  Vec3 colors[3] = {Vec3(0.95f, 0.30f, 0.32f), Vec3(0.45f, 0.90f, 0.42f), Vec3(0.35f, 0.60f, 1.0f)};
  for (int i = 0; i < 3; i++) {
    Vec3 axis = rotationMatrix.TransformDir(axes[i]);
    Vec3 tip = origin + axis * scale;
    Vec3 color = colors[i];
    bool highlighted = gizmoDrag_.active ? gizmoDrag_.axis == i : false;
    if (highlighted) color = Vec3(1.0f, 0.95f, 0.35f);
    ctx_.debugDraw.AddLine(origin, tip, color, 2.0f, false, true);

    if (ctx_.gizmoMode == GizmoMode::Translate) {
      Vec3 right = Normalize(Cross(axis, Vec3(0, 1, 0)));
      if (LengthSq(right) < 0.01f) right = Normalize(Cross(axis, Vec3(0, 0, 1)));
      Vec3 up = Normalize(Cross(right, axis));
      f32 head = scale * 0.16f;
      Vec3 base = tip - axis * head;
      ctx_.debugDraw.AddLine(tip, base + right * head * 0.6f, color, 2.0f, false, true);
      ctx_.debugDraw.AddLine(tip, base - right * head * 0.6f, color, 2.0f, false, true);
      ctx_.debugDraw.AddLine(tip, base + up * head * 0.6f, color, 2.0f, false, true);
      ctx_.debugDraw.AddLine(tip, base - up * head * 0.6f, color, 2.0f, false, true);
    } else if (ctx_.gizmoMode == GizmoMode::Scale) {
      Vec3 right = Normalize(Cross(axis, Vec3(0, 1, 0)));
      if (LengthSq(right) < 0.01f) right = Normalize(Cross(axis, Vec3(0, 0, 1)));
      Vec3 up = Normalize(Cross(right, axis));
      f32 head = scale * 0.10f;
      ctx_.debugDraw.AddLine(tip, tip - axis * head + right * head, color, 2.0f, false, true);
      ctx_.debugDraw.AddLine(tip, tip - axis * head - right * head, color, 2.0f, false, true);
      ctx_.debugDraw.AddLine(tip, tip - axis * head + up * head, color, 2.0f, false, true);
      ctx_.debugDraw.AddLine(tip, tip - axis * head - up * head, color, 2.0f, false, true);
    } else {
      // rotation: a circle around the axis
      Vec3 right = Normalize(Cross(axis, Vec3(0, 1, 0)));
      if (LengthSq(right) < 0.01f) right = Normalize(Cross(axis, Vec3(0, 0, 1)));
      Vec3 up = Normalize(Cross(right, axis));
      const int segments = 40;
      for (int s = 0; s < segments; s++) {
        f32 a0 = (f32)s / segments * 6.28318530718f;
        f32 a1 = (f32)(s + 1) / segments * 6.28318530718f;
        Vec3 p0 = origin + (right * Cos(a0) + up * Sin(a0)) * scale;
        Vec3 p1 = origin + (right * Cos(a1) + up * Sin(a1)) * scale;
        ctx_.debugDraw.AddLine(p0, p1, color, 2.0f, false, true);
      }
    }
  }
  // centre handle (uniform scale)
  ctx_.debugDraw.AddLine(origin - Vec3(0.03f), origin + Vec3(0.03f), Vec3(1.0f, 1.0f, 1.0f), 2.0f,
                         false, true);
  {
    AABB handle;
    handle.min = origin - Vec3(0.06f);
    handle.max = origin + Vec3(0.06f);
    ctx_.debugDraw.AddWireBox(handle, gizmoDrag_.active && gizmoDrag_.axis == 3
                                          ? Vec3(1.0f, 0.95f, 0.35f)
                                          : Vec3(0.9f, 0.9f, 0.9f));
  }
  ctx_.debugDraw.EndOverlay();
}

void EditorApp::HandleGizmoInteraction(ViewportRect rect, const RenderView& view) {
  if (ctx_.selection.empty()) return;
  bool hovered = ImGui::IsItemHovered() || ImGui::IsWindowHovered();
  Vec2 mouse = Vec2FromIm(ImGui::GetMousePos());

  Vec3 origin = ctx_.SelectionCenter();
  Transform reference = ctx_.scene.WorldTransform(ctx_.active != 0 ? ctx_.active : ctx_.PrimarySelection());
  Mat4 rotationMatrix = Mat4::Identity();
  if (ctx_.space == TransformSpace::Local)
    rotationMatrix = Mat4::TRS(Vec3(0, 0, 0), reference.rotation, Vec3(1, 1, 1));
  f32 distance = Length(origin - view.position);
  f32 scale = std::max(0.35f, distance * 0.12f);

  Vec3 axes[3] = {Vec3(1, 0, 0), Vec3(0, 1, 0), Vec3(0, 0, 1)};
  Vec3 axisDirections[3];
  for (int i = 0; i < 3; i++) axisDirections[i] = Normalize(rotationMatrix.TransformDir(axes[i]));

  // ---- pick the axis under the cursor in screen space
  auto project = [&](const Vec3& world, Vec2* out) {
    Vec4 clip = view.projection * view.view * Vec4(world, 1.0f);
    if (clip.w <= 0.0001f) return false;
    f32 invW = 1.0f / clip.w;
    out->x = rect.x + ((clip.x * invW) * 0.5f + 0.5f) * rect.width;
    out->y = rect.y + (1.0f - ((clip.y * invW) * 0.5f + 0.5f)) * rect.height;
    return true;
  };
  auto distanceToSegment = [](const Vec2& p, const Vec2& a, const Vec2& b) {
    Vec2 ab = b - a;
    f32 lengthSq = Dot(ab, ab);
    if (lengthSq < 0.0001f) return Length(p - a);
    f32 t = Clamp(Dot(p - a, ab) / lengthSq, 0.0f, 1.0f);
    Vec2 closest = a + ab * t;
    return Length(p - closest);
  };

  int hoveredAxis = -1;
  f32 bestDistance = kGizmoHitPixels;
  if (hovered && !gizmoDrag_.active) {
    Vec2 originScreen;
    if (project(origin, &originScreen)) {
      for (int i = 0; i < 3; i++) {
        Vec2 tipScreen;
        if (!project(origin + axisDirections[i] * scale, &tipScreen)) continue;
        f32 d = distanceToSegment(mouse, originScreen, tipScreen);
        if (ctx_.gizmoMode == GizmoMode::Rotate) {
          // rotation handles: highlight when the cursor is near the ring
          d = Abs(d - 0.0f);
        }
        if (d < bestDistance) {
          bestDistance = d;
          hoveredAxis = i;
        }
      }
      // uniform-scale handle at the center
      if (ctx_.gizmoMode == GizmoMode::Scale && distanceToSegment(mouse, originScreen, originScreen) < kGizmoHitPixels) {
        hoveredAxis = 3;
      }
    }
  }
  if (gizmoDrag_.active) hoveredAxis = gizmoDrag_.axis;

  // ---- start dragging
  if (hoveredAxis >= 0 && ImGui::IsMouseClicked(ImGuiMouseButton_Left) && !gizmoDrag_.active) {
    gizmoDrag_.active = true;
    gizmoDrag_.axis = hoveredAxis;
    gizmoDrag_.targets = ctx_.selection;
    gizmoDrag_.startPosition = origin;
    gizmoDrag_.label = std::string(GizmoModeName(ctx_.gizmoMode)) + " " +
                       (hoveredAxis == 3 ? "uniform" : (hoveredAxis == 0 ? "X" : (hoveredAxis == 1 ? "Y" : "Z")));
    ctx_.BeginEdit(gizmoDrag_.label);
    if (ctx_.selection.size() >= 1) {
      Transform world = ctx_.scene.WorldTransform(ctx_.PrimarySelection());
      gizmoDrag_.startRotationEuler = world.rotation.EulerDegrees();
      gizmoDrag_.startScale = world.scale;
      gizmoDrag_.startHitPoint = origin;
    }
  }

  if (!gizmoDrag_.active) return;

  // ---- drag maths
  Ray ray;
  if (!ScreenRay(rect, view, mouse, &ray)) return;

  if (ctx_.gizmoMode == GizmoMode::Translate || ctx_.gizmoMode == GizmoMode::Scale) {
    int axisIndex = gizmoDrag_.axis == 3 ? 1 : gizmoDrag_.axis;
    Vec3 axis = axisDirections[axisIndex];
    // closest point between the mouse ray and the gizmo axis line
    Vec3 u = axis;
    Vec3 v = ray.direction;
    Vec3 w0 = origin - ray.origin;
    f32 a = Dot(u, u);
    f32 b = Dot(u, v);
    f32 c = Dot(v, v);
    f32 d = Dot(u, w0);
    f32 e = Dot(v, w0);
    f32 denominator = a * c - b * b;
    f32 t = Abs(denominator) > 1e-6f ? (b * e - c * d) / denominator : 0.0f;
    Vec3 point = origin + axis * t;
    if (ImGui::IsMouseDragging(ImGuiMouseButton_Left, 0.0f)) {
      if (gizmoDrag_.axis == 3) {
        f32 startDistance = std::max(0.001f, Length(gizmoDrag_.startHitPoint - origin));
        f32 currentDistance = Length(point - origin);
        f32 factor = startDistance > 0.0f ? currentDistance / startDistance : 1.0f;
        if (factor < 0.01f) factor = 0.01f;
        for (EntityId id : gizmoDrag_.targets) {
          GameObject* object = ctx_.scene.Get(id);
          if (!object) continue;
          Transform world = ctx_.scene.WorldTransform(id);
          Vec3 newScale = gizmoDrag_.startScale * factor;
          if (ctx_.snapEnabled && ctx_.scaleSnap > 0.0f) {
            newScale.x = Round(newScale.x / ctx_.scaleSnap) * ctx_.scaleSnap;
            newScale.y = Round(newScale.y / ctx_.scaleSnap) * ctx_.scaleSnap;
            newScale.z = Round(newScale.z / ctx_.scaleSnap) * ctx_.scaleSnap;
          }
          world.scale = newScale;
          ctx_.scene.SetWorldTransform(id, world);
        }
      } else {
        Vec3 delta = point - gizmoDrag_.startHitPoint;
        if (ctx_.snapEnabled && ctx_.translateSnap > 0.0f) {
          delta.x = Round(delta.x / ctx_.translateSnap) * ctx_.translateSnap;
          delta.y = Round(delta.y / ctx_.translateSnap) * ctx_.translateSnap;
          delta.z = Round(delta.z / ctx_.translateSnap) * ctx_.translateSnap;
        }
        if (gizmoDrag_.startPosition != gizmoDrag_.startHitPoint) {
          delta = delta - (delta - (point - gizmoDrag_.startHitPoint));
        }
        for (EntityId id : gizmoDrag_.targets) {
          GameObject* object = ctx_.scene.Get(id);
          if (!object) continue;
          Transform world = ctx_.scene.WorldTransform(id);
          world.position = world.position + delta;
          ctx_.scene.SetWorldTransform(id, world);
        }
        gizmoDrag_.startHitPoint = point;
      }
    }
  } else {
    // rotation: intersect with the plane perpendicular to the axis
    int axisIndex = gizmoDrag_.axis;
    Vec3 axis = axisDirections[axisIndex];
    f32 t = 0.0f;
    if (RaycastPlane(ray, origin, axis, &t) && t > 0.0f) {
      Vec3 hit = ray.At(t);
      Vec3 radial = hit - origin;
      f32 radius = Length(radial);
      if (radius > 0.0001f) {
        Vec3 normalized = radial / radius;
        Vec3 reference2 = Normalize(Cross(axis, Vec3(0, 1, 0)));
        if (LengthSq(reference2) < 0.01f) reference2 = Normalize(Cross(axis, Vec3(0, 0, 1)));
        Vec3 reference3 = Normalize(Cross(axis, reference2));
        f32 angle = std::atan2(Dot(normalized, reference3), Dot(normalized, reference2));
        if (ImGui::IsMouseDragging(ImGuiMouseButton_Left, 0.0f)) {
          if (!gizmoDrag_.label.empty() && Abs(angle - gizmoDrag_.startAngle) > 0.0f) {
            f32 deltaAngle = angle - gizmoDrag_.startAngle;
            f32 deltaDegrees = deltaAngle * 57.2957795131f;
            gizmoDrag_.accumulatedDegrees += deltaDegrees;
            f32 appliedDegrees = deltaDegrees;
            if (ctx_.snapEnabled && ctx_.rotateSnapDegrees > 0.0f) {
              f32 snapped = Round(gizmoDrag_.accumulatedDegrees / ctx_.rotateSnapDegrees) *
                            ctx_.rotateSnapDegrees;
              appliedDegrees = snapped - (gizmoDrag_.accumulatedDegrees - deltaDegrees);
              if (Abs(appliedDegrees) < 0.0001f) appliedDegrees = 0.0f;
            }
            Quat rotation = Quat::FromAxisAngle(axis, appliedDegrees * kDegToRad);
            for (EntityId id : gizmoDrag_.targets) {
              GameObject* object = ctx_.scene.Get(id);
              if (!object) continue;
              Transform world = ctx_.scene.WorldTransform(id);
              world.position = origin + rotation.Rotate(world.position - origin);
              world.rotation = (rotation * world.rotation).Normalized();
              ctx_.scene.SetWorldTransform(id, world);
            }
            gizmoDrag_.startAngle = angle;
          }
        } else {
          gizmoDrag_.startAngle = angle;
        }
      }
    }
  }

  if (ImGui::IsMouseReleased(ImGuiMouseButton_Left)) {
    ctx_.EndEdit();
    gizmoDrag_.active = false;
    gizmoDrag_.targets.clear();
    ctx_.Status(gizmoDrag_.label + " applied");
  }
}

// ------------------------------------------------------------------ overlay
void EditorApp::DrawViewportOverlay(ViewportRect rect) {
  ImDrawList* draw = ImGui::GetWindowDrawList();
  ImGuiIO& io = ImGui::GetIO();
  ImVec2 topLeft(rect.x, rect.y);
  f32 padding = 8.0f;

  // camera / render info
  char info[256];
  f32 yaw = ctx_.cameraYaw, pitch = ctx_.cameraPitch;
  snprintf(info, sizeof(info), "%s | dist %.1f | yaw %.0f pitch %.0f | %s",
           ctx_.cameraOrthographic ? "Ortho" : "Perspective", ctx_.cameraDistance, yaw, pitch,
           ctx_.renderWireframe ? "wireframe" : "shaded");
  draw->AddText(ImVec2(topLeft.x + padding, topLeft.y + padding), IM_COL32(210, 215, 225, 230), info);

  if (ctx_.playing && ctx_.runtime) {
    const RuntimeHud& hud = ctx_.runtime->Hud();
    char play[128];
    snprintf(play, sizeof(play), "PLAY MODE | %u FPS | %.1f ms sim | bodies %u",
             hud.fps, ctx_.runtime->Stats().simulationMs, ctx_.runtime->Stats().activeBodies);
    draw->AddText(ImVec2(topLeft.x + padding, topLeft.y + padding + 16.0f),
                  ctx_.paused ? IM_COL32(255, 200, 90, 240) : IM_COL32(120, 235, 140, 240), play);
    if (ctx_.window->IsMouseCaptured()) {
      draw->AddText(ImVec2(topLeft.x + padding, topLeft.y + padding + 32.0f),
                    IM_COL32(190, 200, 215, 220),
                    "Mouse captured - press Esc to release the cursor");
    } else {
      draw->AddText(ImVec2(topLeft.x + padding, topLeft.y + padding + 32.0f),
                    IM_COL32(190, 200, 215, 220), "Click the viewport to capture the mouse");
    }
  } else {
    const ExtractionStats& stats = ctx_.runtime ? ctx_.runtime->LastExtraction() : ExtractionStats{};
    char sceneInfo[192];
    snprintf(sceneInfo, sizeof(sceneInfo), "%zu objects | %d x %d | drag assets here | %s space",
             ctx_.scene.ObjectCount(), (int)rect.width, (int)rect.height,
             TransformSpaceName(ctx_.space));
    draw->AddText(ImVec2(topLeft.x + padding, topLeft.y + padding + 16.0f),
                  IM_COL32(170, 180, 195, 210), sceneInfo);
    NF_UNUSED(stats);
  }

  // ---- head-up toolbar inside the viewport
  ImGui::SetCursorScreenPos(ImVec2(rect.x + rect.width - 250.0f, rect.y + padding));
  ImGui::BeginGroup();
  ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.16f, 0.17f, 0.19f, 0.9f));
  if (ImGui::Button(ctx_.cameraOrthographic ? "Persp" : "Ortho", ImVec2(58.0f, 22.0f)))
    ctx_.cameraOrthographic = !ctx_.cameraOrthographic;
  ImGui::SameLine();
  if (ImGui::Button(ctx_.renderWireframe ? "Wire" : "Shade", ImVec2(58.0f, 22.0f)))
    ctx_.renderWireframe = !ctx_.renderWireframe;
  ImGui::SameLine();
  if (ImGui::Button(ctx_.shadowsEnabled ? "Shadow" : "NoShdw", ImVec2(62.0f, 22.0f)))
    ctx_.shadowsEnabled = !ctx_.shadowsEnabled;
  ImGui::SameLine();
  if (ImGui::Button("Reset", ImVec2(48.0f, 22.0f))) {
    ctx_.cameraTarget = Vec3(0.0f, 1.0f, 0.0f);
    ctx_.cameraDistance = 14.0f;
    ctx_.cameraYaw = 45.0f;
    ctx_.cameraPitch = -22.0f;
  }
  ImGui::PopStyleColor();
  ImGui::EndGroup();

  // ---- orientation cube (top right, drawn with the draw list)
  {
    f32 cubeSize = 54.0f;
    ImVec2 center(rect.x + rect.width - 60.0f, rect.y + 90.0f);
    draw->AddRectFilled(ImVec2(center.x - cubeSize * 0.5f, center.y - cubeSize * 0.5f),
                        ImVec2(center.x + cubeSize * 0.5f, center.y + cubeSize * 0.5f),
                        IM_COL32(25, 27, 31, 200), 4.0f);
    Vec2 axes[3];
    f32 yawRad = ctx_.cameraYaw * kDegToRad;
    f32 pitchRad = ctx_.cameraPitch * kDegToRad;
    Vec3 forward(-Cos(pitchRad) * Sin(yawRad), -Sin(pitchRad), -Cos(pitchRad) * Cos(yawRad));
    Vec3 right = Normalize(Cross(forward, Vec3(0, 1, 0)));
    Vec3 up = Normalize(Cross(right, forward));
    axes[0] = Vec2(Dot(right, Vec3(1, 0, 0)), -Dot(up, Vec3(1, 0, 0)));
    axes[1] = Vec2(Dot(right, Vec3(0, 1, 0)), -Dot(up, Vec3(0, 1, 0)));
    axes[2] = Vec2(Dot(right, Vec3(0, 0, 1)), -Dot(up, Vec3(0, 0, 1)));
    const char* labels[3] = {"X", "Y", "Z"};
    ImU32 colors[3] = {IM_COL32(240, 90, 90, 255), IM_COL32(120, 230, 110, 255),
                       IM_COL32(90, 150, 255, 255)};
    for (int i = 0; i < 3; i++) {
      ImVec2 tip(center.x + axes[i].x * cubeSize * 0.4f, center.y + axes[i].y * cubeSize * 0.4f);
      draw->AddLine(center, tip, colors[i], 1.8f);
      draw->AddText(ImVec2(tip.x - 4.0f, tip.y - 6.0f), colors[i], labels[i]);
    }
  }

  // ---- gizmo mode buttons at the bottom
  ImGui::SetCursorScreenPos(ImVec2(rect.x + padding, rect.y + rect.height - 32.0f));
  ImGui::BeginGroup();
  ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.16f, 0.17f, 0.19f, 0.9f));
  if (ImGui::Button("Move (W)", ImVec2(86.0f, 24.0f))) ctx_.gizmoMode = GizmoMode::Translate;
  ImGui::SameLine();
  if (ImGui::Button("Rotate (E)", ImVec2(86.0f, 24.0f))) ctx_.gizmoMode = GizmoMode::Rotate;
  ImGui::SameLine();
  if (ImGui::Button("Scale (R)", ImVec2(86.0f, 24.0f))) ctx_.gizmoMode = GizmoMode::Scale;
  ImGui::SameLine();
  if (ImGui::Button(ctx_.snapEnabled ? "Snap ON" : "Snap Off", ImVec2(90.0f, 24.0f)))
    ctx_.snapEnabled = !ctx_.snapEnabled;
  ImGui::SameLine();
  if (ImGui::Button(ctx_.space == TransformSpace::World ? "World (X)" : "Local (X)", ImVec2(90.0f, 24.0f)))
    ctx_.space = ctx_.space == TransformSpace::World ? TransformSpace::Local : TransformSpace::World;
  ImGui::PopStyleColor();
  ImGui::EndGroup();

  // context menu on the viewport
  if (ImGui::BeginPopupContextWindow("##viewportctx")) {
    if (ImGui::BeginMenu("Create")) {
      DrawCreateMenu();
      ImGui::EndMenu();
    }
    if (ImGui::MenuItem("Focus Selection", "F", false, ctx_.HasSelection())) ctx_.FocusSelection();
    if (ImGui::MenuItem("Frame All")) {
      if (ctx_.scene.ObjectCount() > 0) {
        AABB bounds;
        bool first = true;
        for (const auto& object : ctx_.scene.AllObjects()) {
          AABB b = ctx_.scene.WorldBounds(object->id);
          if (!b.IsValid()) continue;
          if (first) {
            bounds = b;
            first = false;
          } else {
            bounds.Expand(b);
          }
        }
        Vec3 center = bounds.Center();
        f32 radius = std::max(1.0f, Length(bounds.Size()) * 0.5f);
        ctx_.cameraTarget = center;
        ctx_.cameraDistance = radius * 2.6f;
      }
    }
    ImGui::Separator();
    ImGui::MenuItem("Show Grid", "G", &ctx_.showGrid);
    ImGui::MenuItem("Show Colliders", nullptr, &ctx_.showColliders);
    ImGui::MenuItem("Show Colliders As Wireframe", nullptr, &ctx_.showColliders);
    ImGui::Separator();
    f32 snaps[3] = {ctx_.translateSnap, ctx_.rotateSnapDegrees, ctx_.scaleSnap};
    ImGui::SetNextItemWidth(140.0f);
    if (ImGui::DragFloat("Move Snap", &snaps[0], 0.05f, 0.0f, 10.0f)) ctx_.translateSnap = snaps[0];
    ImGui::SetNextItemWidth(140.0f);
    if (ImGui::DragFloat("Rotate Snap", &snaps[1], 1.0f, 0.0f, 90.0f)) ctx_.rotateSnapDegrees = snaps[1];
    ImGui::SetNextItemWidth(140.0f);
    if (ImGui::DragFloat("Scale Snap", &snaps[2], 0.01f, 0.0f, 1.0f)) ctx_.scaleSnap = snaps[2];
    ImGui::Separator();
    if (ImGui::MenuItem("Play / Stop", "F5")) ctx_.TogglePlay();
    ImGui::EndPopup();
  }

  // crosshair while playing with a captured mouse
  if (ctx_.playing && ctx_.window->IsMouseCaptured()) {
    ImVec2 center(rect.x + rect.width * 0.5f, rect.y + rect.height * 0.5f);
    draw->AddLine(ImVec2(center.x - 7.0f, center.y), ImVec2(center.x + 7.0f, center.y),
                  IM_COL32(235, 240, 250, 190), 1.4f);
    draw->AddLine(ImVec2(center.x, center.y - 7.0f), ImVec2(center.x, center.y + 7.0f),
                  IM_COL32(235, 240, 250, 190), 1.4f);
  }

  // in-viewport HUD while playing (health, prompt, messages)
  if (ctx_.playing && ctx_.runtime) {
    const RuntimeHud& hud = ctx_.runtime->Hud();
    if (hud.showHealth) {
      ImVec2 barMin(rect.x + 20.0f, rect.y + rect.height - 60.0f);
      ImVec2 barMax(rect.x + 240.0f, rect.y + rect.height - 42.0f);
      draw->AddRectFilled(barMin, barMax, IM_COL32(20, 22, 26, 220), 3.0f);
      ImVec2 fill(barMin.x + (barMax.x - barMin.x) * Clamp(hud.healthPercent, 0.0f, 1.0f), barMax.y);
      draw->AddRectFilled(barMin, fill, IM_COL32(210, 70, 70, 235), 3.0f);
      char health[64];
      snprintf(health, sizeof(health), "HP %.0f / %.0f", hud.healthValue, hud.maxHealth);
      draw->AddText(ImVec2(barMin.x + 6.0f, barMin.y - 18.0f), IM_COL32(240, 240, 245, 235), health);
    }
    if (hud.showPrompt) {
      ImVec2 size = ImGui::CalcTextSize(hud.interactionPrompt.c_str());
      ImVec2 center(rect.x + rect.width * 0.5f - size.x * 0.5f, rect.y + rect.height * 0.62f);
      draw->AddText(center, IM_COL32(250, 235, 160, 240), hud.interactionPrompt.c_str());
    }
    f32 messageY = rect.y + rect.height - 120.0f;
    for (const auto& message : hud.messages) {
      draw->AddText(ImVec2(rect.x + 20.0f, messageY), IM_COL32(225, 232, 245, 230),
                    message.text.c_str());
      messageY -= 18.0f;
    }
    if (hud.dead) {
      ImVec2 size = ImGui::CalcTextSize("YOU DIED - press R to respawn");
      draw->AddText(ImVec2(rect.x + rect.width * 0.5f - size.x * 0.5f, rect.y + rect.height * 0.4f),
                    IM_COL32(255, 80, 80, 240), "YOU DIED - press R to respawn");
    }
  }

  NF_UNUSED(io);
}

} // namespace nf
