// NovaForge Engine - scene/Components.cpp
// Property tables (drive serialisation, the Inspector and the AI assistant) and the
// runtime behaviour of every built-in component.
#include "scene/Components.h"
#include "scene/Scene.h"
#include "scene/SceneFactory.h"
#include "physics/PhysicsWorld.h"
#include "audio/AudioSystem.h"
#include "scripting/ScriptSystem.h"
#include "ai/NpcBehavior.h"
#include "runtime/GameRuntime.h"
#include "renderer/DebugDraw.h"
#include "core/Log.h"
#include "core/FileSystem.h"
#include "core/StringUtil.h"

namespace nf {

// =============================================================== Transform
void TransformComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::Vec3("position", "Location", const_cast<Vec3*>(&position), "Transform", "", 0.05f));
  out.Add(prop::Vec3("rotationEuler", "Rotation", const_cast<Vec3*>(&rotationEuler), "Transform",
                     "Euler angles in degrees", 0.5f));
  out.Add(prop::Vec3("scale", "Scale", const_cast<Vec3*>(&scale), "Transform", "", 0.02f));
}

// ============================================================ MeshRenderer
void MeshRendererComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::Enum("meshSource", "Mesh Source", const_cast<i32*>(&meshSource),
                     {"Primitive", "Asset"}, "Mesh"));
  {
    Property p;
    p.id = "primitive";
    p.display = "Primitive";
    p.category = "Mesh";
    p.type = PropType::Enum;
    p.enumLabels = Mesh::PrimitiveNames();
    p.get = [this] {
      auto names = Mesh::PrimitiveNames();
      for (usize i = 0; i < names.size(); i++)
        if (names[i] == primitive) return JsonValue((i32)i);
      return JsonValue((i32)0);
    };
    p.set = [this](const JsonValue& v) {
      auto names = Mesh::PrimitiveNames();
      i32 index = (i32)Clamp((f32)v.AsInt(0), 0.0f, (f32)names.size() - 1);
      const_cast<std::string&>(primitive) = names[(usize)index];
      return true;
    };
    p.visibleIf = [this] { return meshSource == 0; };
    out.Add(p);
  }
  Property meshProp = prop::Asset("meshAsset", "Model", const_cast<std::string*>(&meshAsset),
                                  AssetTypeHint::Mesh, "glb;gltf;obj;fbx;nfmesh", "Mesh");
  meshProp.visibleIf = [this] { return meshSource == 1; };
  out.Add(meshProp);

  out.Add(prop::Bool("visible", "Visible", const_cast<bool*>(&visible), "Rendering"));
  out.Add(prop::Bool("castShadows", "Cast Shadows", const_cast<bool*>(&castShadows), "Rendering"));
  out.Add(prop::Bool("receiveShadows", "Receive Shadows", const_cast<bool*>(&receiveShadows),
                     "Rendering"));

  out.Add(prop::Bool("useMaterialFile", "Use Material Asset",
                     const_cast<bool*>(&useMaterialFile), "Material"));
  Property materialProp =
      prop::Asset("materialAsset", "Material", const_cast<std::string*>(&materialAsset),
                  AssetTypeHint::Material, "nfmat", "Material");
  out.Add(materialProp);

  auto inlineVisible = [this] { return !useMaterialFile || materialAsset.empty(); };
  Property colorPropProp = prop::Color4("baseColor", "Base Color", const_cast<Vec4*>(&baseColor), "Material");
  colorPropProp.visibleIf = inlineVisible;
  out.Add(colorPropProp);
  Property metallicProp =
      prop::Float("metallic", "Metallic", const_cast<f32*>(&metallic), 0.0f, 1.0f, "Material");
  metallicProp.visibleIf = inlineVisible;
  out.Add(metallicProp);
  Property roughnessProp =
      prop::Float("roughness", "Roughness", const_cast<f32*>(&roughness), 0.0f, 1.0f, "Material");
  roughnessProp.visibleIf = inlineVisible;
  out.Add(roughnessProp);
  Property opacityProp =
      prop::Float("opacity", "Opacity", const_cast<f32*>(&opacity), 0.0f, 1.0f, "Material");
  opacityProp.visibleIf = inlineVisible;
  out.Add(opacityProp);
  Property emissiveProp =
      prop::Color("emissiveColor", "Emissive", const_cast<Vec3*>(&emissiveColor), "Material");
  emissiveProp.visibleIf = inlineVisible;
  out.Add(emissiveProp);
  Property unlitPropProp = prop::Bool("unlit", "Unlit", const_cast<bool*>(&unlit), "Material");
  unlitPropProp.visibleIf = inlineVisible;
  out.Add(unlitPropProp);
  Property doubleSidedProp =
      prop::Bool("doubleSided", "Double Sided", const_cast<bool*>(&doubleSided), "Material");
  doubleSidedProp.visibleIf = inlineVisible;
  out.Add(doubleSidedProp);
  Property textureProp = prop::Asset("baseColorTexture", "Base Color Texture",
                                     const_cast<std::string*>(&baseColorTexture),
                                     AssetTypeHint::Texture, "png;jpg;jpeg;bmp;tga", "Material");
  textureProp.visibleIf = inlineVisible;
  out.Add(textureProp);
  Property normalProp = prop::Asset("normalTexture", "Normal Texture",
                                    const_cast<std::string*>(&normalTexture), AssetTypeHint::Texture,
                                    "png;jpg;jpeg;bmp;tga", "Material");
  normalProp.visibleIf = inlineVisible;
  out.Add(normalProp);
  Property tilingProp =
      prop::Float("uvTiling", "UV Tiling", const_cast<f32*>(&uvTiling), 0.1f, 64.0f, "Material");
  tilingProp.visibleIf = inlineVisible;
  out.Add(tilingProp);
  out.Add(prop::ReadOnly("resolvedMesh", "Resolved Mesh", [this] {
    if (meshSource == 0) return std::string("Primitive: ") + primitive;
    return meshAsset.empty() ? std::string("(no model assigned)") : meshAsset;
  }, "Info"));
}

std::shared_ptr<Mesh> MeshRendererComponent::ResolveMesh(AssetDatabase& assets,
                                                         std::string* outError) const {
  if (meshSource == 0 || meshAsset.empty()) return assets.GetPrimitiveMesh(primitive);
  auto model = assets.LoadModel(meshAsset);
  if (!model || !model->mesh) {
    if (outError) {
      *outError = "Unable to load " + fs::FileName(meshAsset) +
                  "\nReason: file missing or unsupported - the renderer falls back to a box";
    }
    static std::unordered_map<std::string, std::shared_ptr<Mesh>> fallbacks;
    auto it = fallbacks.find(primitive);
    if (it == fallbacks.end()) {
      it = fallbacks.emplace(primitive, std::make_shared<Mesh>(Mesh::CreatePrimitive(primitive))).first;
    }
    return it->second;
  }
  return model->mesh;
}

Material MeshRendererComponent::ResolveMaterial(AssetDatabase& assets) const {
  if (useMaterialFile && !materialAsset.empty()) {
    auto material = assets.LoadMaterial(materialAsset);
    if (material) {
      Material copy = *material;
      copy.castShadows = castShadows;
      copy.receiveShadows = receiveShadows;
      return copy;
    }
  }
  Material material;
  material.name = "Inline";
  material.baseColor = baseColor;
  material.metallic = metallic;
  material.roughness = roughness;
  material.opacity = opacity;
  material.emissiveColor = emissiveColor;
  material.emissiveStrength = LengthSq(emissiveColor) > 0.0001f ? 1.0f : 0.0f;
  material.unlit = unlit;
  material.doubleSided = doubleSided;
  material.baseColorTexture = baseColorTexture;
  material.normalTexture = normalTexture;
  material.castShadows = castShadows;
  material.receiveShadows = receiveShadows;
  material.baseColor.w = baseColor.w * opacity;
  return material;
}

