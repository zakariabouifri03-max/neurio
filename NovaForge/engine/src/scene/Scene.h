// NovaForge Engine - scene/Scene.h
// The scene: objects, hierarchy, components, transforms, serialisation and
// simulation dispatch. One Scene type is used by the editor, play mode and the
// exported game.
#pragma once

#include "core/Base.h"
#include "core/Json.h"
#include "scene/GameObject.h"
#include "assets/AssetDatabase.h"
#include <unordered_map>
#include <unordered_set>

namespace nf {

class PhysicsWorld;
class AudioSystem;
class GameRuntime;
class DebugDrawList;
namespace platform { class InputState; }

struct SceneEnvironment {
  Vec3 ambientColor{0.32f, 0.35f, 0.42f};
  f32 ambientIntensity = 1.0f;
  Vec3 skyTop{0.35f, 0.55f, 0.90f};
  Vec3 skyBottom{0.80f, 0.85f, 0.95f};
  Vec3 fogColor{0.62f, 0.70f, 0.82f};
  bool fogEnabled = false;
  f32 fogStart = 30.0f;
  f32 fogEnd = 180.0f;
  Vec3 gravity{0.0f, -20.0f, 0.0f};
  bool fogAffectsSky = false;
  bool showGrid = true;
  f32 gridSpacing = 1.0f;
  bool showSkybox = true;
};

struct SceneStats {
  usize objects = 0;
  usize renderables = 0;
  usize vertices = 0;
  usize triangles = 0;
  usize lights = 0;
  usize colliders = 0;
  usize physicsBodies = 0;
};

class Scene {
public:
  Scene();
  ~Scene();

  NF_NONCOPYABLE(Scene)

  // ---- services (set by the runtime / editor before use)
  void SetAssets(AssetDatabase* assets) { assets_ = assets; }
  AssetDatabase& Assets() { return *assets_; }
  const AssetDatabase& Assets() const { return *assets_; }
  void SetPhysics(PhysicsWorld* physics) { physics_ = physics; }
  PhysicsWorld* Physics() { return physics_; }
  void SetAudio(AudioSystem* audio) { audio_ = audio; }
  AudioSystem* Audio() { return audio_; }
  void SetInput(platform::InputState* input) { input_ = input; }
  platform::InputState* Input() { return input_; }
  void SetRuntime(GameRuntime* runtime) { runtime_ = runtime; }
  // Wireframe overlay sink used by component gizmos in the editor viewport (may be null).
  void SetDebugDraw(DebugDrawList* draw) { debugDraw_ = draw; }
  DebugDrawList* DebugDraw() { return debugDraw_; }
  GameRuntime* Runtime() { return runtime_; }
  bool HasPhysics() const { return physics_ != nullptr; }
  bool InPlayMode() const { return playing_; }
  void SetPlaying(bool playing) { playing_ = playing; }

  // ---- identity
  const std::string& Name() const { return name_; }
  void SetName(const std::string& name) { name_ = name; }
  const std::string& FilePath() const { return filePath_; }
  void SetFilePath(const std::string& path) { filePath_ = path; }
  bool IsDirty() const { return dirty_; }
  void SetDirty(bool dirty) { dirty_ = dirty; }

  // ---- object management
  EntityId CreateObject(const std::string& name, EntityId parent = 0);
  EntityId CreateFromTemplate(const GameObject& templateObject, const std::string& name,
                              const Vec3& positionOffset = Vec3(0, 0, 0));
  EntityId InstantiateSceneAsChild(EntityId parent, class Scene& sourceScene, const std::string& name);
  void DestroyObject(EntityId id);
  void Clear();
  GameObject* Get(EntityId id) {
    auto it = index_.find(id);
    return it == index_.end() ? nullptr : it->second;
  }
  const GameObject* Get(EntityId id) const {
    auto it = index_.find(id);
    return it == index_.end() ? nullptr : it->second;
  }
  bool IsValid(EntityId id) const { return index_.count(id) > 0; }
  usize ObjectCount() const { return objects_.size(); }
  const std::vector<std::unique_ptr<GameObject>>& AllObjects() const { return objects_; }
  std::vector<EntityId> ObjectIds() const;
  std::vector<EntityId> RootIds() const;
  EntityId FindByName(const std::string& name) const;
  std::vector<EntityId> FindByTag(const std::string& tag) const;
  std::vector<EntityId> FindAllWithComponent(const char* typeName) const;
  std::string UniqueName(const std::string& baseName) const;
  std::string UniqueTag(const std::string& base) const;

  // ---- hierarchy
  bool SetParent(EntityId child, EntityId parent, bool keepWorldTransform = true);
  EntityId ParentOf(EntityId id) const;
  std::vector<EntityId> ChildrenOf(EntityId id) const;
  bool IsAncestorOf(EntityId ancestor, EntityId descendant) const;
  int DepthOf(EntityId id) const;
  void MoveInParentOrder(EntityId id, int delta);

