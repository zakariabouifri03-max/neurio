// NovaForge Engine - scene/Scene.cpp
#include "scene/Scene.h"
#include "physics/PhysicsWorld.h"
#include "core/Log.h"
#include "core/StringUtil.h"

namespace nf {

static AssetDatabase& NullAssets() {
  static AssetDatabase fallback;
  return fallback;
}

Scene::Scene() {}
Scene::~Scene() = default;

// ------------------------------------------------------------------ objects
EntityId Scene::CreateObject(const std::string& name, EntityId parent) {
  auto object = std::make_unique<GameObject>();
  object->id = nextId_++;
  object->name = name.empty() ? "Object" : UniqueName(name);
  object->parent = 0;
  GameObject* raw = object.get();
  objects_.push_back(std::move(object));
  index_[raw->id] = raw;

  // every object gets a Transform; it is the one component that is never optional
  auto transform = std::make_unique<TransformComponent>();
  transform->owner = raw->id;
  raw->components.push_back(std::move(transform));

  if (parent != 0 && index_.count(parent)) {
    raw->parent = parent;
    index_[parent]->children.push_back(raw->id);
  }
  MarkTransformDirty(raw->id);
  dirty_ = true;
  return raw->id;
}

EntityId Scene::CreateFromTemplate(const GameObject& templateObject, const std::string& name,
                                   const Vec3& positionOffset) {
  EntityId root = CreateObject(name.empty() ? templateObject.name : name, 0);
  GameObject* rootObject = Get(root);
  if (!rootObject) return 0;
  rootObject->tag = templateObject.tag;
  rootObject->active = templateObject.active;
  rootObject->fromTemplate = true;
  rootObject->templateSource = templateObject.templateSource.empty() ? templateObject.name
                                                                    : templateObject.templateSource;

  // copy components (skip the default transform, then overwrite it)
  for (auto& component : templateObject.components) {
    if (strcmp(component->TypeName(), "Transform") == 0) continue;
    auto clone = ComponentRegistry::Get().Create(component->TypeName());
    if (!clone) continue;
    clone->Deserialize(component->Serialize());
    clone->enabled = component->enabled;
    AttachComponent(root, std::unique_ptr<ComponentBase>(clone));
  }
  if (auto* transform = rootObject->Transform()) {
    if (auto* source = templateObject.Transform()) *transform = *source;
    transform->position += positionOffset;
  }
  return root;
}

EntityId Scene::InstantiateSceneAsChild(EntityId parent, Scene& sourceScene, const std::string& name) {
  EntityId root = 0;
  // copy every object of the source scene, preserving hierarchy
  std::unordered_map<EntityId, EntityId> remap;
  for (auto& object : sourceScene.AllObjects()) {
    EntityId newId = CreateObject(object->name, 0);
    GameObject* created = Get(newId);
    if (!created) continue;
    created->tag = object->tag;
    created->active = object->active;
    remap[object->id] = newId;
    if (root == 0) root = newId;
    for (auto& component : object->components) {
      if (strcmp(component->TypeName(), "Transform") == 0) continue;
      auto clone = ComponentRegistry::Get().Create(component->TypeName());
      if (!clone) continue;
      clone->Deserialize(component->Serialize());
      AttachComponent(newId, std::unique_ptr<ComponentBase>(clone));
    }
    if (auto* transform = created->Transform()) {
      if (auto* source = object->Transform()) *transform = *source;
    }
  }
  // rebuild the hierarchy inside the instantiated copy
  for (auto& object : sourceScene.AllObjects()) {
    auto it = remap.find(object->id);
    if (it == remap.end()) continue;
    if (object->parent != 0) {
      auto parentIt = remap.find(object->parent);
      if (parentIt != remap.end()) SetParent(it->second, parentIt->second, false);
    }
    if (auto* transform = sourceScene.Get(object->id)) {
      NF_UNUSED(transform);
    }
  }
  if (root != 0 && parent != 0) SetParent(root, parent, false);
  if (Get(root) && !name.empty()) Get(root)->name = UniqueName(name);
  return root;
}

void Scene::DestroyObject(EntityId id) {
  GameObject* object = Get(id);
  if (!object) return;
  std::vector<EntityId> toDestroy;
  CollectDescendants(id, toDestroy);
  toDestroy.push_back(id);

  for (EntityId victim : toDestroy) {
    GameObject* target = Get(victim);
    if (!target) continue;
    for (auto& component : target->components) {
      if (playing_) component->OnDetach(*this);
      component->OnDetach(*this);
    }
    if (target->parent != 0) {
      GameObject* parent = Get(target->parent);
      if (parent) {
        parent->children.erase(std::remove(parent->children.begin(), parent->children.end(), victim),
                               parent->children.end());
      }
    }
    worldCache_.erase(victim);
    dirtyTransforms_.erase(victim);
    index_.erase(victim);
    objects_.erase(std::remove_if(objects_.begin(), objects_.end(),
                                  [victim](const std::unique_ptr<GameObject>& o) {
                                    return o->id == victim;
                                  }),
                   objects_.end());
    if (playerEntity_ == victim) playerEntity_ = 0;
  }
  MarkTransformDirty(id);
  dirty_ = true;
}

void Scene::Clear() {
  objects_.clear();
  index_.clear();
  worldCache_.clear();
  dirtyTransforms_.clear();
  events_.clear();
  nextId_ = 1;
  playerEntity_ = 0;
  allTransformsDirty_ = true;
  dirty_ = false;
}

void Scene::RebuildIndex() {
  index_.clear();
  for (auto& object : objects_) index_[object->id] = object.get();
  EntityId maxId = 1;
  for (auto& object : objects_) maxId = std::max(maxId, object->id);
  nextId_ = maxId + 1;
  allTransformsDirty_ = true;
}

std::vector<EntityId> Scene::ObjectIds() const {
  std::vector<EntityId> ids;
  ids.reserve(objects_.size());
  for (auto& o : objects_) ids.push_back(o->id);
  return ids;
}

std::vector<EntityId> Scene::RootIds() const {
  std::vector<EntityId> ids;
  for (auto& o : objects_)
    if (o->parent == 0) ids.push_back(o->id);
  return ids;
}

EntityId Scene::FindByName(const std::string& name) const {
  for (auto& o : objects_)
    if (o->name == name) return o->id;
  return 0;
}

std::vector<EntityId> Scene::FindByTag(const std::string& tag) const {
  std::vector<EntityId> out;
  for (auto& o : objects_)
    if (o->tag == tag) out.push_back(o->id);
  return out;
}

std::vector<EntityId> Scene::FindAllWithComponent(const char* typeName) const {
  std::vector<EntityId> out;
  for (auto& o : objects_)
    if (o->Has(typeName)) out.push_back(o->id);
  return out;
}

std::string Scene::UniqueName(const std::string& baseName) const {
  if (!FindByName(baseName)) return baseName;
  // strip an existing numeric suffix
  std::string stem = baseName;
  usize pos = stem.find_last_of('_');
  if (pos != std::string::npos && pos + 1 < stem.size()) {
    bool numeric = true;
    for (usize i = pos + 1; i < stem.size(); i++)
      if (!std::isdigit((unsigned char)stem[i])) { numeric = false; break; }
    if (numeric) stem = stem.substr(0, pos);
  }
  for (int i = 1; i < 100000; i++) {
    std::string candidate = stem + "_" + std::to_string(i);
    if (!FindByName(candidate)) return candidate;
  }
  return baseName;
}

std::string Scene::UniqueTag(const std::string& base) const { return base; }

// ------------------------------------------------------------------ hierarchy
bool Scene::SetParent(EntityId child, EntityId parent, bool keepWorldTransform) {
  GameObject* childObject = Get(child);
  if (!childObject) return false;
  if (child == parent) return false;
  if (parent != 0 && (!Get(parent) || IsAncestorOf(child, parent))) return false;

  Transform world;
  if (keepWorldTransform) world = WorldTransform(child);

  if (childObject->parent != 0) {
    GameObject* oldParent = Get(childObject->parent);
    if (oldParent)
      oldParent->children.erase(
          std::remove(oldParent->children.begin(), oldParent->children.end(), child),
          oldParent->children.end());
  }
  childObject->parent = parent;
  if (parent != 0) {
    GameObject* newParent = Get(parent);
    if (newParent) newParent->children.push_back(child);
  }
  MarkTransformDirty(child);
  if (keepWorldTransform) SetWorldTransform(child, world);
  dirty_ = true;
  return true;
}

EntityId Scene::ParentOf(EntityId id) const {
  const GameObject* object = Get(id);
  return object ? object->parent : 0;
}

std::vector<EntityId> Scene::ChildrenOf(EntityId id) const {
  const GameObject* object = Get(id);
  return object ? object->children : std::vector<EntityId>{};
}

bool Scene::IsAncestorOf(EntityId ancestor, EntityId descendant) const {
  EntityId current = descendant;
  while (current != 0) {
    const GameObject* object = Get(current);
    if (!object) return false;
    if (object->parent == ancestor) return true;
    current = object->parent;
  }
  return false;
}

int Scene::DepthOf(EntityId id) const {
  int depth = 0;
  EntityId current = id;
  while (current != 0) {
    const GameObject* object = Get(current);
    if (!object) break;
    current = object->parent;
    depth++;
    if (depth > 512) break;
  }
  return depth;
}

void Scene::MoveInParentOrder(EntityId id, int delta) {
  GameObject* object = Get(id);
  if (!object) return;
  std::vector<EntityId> order = ObjectIds();
  auto it = std::find(order.begin(), order.end(), id);
  if (it == order.end()) return;
  // move within the flat list so hierarchy rendering order changes
  i64 index = it - order.begin();
  i64 target = index + delta;
  if (target < 0 || target >= (i64)objects_.size()) return;
  auto found = std::find_if(objects_.begin(), objects_.end(),
                            [id](const std::unique_ptr<GameObject>& o) { return o->id == id; });
  if (found == objects_.end()) return;
  std::unique_ptr<GameObject> moved = std::move(*found);
  objects_.erase(found);
  objects_.insert(objects_.begin() + target, std::move(moved));
  dirty_ = true;
}

void Scene::CollectDescendants(EntityId id, std::vector<EntityId>& out) const {
  const GameObject* object = Get(id);
  if (!object) return;
  for (EntityId child : object->children) {
    CollectDescendants(child, out);
    out.push_back(child);
  }
}

// ------------------------------------------------------------------ components
void Scene::AttachComponent(EntityId id, std::unique_ptr<ComponentBase> component) {
  GameObject* object = Get(id);
  if (!object || !component) return;
  component->owner = id;
  component->OnAttach(*this);
  object->components.push_back(std::move(component));
  dirty_ = true;
  if (playing_) object->components.back()->OnStart(*this);
}

ComponentBase* Scene::AddComponent(EntityId id, const std::string& typeName) {
  GameObject* object = Get(id);
  if (!object) return nullptr;
  if (strcmp(typeName.c_str(), "Transform") == 0) return object->Get<TransformComponent>();
  std::unique_ptr<ComponentBase> component(ComponentRegistry::Get().Create(typeName));
  if (!component) {
    NF_ERROR(LogCategory::Scene, "Could not add component '%s' to '%s': unknown component type",
             typeName.c_str(), object->name.c_str());
    return nullptr;
  }
  ComponentBase* raw = component.get();
  AttachComponent(id, std::move(component));
  return raw;
}

bool Scene::RemoveComponent(EntityId id, const char* typeName) {
  GameObject* object = Get(id);
  if (!object) return false;
  if (strcmp(typeName, "Transform") == 0) return false;   // required
  for (usize i = 0; i < object->components.size(); i++) {
    if (strcmp(object->components[i]->TypeName(), typeName) == 0) {
      if (playing_) object->components[i]->OnDetach(*this);
      object->components[i]->OnDetach(*this);
      object->components.erase(object->components.begin() + (i64)i);
      dirty_ = true;
      MarkTransformDirty(id);
      return true;
    }
  }
  return false;
}

ComponentBase* Scene::GetComponent(EntityId id, const char* typeName) {
  GameObject* object = Get(id);
  return object ? object->Get(typeName) : nullptr;
}

// ------------------------------------------------------------------ transforms
Transform Scene::LocalTransform(EntityId id) const {
  const GameObject* object = Get(id);
  if (!object) return Transform();
  if (auto* transform = object->Transform()) return transform->ToTransform();
  return Transform();
}

Transform Scene::WorldTransform(EntityId id) const {
  auto it = worldCache_.find(id);
  if (it != worldCache_.end()) return it->second;
  return LocalTransform(id);
}

Mat4 Scene::WorldMatrix(EntityId id) const { return WorldTransform(id).Matrix(); }

void Scene::SetLocalTransform(EntityId id, const Transform& t) {
  GameObject* object = Get(id);
  if (!object) return;
  if (auto* transform = object->Transform()) transform->FromTransform(t);
  // Keep the world cache in sync for root objects. Without this, code that writes a
  // transform and immediately reads WorldTransform() again (the player controller, AI,
  // gizmo dragging) would read the value from before the write.
  if (object->parent == 0) worldCache_[id] = t;
  MarkTransformDirty(id);
}

void Scene::SetWorldTransform(EntityId id, const Transform& world) {
  GameObject* object = Get(id);
  if (!object) return;
  if (object->parent == 0) {
    SetLocalTransform(id, world);
    return;
  }
  Transform parentWorld = WorldTransform(object->parent);
  Transform inv = parentWorld.Inverse();
  Transform local;
  local.position = inv.rotation * Vec3((world.position.x - inv.position.x) / (inv.scale.x == 0 ? 1 : inv.scale.x),
                                       (world.position.y - inv.position.y) / (inv.scale.y == 0 ? 1 : inv.scale.y),
                                       (world.position.z - inv.position.z) / (inv.scale.z == 0 ? 1 : inv.scale.z));
  local.rotation = inv.rotation * world.rotation;
  local.scale = Vec3(world.scale.x / (parentWorld.scale.x == 0 ? 1 : parentWorld.scale.x),
                     world.scale.y / (parentWorld.scale.y == 0 ? 1 : parentWorld.scale.y),
                     world.scale.z / (parentWorld.scale.z == 0 ? 1 : parentWorld.scale.z));
  SetLocalTransform(id, local);
}

void Scene::SetWorldPosition(EntityId id, const Vec3& position) {
  Transform world = WorldTransform(id);
  world.position = position;
  SetWorldTransform(id, world);
}

void Scene::MarkTransformDirty(EntityId id) {
  dirtyTransforms_.insert(id);
  const GameObject* object = Get(id);
  if (object) {
    for (EntityId child : object->children) MarkTransformDirty(child);
  }
}

void Scene::UpdateTransforms() {
  if (dirtyTransforms_.empty() && !allTransformsDirty_) return;

  std::function<void(GameObject*, const Transform&, bool)> visit =
      [&](GameObject* object, const Transform& parentWorld, bool parentDirty) {
        Transform local = LocalTransform(object->id);
        bool dirty = parentDirty || allTransformsDirty_ || dirtyTransforms_.count(object->id) > 0;
        Transform world;
        if (dirty || worldCache_.find(object->id) == worldCache_.end()) {
          world.position = parentWorld.position + parentWorld.rotation * Vec3(
                               local.position.x * parentWorld.scale.x,
                               local.position.y * parentWorld.scale.y,
                               local.position.z * parentWorld.scale.z);
          world.rotation = parentWorld.rotation * local.rotation;
          world.scale = Vec3(local.scale.x * parentWorld.scale.x, local.scale.y * parentWorld.scale.y,
                             local.scale.z * parentWorld.scale.z);
          worldCache_[object->id] = world;
        } else {
          world = worldCache_[object->id];
        }
        for (EntityId childId : object->children) {
          GameObject* child = Get(childId);
          if (child) visit(child, world, dirty);
        }
      };

  Transform identity;
  for (auto& object : objects_) {
    if (object->parent != 0) continue;
    visit(object.get(), identity, false);
  }
  dirtyTransforms_.clear();
  allTransformsDirty_ = false;
}

// ------------------------------------------------------------------ simulation
void Scene::BeginPlay() {
  playing_ = true;
  events_.clear();
  allTransformsDirty_ = true;
  UpdateTransforms();
  for (auto& object : objects_)
    for (auto& component : object->components)
      if (component->enabled) component->OnStart(*this);
}

void Scene::Update(f32 deltaTime) {
  UpdateTransforms();
  for (auto& object : objects_) {
    if (!object->active) continue;
    for (auto& component : object->components) {
      if (!component->enabled) continue;
      component->OnUpdate(*this, deltaTime);
    }
  }
}

void Scene::FixedUpdate(f32 deltaTime) {
  for (auto& object : objects_) {
    if (!object->active) continue;
    for (auto& component : object->components) {
      if (!component->enabled) continue;
      component->OnFixedUpdate(*this, deltaTime);
    }
  }
}

void Scene::EndPlay() {
  for (auto& object : objects_) {
    if (!object->active) continue;
    for (auto& component : object->components)
      component->OnReset(*this);
  }
  playing_ = false;
}

void Scene::DispatchTriggerEnter(EntityId trigger, EntityId other) {
  if (recursionDepth_ > 8) return;
  recursionDepth_++;
  if (ComponentBase* c = GetComponent(trigger, "TriggerVolume")) c->OnTriggerEnter(*this, other);
  if (ComponentBase* c = GetComponent(other, "TriggerVolume")) c->OnTriggerEnter(*this, trigger);
  if (ComponentBase* c = GetComponent(trigger, "Door")) c->OnTriggerEnter(*this, other);
  if (ComponentBase* c = GetComponent(other, "Door")) c->OnTriggerEnter(*this, trigger);
  if (ComponentBase* c = GetComponent(trigger, "Script")) c->OnTriggerEnter(*this, other);
  if (ComponentBase* c = GetComponent(other, "Script")) c->OnTriggerEnter(*this, trigger);
  if (ComponentBase* c = GetComponent(trigger, "Pickup")) c->OnTriggerEnter(*this, other);
  if (ComponentBase* c = GetComponent(other, "Pickup")) c->OnTriggerEnter(*this, trigger);
  recursionDepth_--;
}

void Scene::DispatchTriggerExit(EntityId trigger, EntityId other) {
  if (ComponentBase* c = GetComponent(trigger, "TriggerVolume")) c->OnTriggerExit(*this, other);
  if (ComponentBase* c = GetComponent(other, "TriggerVolume")) c->OnTriggerExit(*this, trigger);
  if (ComponentBase* c = GetComponent(trigger, "Door")) c->OnTriggerExit(*this, other);
  if (ComponentBase* c = GetComponent(other, "Door")) c->OnTriggerExit(*this, trigger);
}

void Scene::DispatchCollisionEnter(EntityId a, EntityId b) {
  if (ComponentBase* c = GetComponent(a, "Script")) c->OnCollisionEnter(*this, b);
  if (ComponentBase* c = GetComponent(b, "Script")) c->OnCollisionEnter(*this, a);
}

void Scene::DispatchCollisionExit(EntityId a, EntityId b) {
  if (ComponentBase* c = GetComponent(a, "Script")) c->OnCollisionExit(*this, b);
  if (ComponentBase* c = GetComponent(b, "Script")) c->OnCollisionExit(*this, a);
}

void Scene::ApplyDamage(EntityId target, f32 amount, EntityId source) {
  GameObject* object = Get(target);
  if (!object) return;
  for (auto& component : object->components) component->OnDamage(*this, amount, source);
}

// ------------------------------------------------------------------ queries
RayHit Scene::Raycast(const Ray& ray, f32 maxDistance, bool includeTriggers) const {
  RayHit best;
  best.distance = maxDistance;
  if (physics_) {
    PhysicsRayHit hit;
    if (physics_->Raycast(ray, maxDistance, includeTriggers, &hit)) {
      best.hit = true;
      best.distance = hit.distance;
      best.point = hit.point;
      best.normal = hit.normal;
      best.entity = hit.entity;
    }
    return best;
  }
  // CPU fallback: bounds test + triangle test against the mesh asset
  const_cast<Scene*>(this)->UpdateTransforms();
  for (auto& object : objects_) {
    if (!object->active) continue;
    const ColliderComponent* collider = object->Get<ColliderComponent>();
    if (collider && collider->isTrigger && !includeTriggers) continue;
    AABB bounds = WorldBounds(object->id);
    f32 t = 0;
    if (!RaycastAABB(ray, bounds, &t)) continue;
    if (t > best.distance) continue;
    auto* renderer = object->Get<MeshRendererComponent>();
    if (renderer && renderer->visible) {
      Mat4 world = WorldMatrix(object->id);
      Mat4 inverse = world.Inverse();
      Ray localRay;
      localRay.origin = inverse.TransformPoint(ray.origin);
      localRay.direction = Normalize(inverse.TransformDir(ray.direction));
      std::string error;
      auto mesh = renderer->ResolveMesh(assets_ ? *assets_ : NullAssets(), &error);
      if (mesh) {
        for (usize i = 0; i + 2 < mesh->indices.size(); i += 3) {
          u32 i0 = mesh->indices[i], i1 = mesh->indices[i + 1], i2 = mesh->indices[i + 2];
          if (i0 >= mesh->vertices.size() || i1 >= mesh->vertices.size() || i2 >= mesh->vertices.size())
            continue;
          f32 tt = 0;
          if (RaycastTriangle(localRay, mesh->vertices[i0].position, mesh->vertices[i1].position,
                              mesh->vertices[i2].position, &tt)) {
            Vec3 localPoint = localRay.origin + localRay.direction * tt;
            Vec3 worldPoint = world.TransformPoint(localPoint);
            f32 worldDistance = Distance(worldPoint, ray.origin);
            if (worldDistance < best.distance) {
              best.hit = true;
              best.distance = worldDistance;
              best.point = worldPoint;
              Vec3 a = mesh->vertices[i0].position, b = mesh->vertices[i1].position,
                   c = mesh->vertices[i2].position;
              best.normal = Normalize(world.NormalMatrix().TransformDir(Normalize(Cross(b - a, c - a))));
              best.entity = object->id;
            }
          }
        }
        continue;
      }
    }
    if (t < best.distance) {
      best.hit = true;
      best.distance = t;
      best.point = ray.At(t);
      best.normal = Vec3(0, 1, 0);
      best.entity = object->id;
    }
  }
  return best;
}

std::vector<EntityId> Scene::QuerySphere(const Vec3& center, f32 radius,
                                         const std::string& tag) const {
  std::vector<EntityId> out;
  const_cast<Scene*>(this)->UpdateTransforms();
  f32 radiusSq = radius * radius;
  for (auto& object : objects_) {
    if (!object->active) continue;
    if (!tag.empty() && object->tag != tag) continue;
    Vec3 position = WorldTransform(object->id).position;
    if (LengthSq(position - center) <= radiusSq) out.push_back(object->id);
  }
  return out;
}

AABB Scene::WorldBounds(EntityId id) const {
  const GameObject* object = Get(id);
  if (!object) return AABB{};
  Transform world = WorldTransform(id);
  AABB local{Vec3(1e30f), Vec3(-1e30f)};
  bool any = false;
  if (const ColliderComponent* collider = object->Get<ColliderComponent>()) {
    local = collider->LocalBounds();
    any = true;
  } else if (const MeshRendererComponent* renderer = object->Get<MeshRendererComponent>()) {
    std::string error;
    auto mesh = renderer->ResolveMesh(assets_ ? *assets_ : NullAssets(), &error);
    if (mesh) {
      local = mesh->bounds;
      local.min = Vec3(local.min.x * world.scale.x, local.min.y * world.scale.y, local.min.z * world.scale.z);
      local.max = Vec3(local.max.x * world.scale.x, local.max.y * world.scale.y, local.max.z * world.scale.z);
      any = true;
    }
  }
  if (!any) {
    // fall back to a small box so the object stays selectable
    local = AABB{Vec3(-0.25f), Vec3(0.25f)};
  }
  Mat4 matrix = world.Matrix();
  return AABB::Transform(local, matrix);
}

EntityId Scene::PrimaryCamera() const { return FindPrimaryCamera(); }

EntityId Scene::FindPrimaryCamera() const {
  for (auto& object : objects_) {
    const CameraComponent* camera = object->Get<CameraComponent>();
    if (camera && camera->isPrimary) return object->id;
  }
  for (auto& object : objects_)
    if (object->Has("Camera")) return object->id;
  return 0;
}

void Scene::PublishEvent(const std::string& event) {
  if (event.empty()) return;
  events_.push_back(event);
  NF_INFO(LogCategory::Runtime, "Event: %s", event.c_str());
}

SceneStats Scene::GatherStats() const {
  SceneStats stats;
  stats.objects = objects_.size();
  for (auto& object : objects_) {
    const MeshRendererComponent* renderer = object->Get<MeshRendererComponent>();
    if (renderer && renderer->visible) {
      stats.renderables++;
      std::string error;
      auto mesh = renderer->ResolveMesh(assets_ ? *assets_ : NullAssets(), &error);
      if (mesh) {
        stats.vertices += mesh->VertexCount();
        stats.triangles += mesh->TriangleCount();
      }
    }
    if (object->Has("Light")) stats.lights++;
    if (object->Has("Collider")) stats.colliders++;
    if (object->Has("Rigidbody")) stats.physicsBodies++;
  }
  return stats;
}

void Scene::PopulateStarterScene(Scene& scene) {
  // ground
  EntityId ground = scene.CreateObject("Ground");
  auto* groundRenderer = scene.AddComponent<MeshRendererComponent>(ground);
  groundRenderer->meshSource = 0;
  groundRenderer->primitive = "Plane";
  groundRenderer->baseColor = Vec4(0.34f, 0.42f, 0.30f, 1.0f);
  groundRenderer->uvTiling = 12.0f;
  groundRenderer->roughness = 0.9f;
  if (auto* transform = scene.Get(ground)->Transform()) {
    transform->scale = Vec3(4, 1, 4);
  }
  scene.Get(ground)->tag = "Ground";
  auto* groundCollider = scene.AddComponent<ColliderComponent>(ground);
  groundCollider->shape = (i32)ColliderShape::Box;
  groundCollider->size = Vec3(1, 0.1f, 1);
  groundCollider->center = Vec3(0, -0.05f, 0);
  scene.AddComponent<RigidbodyComponent>(ground)->isKinematic = true;

  // sun
  EntityId sun = scene.CreateObject("DirectionalLight");
  auto* light = scene.AddComponent<LightComponent>(sun);
  light->lightType = (i32)LightType::Directional;
  light->intensity = 1.35f;
  light->color = Vec3(1.0f, 0.96f, 0.88f);
  if (auto* transform = scene.Get(sun)->Transform())
    transform->rotationEuler = Vec3(-48.0f, -35.0f, 0.0f);

  // camera
  EntityId camera = scene.CreateObject("Camera");
  auto* cameraComponent = scene.AddComponent<CameraComponent>(camera);
  cameraComponent->isPrimary = true;
  if (auto* transform = scene.Get(camera)->Transform())
    transform->position = Vec3(0, 6, 12);

  // player
  EntityId player = scene.CreateObject("Player");
  scene.Get(player)->tag = "Player";
  auto* playerRenderer = scene.AddComponent<MeshRendererComponent>(player);
  playerRenderer->meshSource = 0;
  playerRenderer->primitive = "Capsule";
  playerRenderer->baseColor = Vec4(0.25f, 0.55f, 0.95f, 1.0f);
  if (auto* transform = scene.Get(player)->Transform())
    transform->position = Vec3(0, 1.2f, 4);
  scene.AddComponent<CharacterControllerComponent>(player);
  auto* health = scene.AddComponent<HealthComponent>(player);
  health->isPlayer = true;
  scene.SetPlayerEntity(player);
  scene.SetDirty(true);
}

} // namespace nf