// ================================================================== Camera
void CameraComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::Bool("isPrimary", "Primary (gameplay camera)", const_cast<bool*>(&isPrimary), "Camera"));
  out.Add(prop::Enum("projection", "Projection", const_cast<i32*>(&projection),
                     {"Perspective", "Orthographic"}, "Camera"));
  out.Add(prop::Float("fieldOfView", "Field of View", const_cast<f32*>(&fieldOfView), 20, 120, "Camera"));
  out.Add(prop::Float("nearPlane", "Near Clip", const_cast<f32*>(&nearPlane), 0.01f, 10.0f, "Camera"));
  out.Add(prop::Float("farPlane", "Far Clip", const_cast<f32*>(&farPlane), 10, 10000, "Camera"));
  Property orthoProp = prop::Float("orthoSize", "Ortho Size", const_cast<f32*>(&orthoSize), 1, 200, "Camera");
  orthoProp.visibleIf = [this] { return projection == 1; };
  out.Add(orthoProp);
  out.Add(prop::Color("clearColor", "Background Color", const_cast<Vec3*>(&clearColor), "Camera"));
}

Mat4 CameraComponent::ProjectionMatrix(f32 aspect) const {
  if (projection == (i32)CameraProjection::Orthographic) {
    f32 halfHeight = orthoSize * 0.5f;
    f32 halfWidth = halfHeight * aspect;
    return Mat4::Ortho(-halfWidth, halfWidth, -halfHeight, halfHeight, nearPlane, farPlane);
  }
  return Mat4::Perspective(fieldOfView * kDegToRad, aspect > 0.0001f ? aspect : 1.0f, nearPlane, farPlane);
}

// =================================================================== Light
void LightComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::Enum("lightType", "Type", const_cast<i32*>(&lightType),
                     {"Directional", "Point", "Spot"}, "Light"));
  out.Add(prop::Color("color", "Color", const_cast<Vec3*>(&color), "Light"));
  out.Add(prop::Float("intensity", "Intensity", const_cast<f32*>(&intensity), 0, 50, "Light"));
  Property rangeProp = prop::Float("range", "Range", const_cast<f32*>(&range), 0.1f, 500, "Light");
  rangeProp.visibleIf = [this] { return lightType != 0; };
  out.Add(rangeProp);
  Property innerProp = prop::Float("innerAngle", "Inner Angle", const_cast<f32*>(&innerAngle), 1, 89, "Light");
  Property outerProp = prop::Float("outerAngle", "Outer Angle", const_cast<f32*>(&outerAngle), 1, 89.9f, "Light");
  auto spotOnly = [this] { return lightType == 2; };
  innerProp.visibleIf = spotOnly;
  outerProp.visibleIf = spotOnly;
  out.Add(innerProp);
  out.Add(outerProp);
  out.Add(prop::Bool("castShadows", "Cast Shadows", const_cast<bool*>(&castShadows), "Shadows"));
  out.Add(prop::Float("shadowStrength", "Shadow Strength", const_cast<f32*>(&shadowStrength), 0, 1, "Shadows"));
  out.Add(prop::Float("shadowBias", "Shadow Bias", const_cast<f32*>(&shadowBias), 0.0f, 0.05f, "Shadows", "", 0.0001f));
}

void LightComponent::DrawGizmos(Scene& scene) {
  DebugDrawList* debug = scene.DebugDraw();
  if (!debug) return;
  Transform world = scene.WorldTransform(owner);
  Vec3 color = Vec3(1.0f, 0.85f, 0.3f);
  if (lightType == (i32)LightType::Directional) {
    Vec3 forward = world.rotation * Vec3(0, 0, -1);
    debug->AddLine(world.position, world.position + forward * 3.0f, color);
    for (int i = -1; i <= 1; i++)
      debug->AddLine(world.position + forward * 3.0f,
                     world.position + forward * 2.2f + Vec3(0.4f * i, 0, 0), color);
  } else {
    debug->AddWireSphere(world.position, 0.25f, color);
    debug->AddWireSphere(world.position, range, color * 0.45f);
  }
}

// ================================================================ Collider
AABB ColliderComponent::LocalBounds() const {
  switch (Shape()) {
    case ColliderShape::Sphere:
      return AABB::FromCenterExtents(center, Vec3(radius));
    case ColliderShape::Capsule:
      return AABB::FromCenterExtents(center, Vec3(radius, height * 0.5f, radius));
    case ColliderShape::Mesh:
      return AABB::FromCenterExtents(center, size * 0.5f);
    case ColliderShape::Box:
    default:
      return AABB::FromCenterExtents(center, size * 0.5f);
  }
}

void ColliderComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::Enum("shape", "Shape", const_cast<i32*>(&shape),
                     {"Box", "Sphere", "Capsule", "Mesh"}, "Shape", ""));
  out.Add(prop::Bool("isTrigger", "Is Trigger", const_cast<bool*>(&isTrigger), "Shape",
                     "Trigger colliders do not block movement, they raise enter/exit events"));
  out.Add(prop::Vec3("center", "Center", const_cast<Vec3*>(&center), "Shape", "", 0.02f));
  Property sizeProp = prop::Vec3("size", "Size", const_cast<Vec3*>(&size), "Shape", "", 0.02f);
  sizeProp.visibleIf = [this] { return shape == 0 || shape == 3; };
  out.Add(sizeProp);
  Property radiusProp = prop::Float("radius", "Radius", const_cast<f32*>(&radius), 0.01f, 50, "Shape");
  radiusProp.visibleIf = [this] { return shape == 1 || shape == 2; };
  out.Add(radiusProp);
  Property heightProp = prop::Float("height", "Height", const_cast<f32*>(&height), 0.01f, 50, "Shape");
  heightProp.visibleIf = [this] { return shape == 2; };
  out.Add(heightProp);
  out.Add(prop::Float("friction", "Friction", const_cast<f32*>(&friction), 0, 1, "Material"));
  out.Add(prop::Float("restitution", "Bounciness", const_cast<f32*>(&restitution), 0, 1, "Material"));
  out.Add(prop::Int("layer", "Layer", const_cast<i32*>(&layer), 0, 31, "Advanced"));
  out.Add(prop::Bool("visibleInEditor", "Draw Wireframe", const_cast<bool*>(&visibleInEditor), "Advanced"));
}

void ColliderComponent::DrawGizmos(Scene& scene) {
  DebugDrawList* debug = scene.DebugDraw();
  if (!debug || !visibleInEditor) return;
  Transform world = scene.WorldTransform(owner);
  Vec3 color = isTrigger ? Vec3(0.2f, 0.9f, 1.0f) : Vec3(0.3f, 1.0f, 0.4f);
  Vec3 centerWorld = world.Matrix().TransformPoint(center);
  switch (Shape()) {
    case ColliderShape::Sphere:
      debug->AddWireSphere(centerWorld, radius * MaxComponent(world.scale), color);
      break;
    case ColliderShape::Capsule: {
      f32 halfCyl = std::max(0.0f, height * 0.5f - radius);
      Vec3 up = world.rotation * Vec3(0, 1, 0);
      f32 r = radius * MaxComponent(world.scale);
      debug->AddWireSphere(centerWorld + up * halfCyl, r, color);
      debug->AddWireSphere(centerWorld - up * halfCyl, r, color);
      debug->AddLine(centerWorld + up * halfCyl + world.rotation * Vec3(r, 0, 0),
                     centerWorld - up * halfCyl + world.rotation * Vec3(r, 0, 0), color);
      debug->AddLine(centerWorld + up * halfCyl - world.rotation * Vec3(r, 0, 0),
                     centerWorld - up * halfCyl - world.rotation * Vec3(r, 0, 0), color);
      debug->AddLine(centerWorld + up * halfCyl + world.rotation * Vec3(0, 0, r),
                     centerWorld - up * halfCyl + world.rotation * Vec3(0, 0, r), color);
      debug->AddLine(centerWorld + up * halfCyl - world.rotation * Vec3(0, 0, r),
                     centerWorld - up * halfCyl - world.rotation * Vec3(0, 0, r), color);
      break;
    }
    default:
      debug->AddWireBox(AABB::FromCenterExtents(centerWorld, size * 0.5f * world.scale), color,
                        world.rotation);
      break;
  }
}