  // ---- components
  ComponentBase* AddComponent(EntityId id, const std::string& typeName);
  template <typename T>
  T* AddComponent(EntityId id) {
    return static_cast<T*>(AddComponent(id, T::kTypeName));
  }
  bool RemoveComponent(EntityId id, const char* typeName);
  ComponentBase* GetComponent(EntityId id, const char* typeName);
  template <typename T>
  T* GetComponent(EntityId id) {
    GameObject* object = Get(id);
    return object ? object->Get<T>() : nullptr;
  }
  bool HasComponent(EntityId id, const char* typeName) const {
    const GameObject* object = Get(id);
    return object ? object->Has(typeName) : false;
  }
  template <typename T>
  bool HasComponent(EntityId id) const {
    return HasComponent(id, T::kTypeName);
  }

  // ---- transforms (hierarchy aware, cached)
  Transform LocalTransform(EntityId id) const;
  Transform WorldTransform(EntityId id) const;
  Mat4 WorldMatrix(EntityId id) const;
  void SetLocalTransform(EntityId id, const Transform& t);
  void SetWorldTransform(EntityId id, const Transform& t);
  void SetWorldPosition(EntityId id, const Vec3& position);
  void MarkTransformDirty(EntityId id);
  void UpdateTransforms();

  // ---- simulation
  void BeginPlay();                 // OnStart for every component
  void Update(f32 deltaTime);       // OnUpdate
  void FixedUpdate(f32 deltaTime);  // OnFixedUpdate
  void EndPlay();                   // OnReset (restores editable state)
  void DispatchTriggerEnter(EntityId trigger, EntityId other);
  void DispatchTriggerExit(EntityId trigger, EntityId other);
  void DispatchCollisionEnter(EntityId a, EntityId b);
  void DispatchCollisionExit(EntityId a, EntityId b);
  void ApplyDamage(EntityId target, f32 amount, EntityId source);

  // ---- queries
  RayHit Raycast(const Ray& ray, f32 maxDistance = 1000.0f, bool includeTriggers = false) const;
  std::vector<EntityId> QuerySphere(const Vec3& center, f32 radius, const std::string& tag = "") const;
  AABB WorldBounds(EntityId id) const;    // from collider or mesh bounds
  EntityId PlayerEntity() const { return playerEntity_; }
  void SetPlayerEntity(EntityId id) { playerEntity_ = id; }
  EntityId PrimaryCamera() const;
  EntityId FindPrimaryCamera() const;

  // ---- events (read by the HUD/log; cleared each frame by the runtime)
  void PublishEvent(const std::string& event);
  const std::vector<std::string>& Events() const { return events_; }
  std::vector<std::string>& EventsMutable() { return events_; }
  void ClearEvents() { events_.clear(); }

  // ---- environment
  SceneEnvironment& Environment() { return environment_; }
  const SceneEnvironment& Environment() const { return environment_; }

  // ---- statistics
  SceneStats GatherStats() const;

  // ---- serialisation (.nfscene - human readable JSON)
  JsonValue Serialize() const;
  bool Deserialize(const JsonValue& doc, std::string* error = nullptr);
  bool SaveToFile(const std::string& path, std::string* error = nullptr);
  bool LoadFromFile(const std::string& path, std::string* error = nullptr);

  // Creates a scene containing the default starter level (ground, light, camera).
  static void PopulateStarterScene(Scene& scene);

private:
  void CollectDescendants(EntityId id, std::vector<EntityId>& out) const;
  void AttachComponent(EntityId id, std::unique_ptr<ComponentBase> component);
  void RebuildIndex();

  std::vector<std::unique_ptr<GameObject>> objects_;
  std::unordered_map<EntityId, GameObject*> index_;
  EntityId nextId_ = 1;

  std::string name_ = "Untitled";
  std::string filePath_;
  bool dirty_ = false;
  bool playing_ = false;

  // transform cache
  std::unordered_map<EntityId, Transform> worldCache_;
  std::unordered_set<EntityId> dirtyTransforms_;
  bool allTransformsDirty_ = true;

  SceneEnvironment environment_;
  std::vector<std::string> events_;
  EntityId playerEntity_ = 0;
  u32 recursionDepth_ = 0;

  AssetDatabase* assets_ = nullptr;
  PhysicsWorld* physics_ = nullptr;
  AudioSystem* audio_ = nullptr;
  GameRuntime* runtime_ = nullptr;
  DebugDrawList* debugDraw_ = nullptr;
  platform::InputState* input_ = nullptr;
};

} // namespace nf