// =============================================================== Rigidbody
void RigidbodyComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::Float("mass", "Mass", const_cast<f32*>(&mass), 0.01f, 5000, "Body"));
  out.Add(prop::Bool("useGravity", "Use Gravity", const_cast<bool*>(&useGravity), "Body"));
  out.Add(prop::Bool("isKinematic", "Is Kinematic", const_cast<bool*>(&isKinematic), "Body",
                     "Kinematic bodies are moved by gameplay code, not by the solver"));
  out.Add(prop::Float("drag", "Linear Drag", const_cast<f32*>(&drag), 0, 5, "Body"));
  out.Add(prop::Float("angularDrag", "Angular Drag", const_cast<f32*>(&angularDrag), 0, 5, "Body"));
  out.Add(prop::Bool("freezeRotation", "Freeze Rotation", const_cast<bool*>(&freezeRotation), "Constraints"));
  out.Add(prop::Bool("freezeX", "Freeze X", const_cast<bool*>(&freezeX), "Constraints"));
  out.Add(prop::Bool("freezeY", "Freeze Y", const_cast<bool*>(&freezeY), "Constraints"));
  out.Add(prop::Bool("freezeZ", "Freeze Z", const_cast<bool*>(&freezeZ), "Constraints"));
  out.Add(prop::ReadOnly("velocity", "Velocity", [this] {
    return Format("(%.2f, %.2f, %.2f)", velocity.x, velocity.y, velocity.z);
  }, "Runtime"));
}

// ===================================================== CharacterController
void CharacterControllerComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::Enum("viewMode", "View Mode", const_cast<i32*>(&viewMode),
                     {"Third Person", "First Person"}, "Camera"));
  out.Add(prop::Float("moveSpeed", "Move Speed", const_cast<f32*>(&moveSpeed), 0.1f, 40, "Movement"));
  out.Add(prop::Float("sprintMultiplier", "Sprint Multiplier", const_cast<f32*>(&sprintMultiplier), 1, 5,
                      "Movement"));
  out.Add(prop::Bool("enableSprint", "Enable Sprint", const_cast<bool*>(&enableSprint), "Movement"));
  out.Add(prop::Float("jumpHeight", "Jump Height", const_cast<f32*>(&jumpHeight), 0, 12, "Movement"));
  out.Add(prop::Float("gravity", "Gravity", const_cast<f32*>(&gravity), -80, 0, "Movement"));
  out.Add(prop::Float("airControl", "Air Control", const_cast<f32*>(&airControl), 0, 1, "Movement"));
  out.Add(prop::Bool("rotateTowardsMovement", "Rotate To Movement",
                     const_cast<bool*>(&rotateTowardsMovement), "Movement"));
  out.Add(prop::Float("turnSpeed", "Turn Speed", const_cast<f32*>(&turnSpeed), 0.5f, 40, "Movement"));
  out.Add(prop::Float("mouseSensitivity", "Mouse Sensitivity", const_cast<f32*>(&mouseSensitivity),
                      0.01f, 1.0f, "Camera", "", 0.005f));
  out.Add(prop::Bool("invertY", "Invert Y", const_cast<bool*>(&invertY), "Camera"));
  out.Add(prop::Float("cameraDistance", "Camera Distance", const_cast<f32*>(&cameraDistance), 0.5f, 25, "Camera"));
  out.Add(prop::Float("cameraHeight", "Camera Height", const_cast<f32*>(&cameraHeight), 0.2f, 5, "Camera"));
  out.Add(prop::Float("cameraPitchOffset", "Camera Pitch Offset", const_cast<f32*>(&cameraPitchOffset),
                      -60, 60, "Camera"));
  out.Add(prop::Float("pitchMin", "Pitch Min", const_cast<f32*>(&pitchMin), -89, 0, "Camera"));
  out.Add(prop::Float("pitchMax", "Pitch Max", const_cast<f32*>(&pitchMax), 0, 89, "Camera"));
  out.Add(prop::Float("capsuleRadius", "Capsule Radius", const_cast<f32*>(&capsuleRadius), 0.1f, 3, "Collision"));
  out.Add(prop::Float("capsuleHeight", "Capsule Height", const_cast<f32*>(&capsuleHeight), 0.3f, 4, "Collision"));
  out.Add(prop::Bool("autoCreateCamera", "Create Follow Camera", const_cast<bool*>(&autoCreateCamera),
                     "Advanced"));
  out.Add(prop::Bool("useControllerAnimation", "Drive Animator", const_cast<bool*>(&useControllerAnimation),
                     "Advanced"));
}

// ================================================================== Health
void HealthComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::Float("maxHealth", "Max Health", const_cast<f32*>(&maxHealth), 1, 100000, "Health"));
  Property currentProp = prop::Float("currentHealth", "Health", const_cast<f32*>(&currentHealth), 0, 100000, "Health");
  currentProp.serialize = true;
  out.Add(currentProp);
  out.Add(prop::Float("regenerationPerSecond", "Regeneration / sec",
                      const_cast<f32*>(&regenerationPerSecond), 0, 500, "Health"));
  out.Add(prop::Float("invulnerableTime", "Invulnerability After Hit",
                      const_cast<f32*>(&invulnerableTime), 0, 10, "Health"));
  out.Add(prop::Bool("isPlayer", "Is Player", const_cast<bool*>(&isPlayer), "Health"));
  out.Add(prop::Bool("destroyOnDeath", "Destroy On Death", const_cast<bool*>(&destroyOnDeath), "Health"));
  out.Add(prop::String("deathEvent", "Death Event", const_cast<std::string*>(&deathEvent), "Health"));
  out.Add(prop::ReadOnly("alive", "State", [this] {
    return IsAlive() ? Format("Alive (%.0f%%)", HealthPercent() * 100.0f) : std::string("Dead");
  }, "Runtime"));
}

void HealthComponent::OnStart(Scene& scene) {
  NF_UNUSED(scene);
  if (currentHealth <= 0.0f) currentHealth = maxHealth;
}

void HealthComponent::OnReset(Scene& scene) {
  NF_UNUSED(scene);
  currentHealth = maxHealth;
}

void HealthComponent::OnUpdate(Scene& scene, f32 dt) {
  if (regenerationPerSecond > 0.0f && IsAlive() && currentHealth < maxHealth)
    Heal(scene, regenerationPerSecond * dt);
}

void HealthComponent::OnDamage(Scene& scene, f32 amount, EntityId source) { ApplyDamage(scene, amount, source); }

void HealthComponent::ApplyDamage(Scene& scene, f32 amount, EntityId source) {
  if (amount <= 0.0f || !IsAlive()) return;
  currentHealth = std::max(0.0f, currentHealth - amount);
  if (invulnerableTime > 0.0f) NF_UNUSED(invulnerableTime);
  GameObject* object = scene.Get(owner);
  std::string name = object ? object->name : "?";
  NF_INFO(LogCategory::Runtime, "%s took %.1f damage (%.1f/%.1f hp)", name.c_str(), amount,
          currentHealth, maxHealth);
  scene.PublishEvent(Format("Damage:%s:%.1f", name.c_str(), amount));
  // let the victim's other components react to the hit (AI retaliates, doors can break, ...)
  if (object) {
    for (auto& c : object->components) {
      if (c.get() == this) continue;
      c->OnDamage(scene, amount, source);
    }
  }
  if (!IsAlive()) {
    scene.PublishEvent(deathEvent.empty() ? "EntityDied" : deathEvent);
    if (destroyOnDeath) {
      scene.DestroyObject(owner);
    } else if (object) {
      // amount 0 = "this entity died" notification
      for (auto& c : object->components) c->OnDamage(scene, 0.0f, source);
    }
  }
}

void HealthComponent::Heal(Scene& scene, f32 amount) {
  NF_UNUSED(scene);
  currentHealth = std::min(maxHealth, currentHealth + amount);
}

// ================================================================== Pickup
void PickupComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::Enum("kind", "Kind", const_cast<i32*>(&kind),
                     {"Health", "Ammo", "Key", "Coin", "Custom"}, "Pickup"));
  out.Add(prop::Float("amount", "Amount", const_cast<f32*>(&amount), 0, 10000, "Pickup"));
  out.Add(prop::Float("pickupRadius", "Pickup Radius", const_cast<f32*>(&pickupRadius), 0.2f, 20, "Pickup"));
  out.Add(prop::Float("spinSpeed", "Spin Speed", const_cast<f32*>(&spinSpeed), 0, 720, "Presentation"));
  out.Add(prop::Float("bobHeight", "Bob Height", const_cast<f32*>(&bobHeight), 0, 2, "Presentation"));
  out.Add(prop::Bool("destroyOnPickup", "Destroy On Pickup", const_cast<bool*>(&destroyOnPickup), "Pickup"));
  out.Add(prop::Float("respawnSeconds", "Respawn Seconds", const_cast<f32*>(&respawnSeconds), 0, 600, "Pickup"));
  out.Add(prop::String("pickupEvent", "Event Name", const_cast<std::string*>(&pickupEvent), "Pickup"));
  out.Add(prop::String("requiredTag", "Collector Tag", const_cast<std::string*>(&requiredTag), "Pickup"));
}

void PickupComponent::OnStart(Scene& scene) { NF_UNUSED(scene); }
void PickupComponent::OnReset(Scene& scene) {
  NF_UNUSED(scene);
  if (auto* object = scene.Get(owner)) object->active = true;
}

void PickupComponent::OnUpdate(Scene& scene, f32 dt) {
  GameObject* object = scene.Get(owner);
  if (!object || !object->active) return;
  Transform world = scene.WorldTransform(owner);

  if (spinSpeed != 0.0f) {
    if (TransformComponent* transform = object->Transform())
      transform->rotationEuler.y += spinSpeed * dt;
  }
  if (bobHeight != 0.0f) {
    static f32 time = 0.0f;
    time += dt;
    if (TransformComponent* transform = object->Transform())
      transform->position.y = world.position.y + std::sin(time * 2.4f) * bobHeight * dt * 4.0f;
  }
  scene.MarkTransformDirty(owner);

  // collect when the tagged object is close enough
  EntityId player = scene.PlayerEntity();
  if (player == 0) {
    auto candidates = scene.FindByTag(requiredTag);
    if (!candidates.empty()) player = candidates[0];
  }
  if (player == 0 || player == owner) return;
  Vec3 playerPos = scene.WorldTransform(player).position;
  if (Distance(playerPos, world.position) > pickupRadius) return;

  // apply effect
  GameObject* collector = scene.Get(player);
  Collector:
  if (collector) {
    switch ((PickupKind)kind) {
      case PickupKind::Health:
        if (HealthComponent* health = collector->Get<HealthComponent>()) {
          health->Heal(scene, amount);
          scene.PublishEvent(Format("%s: +%.0f health", pickupEvent.c_str(), amount));
        }
        break;
      case PickupKind::Ammo:
        scene.PublishEvent(Format("%s: +%.0f ammo", pickupEvent.c_str(), amount));
        break;
      case PickupKind::Key:
        scene.PublishEvent(Format("%s: picked up key", pickupEvent.c_str()));
        break;
      case PickupKind::Coin:
        scene.PublishEvent(Format("%s: +%.0f coins", pickupEvent.c_str(), amount));
        break;
      default:
        scene.PublishEvent(pickupEvent);
        break;
    }
  }
  NF_INFO(LogCategory::Runtime, "%s collected '%s'", object->name.c_str(), pickupEvent.c_str());
  if (destroyOnPickup) {
    if (respawnSeconds > 0.0f) {
      object->active = false;
      // simple respawn: reuse the spawner-free path by scheduling an event
      scene.PublishEvent(Format("Respawn:%.1f:%s", respawnSeconds, object->name.c_str()));
    } else {
      scene.DestroyObject(owner);
    }
  }
}

// ==================================================================== Door
void DoorComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::Float("openAngle", "Open Angle", const_cast<f32*>(&openAngle), 10, 180, "Door"));
  out.Add(prop::Float("openSpeed", "Open Speed", const_cast<f32*>(&openSpeed), 5, 720, "Door"));
  out.Add(prop::Bool("autoClose", "Auto Close", const_cast<bool*>(&autoClose), "Door"));
  out.Add(prop::Float("autoCloseDelay", "Auto Close Delay", const_cast<f32*>(&autoCloseDelay), 0.1f, 60, "Door"));
  out.Add(prop::Bool("locked", "Locked", const_cast<bool*>(&locked), "Door"));
  out.Add(prop::String("requiredKeyTag", "Required Key Tag", const_cast<std::string*>(&requiredKeyTag), "Door"));
  out.Add(prop::Vec3("hingeAxis", "Hinge Axis", const_cast<Vec3*>(&hingeAxis), "Door", "", 0.02f));
  out.Add(prop::Bool("startOpen", "Start Open", const_cast<bool*>(&startOpen), "Door"));
  out.Add(prop::Asset("openSound", "Open Sound", const_cast<std::string*>(&openSound),
                      AssetTypeHint::Audio, "wav;ogg;mp3", "Audio"));
  out.Add(prop::ReadOnly("state", "State", [this] { return open_ ? std::string("Open") : std::string("Closed"); },
                         "Runtime"));
}

void DoorComponent::OnStart(Scene& scene) {
  if (GameObject* object = scene.Get(owner)) {
    if (TransformComponent* transform = object->Transform()) closedRotation_ = transform->Rotation();
  }
  open_ = startOpen;
  angle_ = startOpen ? openAngle : 0.0f;
}

void DoorComponent::OnReset(Scene& scene) {
  if (GameObject* object = scene.Get(owner)) {
    if (TransformComponent* transform = object->Transform()) {
      transform->SetRotation(closedRotation_ * Quat::FromAxisAngle(hingeAxis, 0.0f));
    }
  }
  open_ = startOpen;
  angle_ = startOpen ? openAngle : 0.0f;
  occupants_ = 0;
}

void DoorComponent::OnTriggerEnter(Scene& scene, EntityId other) {
  const GameObject* object = scene.Get(other);
  if (!object) return;
  if (other == scene.PlayerEntity() || object->tag == "Player") {
    occupants_++;
    Open(scene);
  }
}

void DoorComponent::OnTriggerExit(Scene& scene, EntityId other) {
  NF_UNUSED(other);
  occupants_ = std::max(0, occupants_ - 1);
  if (autoClose && occupants_ == 0) closeTimer_ = autoCloseDelay;
  NF_UNUSED(scene);
}

void DoorComponent::Open(Scene& scene) {
  if (locked) {
    scene.PublishEvent(Format("%s is locked (needs %s)", scene.Get(owner)->name.c_str(),
                              requiredKeyTag.c_str()));
    return;
  }
  if (!open_) {
    open_ = true;
    scene.PublishEvent(Format("DoorOpened:%s", scene.Get(owner)->name.c_str()));
    if (!openSound.empty()) {
      if (AudioSystem* audio = scene.Audio())
        audio->PlayAt(openSound, scene.WorldTransform(owner).position, 1.0f, false);
    }
  }
}

void DoorComponent::Close(Scene& scene) {
  NF_UNUSED(scene);
  open_ = false;
}

void DoorComponent::OnUpdate(Scene& scene, f32 dt) {
  GameObject* object = scene.Get(owner);
  if (!object || !object->Transform()) return;
  if (autoClose && open_ && occupants_ == 0 && closeTimer_ > 0.0f) {
    closeTimer_ -= dt;
    if (closeTimer_ <= 0.0f) open_ = false;
  }
  f32 target = open_ ? openAngle : 0.0f;
  if (Abs(angle_ - target) < 0.01f) return;
  angle_ = MoveTowards(angle_, target, openSpeed * dt);
  TransformComponent* transform = object->Transform();
  transform->SetRotation(closedRotation_ * Quat::FromAxisAngle(hingeAxis, angle_ * kDegToRad));
  scene.MarkTransformDirty(owner);
}

// ============================================================ Interactable
void InteractableComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::String("prompt", "Prompt", const_cast<std::string*>(&prompt), "Interaction"));
  out.Add(prop::Enum("action", "Action", const_cast<i32*>(&action),
                     {"Show Message", "Open Door", "Collect", "Damage Self", "Trigger Script", "Teleport"},
                     "Interaction"));
  out.Add(prop::Text("message", "Message", const_cast<std::string*>(&message), "Interaction"));
  out.Add(prop::Float("range", "Range", const_cast<f32*>(&range), 0.5f, 20, "Interaction"));
  out.Add(prop::EntityRef("targetEntity", "Target Entity", const_cast<u64*>(&targetEntity), "Interaction",
                          "Entity id used by Open Door / Trigger Script (empty = self)"));
  out.Add(prop::Vec3("teleportTarget", "Teleport Target", const_cast<Vec3*>(&teleportTarget), "Interaction"));
  out.Add(prop::Bool("oneShot", "One Shot", const_cast<bool*>(&oneShot), "Interaction"));
}

void InteractableComponent::OnReset(Scene& scene) {
  NF_UNUSED(scene);
  used_ = false;
}

void InteractableComponent::OnUpdate(Scene& scene, f32 dt) {
  NF_UNUSED(dt);
  if (used_ && oneShot) return;
  EntityId player = scene.PlayerEntity();
  if (player == 0 || player == owner) return;
  Vec3 playerPos = scene.WorldTransform(player).position;
  Vec3 selfPos = scene.WorldTransform(owner).position;
  if (Distance(playerPos, selfPos) > range) return;

  // The player controller publishes an Interact event when E is pressed.
  bool wantsToInteract = false;
  GameObject* playerObject = scene.Get(player);
  if (playerObject) {
    if (ScriptComponent* script = playerObject->Get<ScriptComponent>()) {
      if (script->parameters["pendingInteract"].AsBool(false)) {
        wantsToInteract = true;
        script->parameters["pendingInteract"] = false;
      }
    }
  }
  if (!wantsToInteract) {
    if (scene.Runtime() && scene.Runtime()->ConsumeInteractRequest()) wantsToInteract = true;
  }
  if (!wantsToInteract) return;

  Interact(scene, player);
  used_ = true;
}

void InteractableComponent::Interact(Scene& scene, EntityId instigator) {
  GameObject* object = scene.Get(owner);
  if (!object) return;
  switch ((InteractAction)action) {
    case InteractAction::ShowMessage:
      scene.PublishEvent(Format("Message:%s", message.c_str()));
      break;
    case InteractAction::OpenDoor: {
      EntityId target = targetEntity != 0 ? targetEntity : owner;
      if (ComponentBase* component = scene.GetComponent(target, "Door"))
        component->OnTriggerEnter(scene, instigator);
      break;
    }
    case InteractAction::Collect:
      if (ComponentBase* component = scene.GetComponent(owner, "Pickup"))
        component->OnUpdate(scene, 0.0f);
      break;
    case InteractAction::DamageSelf:
      scene.ApplyDamage(instigator, 10.0f, owner);
      scene.PublishEvent("Message:Ouch!");
      break;
    case InteractAction::TriggerScript: {
      if (ComponentBase* component = scene.GetComponent(targetEntity ? targetEntity : owner, "Script"))
        component->OnTriggerEnter(scene, instigator);
      break;
    }
    case InteractAction::Teleport: {
      if (TransformComponent* transform = scene.Get(instigator) ? scene.Get(instigator)->Transform() : nullptr) {
        transform->position = teleportTarget;
        scene.MarkTransformDirty(instigator);
        scene.PublishEvent("Message:Teleported");
      }
      break;
    }
  }
}

// =========================================================== TriggerVolume
void TriggerVolumeComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::String("requiredTag", "Required Tag", const_cast<std::string*>(&requiredTag), "Trigger"));
  out.Add(prop::Bool("oneShot", "One Shot", const_cast<bool*>(&oneShot), "Trigger"));
  out.Add(prop::Enum("action", "Action", const_cast<i32*>(&action),
                     {"None", "Open Door", "Show Message", "Spawn Enemy", "Complete Quest",
                      "Kill Instigator", "Heal Instigator"},
                     "Trigger"));
  out.Add(prop::Text("message", "Message", const_cast<std::string*>(&message), "Trigger"));
  out.Add(prop::EntityRef("targetEntity", "Target Entity", const_cast<u64*>(&targetEntity), "Trigger"));
  out.Add(prop::String("spawnObjectName", "Template Object", const_cast<std::string*>(&spawnObjectName),
                       "Trigger", "Object cloned by the Spawn Enemy action"));
  out.Add(prop::EntityRef("questEntity", "Quest Entity", const_cast<u64*>(&questEntity), "Trigger"));
  out.Add(prop::Float("healAmount", "Heal Amount", const_cast<f32*>(&healAmount), 0, 10000, "Trigger"));
}

void TriggerVolumeComponent::OnReset(Scene& scene) {
  NF_UNUSED(scene);
  fired_ = false;
}

void TriggerVolumeComponent::OnTriggerEnter(Scene& scene, EntityId other) {
  if (fired_ && oneShot) return;
  GameObject* otherObject = scene.Get(other);
  if (!otherObject) return;
  if (!requiredTag.empty() && otherObject->tag != requiredTag && other != scene.PlayerEntity()) return;
  fired_ = true;

  switch ((TriggerAction)action) {
    case TriggerAction::None:
      break;
    case TriggerAction::OpenDoor: {
      EntityId target = targetEntity != 0 ? targetEntity : owner;
      if (ComponentBase* door = scene.GetComponent(target, "Door")) door->OnTriggerEnter(scene, other);
      else NF_WARN(LogCategory::Scene, "Trigger '%s': target has no Door component",
                    scene.Get(owner) ? scene.Get(owner)->name.c_str() : "?");
      break;
    }
    case TriggerAction::ShowMessage:
      scene.PublishEvent(Format("Message:%s", message.c_str()));
      break;
    case TriggerAction::SpawnEnemy: {
      EntityId templateObject = scene.FindByName(spawnObjectName);
      GameObject* source = scene.Get(templateObject);
      if (source) {
        Vec3 position = scene.WorldTransform(owner).position;
        EntityId spawned = scene.CreateFromTemplate(*source, spawnObjectName, Vec3(0, 0, 0));
        scene.SetWorldPosition(spawned, position);
        if (GameObject* created = scene.Get(spawned)) created->active = true;
        scene.PublishEvent(Format("Spawned:%s", spawnObjectName.c_str()));
      } else {
        NF_WARN(LogCategory::Scene, "Trigger '%s': template object '%s' not found",
                scene.Get(owner) ? scene.Get(owner)->name.c_str() : "?", spawnObjectName.c_str());
      }
      break;
    }
    case TriggerAction::CompleteQuest: {
      EntityId quest = questEntity != 0 ? questEntity : targetEntity;
      if (ComponentBase* c = scene.GetComponent(quest, "Quest")) c->OnUpdate(scene, 0.0f);
      break;
    }
    case TriggerAction::KillInstigator:
      scene.ApplyDamage(other, 100000.0f, owner);
      break;
    case TriggerAction::HealInstigator:
      if (GameObject* object = scene.Get(other))
        if (HealthComponent* health = object->Get<HealthComponent>()) health->Heal(scene, healAmount);
      break;
  }
}

// =================================================================== Quest
void QuestComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::String("questName", "Quest Name", const_cast<std::string*>(&questName), "Quest"));
  out.Add(prop::Text("description", "Description", const_cast<std::string*>(&description), "Quest"));
  out.Add(prop::StringList("objectives", "Objectives", const_cast<std::vector<std::string>*>(&objectives),
                           "Quest"));
  out.Add(prop::Bool("complete", "Complete", const_cast<bool*>(&complete), "Quest"));
  out.Add(prop::String("completedEvent", "Completed Event", const_cast<std::string*>(&completedEvent), "Quest"));
  out.Add(prop::ReadOnly("progress", "Progress", [this] {
    return Format("%d / %zu", currentObjective_, state_.size());
  }, "Runtime"));
}

void QuestComponent::OnStart(Scene& scene) {
  state_ = objectives;
  currentObjective_ = 0;
  scene.PublishEvent(Format("QuestStarted:%s", questName.c_str()));
}

void QuestComponent::CompleteObjective(Scene& scene, const std::string& objective) {
  for (auto& o : state_) {
    if (o == objective) {
      o = o + " [done]";
      currentObjective_++;
      scene.PublishEvent(Format("ObjectiveComplete:%s", objective.c_str()));
      break;
    }
  }
  if (currentObjective_ >= (int)state_.size()) Complete(scene);
}

void QuestComponent::Complete(Scene& scene) {
  if (complete) return;
  complete = true;
  scene.PublishEvent(completedEvent.empty() ? Format("QuestCompleted:%s", questName.c_str())
                                            : completedEvent);
  NF_INFO(LogCategory::Runtime, "Quest '%s' completed", questName.c_str());
}

// ================================================================= Spawner
void SpawnerComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::String("templateObjectName", "Template Object",
                       const_cast<std::string*>(&templateObjectName), "Spawner",
                       "Name of a scene object cloned by this spawner"));
  out.Add(prop::Float("intervalSeconds", "Interval", const_cast<f32*>(&intervalSeconds), 0.1f, 600, "Spawner"));
  out.Add(prop::Int("maxAlive", "Max Alive", const_cast<i32*>(&maxAlive), 0, 200, "Spawner"));
  out.Add(prop::Float("spawnRadius", "Spawn Radius", const_cast<f32*>(&spawnRadius), 0, 100, "Spawner"));
  out.Add(prop::Bool("spawnOnStart", "Spawn On Start", const_cast<bool*>(&spawnOnStart), "Spawner"));
  out.Add(prop::Bool("active", "Active", const_cast<bool*>(&active), "Spawner"));
}

void SpawnerComponent::OnStart(Scene& scene) {
  timer_ = intervalSeconds;
  if (spawnOnStart) {
    timer_ = 0.0f;
    OnUpdate(scene, 0.016f);
  }
}

void SpawnerComponent::OnReset(Scene& scene) {
  NF_UNUSED(scene);
  timer_ = intervalSeconds;
  spawned_.clear();
}

void SpawnerComponent::OnUpdate(Scene& scene, f32 dt) {
  if (!active) return;
  // purge destroyed instances
  spawned_.erase(std::remove_if(spawned_.begin(), spawned_.end(),
                                [&scene](EntityId id) { return !scene.IsValid(id); }),
                 spawned_.end());
  if (maxAlive > 0 && (i32)spawned_.size() >= maxAlive) return;
  timer_ -= dt;
  if (timer_ > 0.0f) return;
  timer_ = intervalSeconds;

  EntityId templateId = scene.FindByName(templateObjectName);
  GameObject* source = scene.Get(templateId);
  if (!source) {
    NF_WARN(LogCategory::Scene, "Spawner '%s': template '%s' not found",
            scene.Get(owner) ? scene.Get(owner)->name.c_str() : "?", templateObjectName.c_str());
    return;
  }
  Vec3 base = scene.WorldTransform(owner).position;
  static u32 seed = 12345;
  seed = seed * 1664525u + 1013904223u;
  f32 angle = (f32)((seed >> 8) % 360) * kDegToRad;
  Vec3 offset(std::cos(angle) * spawnRadius, 0.0f, std::sin(angle) * spawnRadius);
  EntityId spawned = scene.CreateFromTemplate(*source, templateObjectName, offset);
  if (spawned == 0) return;
  if (GameObject* created = scene.Get(spawned)) {
    created->active = true;
    created->name = scene.UniqueName(templateObjectName + "_Spawned");
  }
  scene.SetWorldPosition(spawned, base + offset + Vec3(0, 0.5f, 0));
  spawned_.push_back(spawned);
  scene.PublishEvent(Format("Spawned:%s", templateObjectName.c_str()));
}

// ============================================================= AudioSource
void AudioSourceComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::Asset("clipPath", "Clip", const_cast<std::string*>(&clipPath), AssetTypeHint::Audio,
                      "wav;ogg;mp3;flac", "Audio"));
  out.Add(prop::Float("volume", "Volume", const_cast<f32*>(&volume), 0, 2, "Audio"));
  out.Add(prop::Float("pitch", "Pitch", const_cast<f32*>(&pitch), 0.1f, 4, "Audio"));
  out.Add(prop::Bool("loop", "Loop", const_cast<bool*>(&loop), "Audio"));
  out.Add(prop::Bool("playOnAwake", "Play On Awake", const_cast<bool*>(&playOnAwake), "Audio"));
  out.Add(prop::Bool("spatial", "3D Sound", const_cast<bool*>(&spatial), "Audio"));
  Property minDProp = prop::Float("minDistance", "Min Distance", const_cast<f32*>(&minDistance), 0, 100, "Attenuation");
  Property maxDProp = prop::Float("maxDistance", "Max Distance", const_cast<f32*>(&maxDistance), 0.1f, 1000, "Attenuation");
  auto spatialOnly = [this] { return spatial; };
  minDProp.visibleIf = spatialOnly;
  maxDProp.visibleIf = spatialOnly;
  out.Add(minDProp);
  out.Add(maxDProp);
  out.Add(prop::String("playEvent", "Play On Event", const_cast<std::string*>(&playEvent), "Audio"));
}

void AudioSourceComponent::OnStart(Scene& scene) {
  if (playOnAwake) Play(scene);
}

void AudioSourceComponent::OnReset(Scene& scene) {
  if (AudioSystem* audio = scene.Audio()) audio->Stop(voiceId_);
  voiceId_ = 0;
}

void AudioSourceComponent::Play(Scene& scene) {
  AudioSystem* audio = scene.Audio();
  if (!audio) return;
  if (clipPath.empty()) return;
  Transform world = scene.WorldTransform(owner);
  voiceId_ = audio->PlayAt(clipPath, world.position, volume, loop, spatial, minDistance, maxDistance,
                           pitch);
}

void AudioSourceComponent::OnUpdate(Scene& scene, f32 dt) {
  NF_UNUSED(dt);
  if (voiceId_ != 0 && spatial) {
    if (AudioSystem* audio = scene.Audio())
      audio->UpdatePosition(voiceId_, scene.WorldTransform(owner).position);
  }
  if (!playEvent.empty()) {
    for (const auto& event : scene.Events()) {
      if (event == playEvent) {
        Play(scene);
        break;
      }
    }
  }
}

// ================================================================ Animator
void AnimatorComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::Asset("animationAsset", "Animation Asset",
                      const_cast<std::string*>(&animationAsset), AssetTypeHint::Animation,
                      "glb;gltf;nfanim", "Clips",
                      "Model that carries the skeletal clips (empty = the renderer mesh)"));
  out.Add(prop::String("defaultClip", "Idle Clip", const_cast<std::string*>(&defaultClip), "Clips"));
  out.Add(prop::String("walkClip", "Walk Clip", const_cast<std::string*>(&walkClip), "Clips"));
  out.Add(prop::String("runClip", "Run Clip", const_cast<std::string*>(&runClip), "Clips"));
  out.Add(prop::String("attackClip", "Attack Clip", const_cast<std::string*>(&attackClip), "Clips"));
  out.Add(prop::String("deathClip", "Death Clip", const_cast<std::string*>(&deathClip), "Clips"));
  out.Add(prop::Bool("playOnStart", "Play On Start", const_cast<bool*>(&playOnStart), "Playback"));
  out.Add(prop::Bool("loop", "Loop", const_cast<bool*>(&loop), "Playback"));
  out.Add(prop::Float("speed", "Speed", const_cast<f32*>(&speed), 0.0f, 6.0f, "Playback"));
  out.Add(prop::Bool("rootMotion", "Apply Root Motion", const_cast<bool*>(&rootMotion), "Playback"));
  out.Add(prop::ReadOnly("current", "Playing",
                         [this] { return currentClip_.empty() ? std::string("(none)") : currentClip_; },
                         "Runtime"));
}

// Finds the model that carries the clips: either the explicit asset or the mesh asset.
static std::shared_ptr<Model> ResolveAnimationModel(Scene& scene, const AnimatorComponent& animator) {
  AssetDatabase& assets = scene.Assets();
  std::string path = animator.animationAsset;
  if (path.empty()) {
    if (GameObject* object = scene.Get(animator.owner))
      if (MeshRendererComponent* renderer = object->Get<MeshRendererComponent>())
        path = renderer->meshAsset;
  }
  if (path.empty()) return nullptr;
  return assets.LoadModel(path);
}

void AnimatorComponent::OnStart(Scene& scene) {
  auto model = ResolveAnimationModel(scene, *this);
  if (!model || model->animations.empty()) {
    clipIndex = -1;
    currentClip_.clear();
    return;
  }
  if (GameObject* object = scene.Get(owner)) {
    if (MeshRendererComponent* renderer = object->Get<MeshRendererComponent>()) {
      if (renderer->meshAsset.empty() && !animationAsset.empty()) renderer->meshAsset = animationAsset;
    }
  }
  if (playOnStart) Play(defaultClip.empty() ? model->animations[0].name : defaultClip, true);
  NF_INFO(LogCategory::Animation, "Animator on '%s': %zu clip(s) available",
          scene.Get(owner) ? scene.Get(owner)->name.c_str() : "?", model->animations.size());
}

void AnimatorComponent::Play(const std::string& clipName, bool restart) {
  if (currentClip_ == clipName && !restart) return;
  currentClip_ = clipName;
  clipIndex = -1;
  time = 0.0f;
}

void AnimatorComponent::OnUpdate(Scene& scene, f32 dt) {
  if (clipIndex < 0 && !currentClip_.empty()) {
    auto model = ResolveAnimationModel(scene, *this);
    if (model) {
      for (usize i = 0; i < model->animations.size(); i++) {
        if (model->animations[i].name == currentClip_) {
          clipIndex = (i32)i;
          break;
        }
      }
      if (clipIndex < 0 && !model->animations.empty()) clipIndex = 0;
    }
  }
  if (clipIndex < 0) return;
  time += dt * speed;
}

void AnimatorComponent::OnReset(Scene& scene) {
  NF_UNUSED(scene);
  time = 0.0f;
  clipIndex = -1;
  currentClip_.clear();
}

// ================================================================== Script
void ScriptComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::String("className", "Behaviour", const_cast<std::string*>(&className), "Script",
                       "Built-in behaviour name, e.g. Rotator, Bobber, MovingPlatform"));
  out.Add(prop::Asset("sourcePath", "Script File", const_cast<std::string*>(&sourcePath),
                      AssetTypeHint::Script, "nfscript;lua;cpp;h", "Script",
                      "Gameplay script (.nfscript) executed by the script system"));
  out.Add(prop::Asset("modulePath", "Native Module", const_cast<std::string*>(&modulePath),
                      AssetTypeHint::Script, "dll;so", "Script",
                      "Optional compiled module that registers extra components"));
  out.Add(prop::Bool("logStart", "Log On Start", const_cast<bool*>(&logStart), "Script"));
  out.Add(prop::ReadOnly("parameters", "Parameters", [this] {
    return Format("%zu key(s)", parameters.Size());
  }, "Script"));
}

void ScriptComponent::OnStart(Scene& scene) {
  if (logStart) {
    NF_INFO(LogCategory::Script, "Script '%s' started on '%s'", className.c_str(),
            scene.Get(owner) ? scene.Get(owner)->name.c_str() : "?");
  }
  ScriptSystem::OnStart(scene, *this);
}

void ScriptComponent::OnUpdate(Scene& scene, f32 dt) { ScriptSystem::OnUpdate(scene, *this, dt); }
void ScriptComponent::OnFixedUpdate(Scene& scene, f32 dt) { ScriptSystem::OnFixedUpdate(scene, *this, dt); }
void ScriptComponent::OnTriggerEnter(Scene& scene, EntityId other) {
  ScriptSystem::OnTrigger(scene, *this, other);
}
void ScriptComponent::OnReset(Scene& scene) { ScriptSystem::OnReset(scene, *this); }

// ====================================================================== AI
const char* NpcStateName(NpcState state) {
  switch (state) {
    case NpcState::Idle: return "Idle";
    case NpcState::Patrol: return "Patrol";
    case NpcState::Chase: return "Chase";
    case NpcState::Attack: return "Attack";
    case NpcState::Flee: return "Flee";
    case NpcState::Dead: return "Dead";
    default: return "?";
  }
}

const char* NpcBehaviorName(NpcBehavior behavior) {
  switch (behavior) {
    case NpcBehavior::Idle: return "Idle";
    case NpcBehavior::Patrol: return "Patrol";
    case NpcBehavior::Follow: return "Follow";
    case NpcBehavior::Chase: return "Chase";
    case NpcBehavior::Attack: return "Attack";
    case NpcBehavior::Flee: return "Flee";
    default: return "?";
  }
}

void AIComponent::BuildProperties(PropertyList& out) const {
  out.Add(prop::Enum("behavior", "Behaviour", const_cast<i32*>(&behavior),
                     {"Idle", "Patrol", "Follow", "Chase", "Attack", "Flee"}, "Behaviour",
                     "Base behaviour; the state machine adds Chase/Attack transitions"));
  out.Add(prop::Float("detectionRadius", "Detection Radius", const_cast<f32*>(&detectionRadius), 0.5f, 200, "Senses"));
  out.Add(prop::Float("loseTargetRadius", "Lose Target Radius", const_cast<f32*>(&loseTargetRadius), 1, 300, "Senses"));
  out.Add(prop::String("targetTag", "Target Tag", const_cast<std::string*>(&targetTag), "Senses"));
  out.Add(prop::EntityRef("explicitTarget", "Explicit Target", const_cast<u64*>(&explicitTarget), "Senses"));
  Property losProp = prop::Bool("requireLineOfSight", "Require Line Of Sight",
                            const_cast<bool*>(&requireLineOfSight), "Senses",
                            "V1: falls back to a distance check (no ray occlusion test yet)");
  losProp.readOnly = false;
  out.Add(losProp);
  out.Add(prop::Float("moveSpeed", "Walk Speed", const_cast<f32*>(&moveSpeed), 0.1f, 30, "Movement"));
  out.Add(prop::Float("chaseSpeed", "Chase Speed", const_cast<f32*>(&chaseSpeed), 0.1f, 40, "Movement"));
  out.Add(prop::Float("turnSpeed", "Turn Speed", const_cast<f32*>(&turnSpeed), 0.5f, 30, "Movement"));
  out.Add(prop::Float("gravity", "Gravity", const_cast<f32*>(&gravity), -60, 0, "Movement"));
  out.Add(prop::Vec3List("patrolPoints", "Patrol Points", const_cast<std::vector<Vec3>*>(&patrolPoints),
                         "Patrol"));
  out.Add(prop::Float("patrolWaitTime", "Patrol Wait", const_cast<f32*>(&patrolWaitTime), 0, 30, "Patrol"));
  out.Add(prop::Float("wanderRadius", "Wander Radius", const_cast<f32*>(&wanderRadius), 0.5f, 100, "Patrol"));
  out.Add(prop::Bool("canAttack", "Can Attack", const_cast<bool*>(&canAttack), "Combat"));
  out.Add(prop::Float("attackRange", "Attack Range", const_cast<f32*>(&attackRange), 0.3f, 30, "Combat"));
  out.Add(prop::Float("attackDamage", "Attack Damage", const_cast<f32*>(&attackDamage), 0, 1000, "Combat"));
  out.Add(prop::Float("attackCooldown", "Attack Cooldown", const_cast<f32*>(&attackCooldown), 0.1f, 30, "Combat"));
  out.Add(prop::Float("attackWindup", "Attack Windup", const_cast<f32*>(&attackWindup), 0, 5, "Combat"));
  out.Add(prop::Bool("animateMovement", "Drive Animator", const_cast<bool*>(&animateMovement), "Advanced"));
  out.Add(prop::ReadOnly("state", "State", [this] { return std::string(NpcStateName(state_)); }, "Runtime"));
  out.Add(prop::ReadOnly("target", "Target", [this] {
    return target_ == 0 ? std::string("(none)") : Format("entity %llu", (unsigned long long)target_);
  }, "Runtime"));
}

void AIComponent::OnStart(Scene& scene) {
  state_ = (NpcBehavior)behavior == NpcBehavior::Idle ? NpcState::Idle
          : (NpcBehavior)behavior == NpcBehavior::Patrol ? NpcState::Patrol
                                                        : NpcState::Idle;
  if (behavior == (i32)NpcBehavior::Follow) state_ = NpcState::Chase;
  attackTimer_ = 0.0f;
  waitTimer_ = 0.0f;
  patrolIndex_ = 0;
  velocity_ = Vec3(0, 0, 0);
  if (patrolPoints.empty() && behavior == (i32)NpcBehavior::Patrol) {
    // generate a small loop around the spawn point so Patrol works out of the box
    Vec3 origin = scene.WorldTransform(owner).position;
    patrolPoints = {origin + Vec3(3, 0, 0), origin + Vec3(0, 0, 3), origin - Vec3(3, 0, 0),
                    origin - Vec3(0, 0, 3)};
  }
}

void AIComponent::OnReset(Scene& scene) {
  NF_UNUSED(scene);
  state_ = NpcState::Idle;
  target_ = 0;
  attackTimer_ = 0.0f;
  waitTimer_ = 0.0f;
  velocity_ = Vec3(0, 0, 0);
}

void AIComponent::OnDamage(Scene& scene, f32 amount, EntityId source) {
  if (amount <= 0.0f) {
    if (state_ != NpcState::Dead) state_ = NpcState::Dead;
    return;
  }
  // being hit makes the NPC retaliate
  if (source != 0) {
    target_ = source;
    if (state_ != NpcState::Dead) state_ = NpcState::Chase;
    NF_INFO(LogCategory::AI, "NPC '%s' enraged by damage %.1f",
            scene.Get(owner) ? scene.Get(owner)->name.c_str() : "?", amount);
  }
}

void AIComponent::OnTriggerEnter(Scene& scene, EntityId other) {
  GameObject* otherObject = scene.Get(other);
  if (otherObject && !targetTag.empty() && otherObject->tag == targetTag) target_ = other;
}

void AIComponent::OnUpdate(Scene& scene, f32 dt) { ai::UpdateNpc(scene, *this, dt); }

// ============================================================ registration
void RegisterBuiltinComponents() {
  static bool registered = false;
  if (registered) return;
  registered = true;
  RegisterComponent<TransformComponent>("Transform", ComponentCategory::Core,
                                        "Position / rotation / scale");
  RegisterComponent<MeshRendererComponent>("MeshRenderer", ComponentCategory::Rendering,
                                           "Draws a mesh with a material");
  RegisterComponent<CameraComponent>("Camera", ComponentCategory::Rendering, "View / gameplay camera");
  RegisterComponent<LightComponent>("Light", ComponentCategory::Rendering,
                                    "Directional, point and spot lights");
  RegisterComponent<AnimatorComponent>("Animator", ComponentCategory::Rendering,
                                       "Plays skeletal animation clips");
  RegisterComponent<ColliderComponent>("Collider", ComponentCategory::Physics,
                                       "Physics shape or trigger volume");
  RegisterComponent<RigidbodyComponent>("Rigidbody", ComponentCategory::Physics,
                                        "Dynamic physics body");
  RegisterComponent<CharacterControllerComponent>("CharacterController", ComponentCategory::Gameplay,
                                                  "Player controller (third / first person)");
  RegisterComponent<HealthComponent>("Health", ComponentCategory::Gameplay, "Hit points and damage");
  RegisterComponent<PickupComponent>("Pickup", ComponentCategory::Gameplay, "Collectable item");
  RegisterComponent<DoorComponent>("Door", ComponentCategory::Gameplay, "Trigger / interaction door");
  RegisterComponent<InteractableComponent>("Interactable", ComponentCategory::Gameplay,
                                           "Player interaction target");
  RegisterComponent<TriggerVolumeComponent>("TriggerVolume", ComponentCategory::Gameplay,
                                            "Fires an action when something enters");
  RegisterComponent<QuestComponent>("Quest", ComponentCategory::Gameplay, "Simple objective tracker");
  RegisterComponent<SpawnerComponent>("Spawner", ComponentCategory::Gameplay,
                                      "Clones a template object periodically");
  RegisterComponent<AudioSourceComponent>("AudioSource", ComponentCategory::Audio, "Sound emitter");
  RegisterComponent<AIComponent>("AI", ComponentCategory::AI, "NPC state machine");
  RegisterComponent<ScriptComponent>("Script", ComponentCategory::Scripting, "Gameplay script");
  NF_INFO(LogCategory::Core, "Registered %zu component types", ComponentRegistry::Get().All().size());
}

} // namespace nf
