// NovaForge Engine - scene graph (entities, hierarchy, world transforms)
#pragma once
#include "core/json.h"
#include "core/math.h"
#include "scene/components.h"

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace nf {

class ModelInstance;
struct Model;

using EntityId = uint32_t;
constexpr EntityId kInvalidEntity = 0;

struct Entity {
    EntityId id = kInvalidEntity;
    std::string name = "Entity";
    std::string tag;                     // "Player", "Enemy", "Pickup", "Door", "Ground"...
    EntityId parent = kInvalidEntity;
    std::vector<EntityId> children;
    bool active = true;
    Transform transform;

    // components (payload = "this entity has that component")
    std::optional<MeshRendererComponent> mesh;
    std::optional<CameraComponent> camera;
    std::optional<LightComponent> light;
    std::optional<ColliderComponent> collider;
    std::optional<RigidBodyComponent> rigidbody;
    std::optional<CharacterComponent> character;
    std::optional<NPCComponent> npc;
    std::optional<HealthComponent> health;
    std::optional<TriggerComponent> trigger;
    std::optional<InteractableComponent> interactable;
    std::optional<DoorComponent> door;
    std::optional<AudioSourceComponent> audio;
    std::optional<AnimatorComponent> animator;
    std::optional<ScriptComponent> script;
    std::optional<ParticleComponent> particles;

    bool has(ComponentType t) const;
    // Runtime-only state, never serialized:
    std::shared_ptr<ModelInstance> modelInstance;
    int rigidBodyIndex = -1;        // physics body handle (assigned when play starts)
    int characterIndex = -1;        // bullet character controller handle
    Mat4 cachedWorld = Mat4();
    bool worldDirty = true;

    std::string displayName() const { return name.empty() ? ("Entity " + std::to_string(id)) : name; }
};

class Scene {
public:
    Scene() { clear(); }

    void clear();
    std::string name = "Untitled Scene";
    std::string path;                 // project relative .nfscene.json ("" = unsaved)

    EntityId createEntity(const std::string& name, EntityId parent = kInvalidEntity);
    EntityId createFromModel(const std::string& name, const std::string& modelPath,
                             EntityId parent = kInvalidEntity);
    void destroyEntity(EntityId id, bool recursive = true);
    void destroyAllEntities() { clear(); }

    Entity* get(EntityId id);
    const Entity* get(EntityId id) const;
    bool valid(EntityId id) const { return entities_.find(id) != entities_.end(); }
    size_t count() const { return entities_.size(); }

    const std::map<EntityId, Entity>& entities() const { return entities_; }
    std::vector<Entity*> allEntities();
    std::vector<EntityId> roots() const;
    std::vector<EntityId> childrenOf(EntityId id) const;
    std::vector<EntityId> findByTag(const std::string& tag) const;
    std::vector<EntityId> findByComponent(ComponentType type) const;
    EntityId findByName(const std::string& name) const;
    EntityId firstByTag(const std::string& tag) const;
    EntityId findByScript(const std::string& scriptPath) const;

    void setParent(EntityId child, EntityId parent, bool keepWorldTransform = true);
    bool isAncestor(EntityId ancestor, EntityId id) const;

    void renameEntity(EntityId id, const std::string& newName);
    EntityId duplicateEntity(EntityId id, bool recursive = true);
    std::vector<EntityId> duplicateEntities(const std::vector<EntityId>& ids);

    // transforms
    void markDirty(EntityId id);
    void markAllDirty();
    void updateTransforms();
    Mat4 worldMatrix(EntityId id);
    Vec3 worldPosition(EntityId id);
    Quat worldRotation(EntityId id);
    void setWorldPosition(EntityId id, const Vec3& worldPos);
    void setWorldRotation(EntityId id, const Quat& worldRot);
    Vec3 forward(EntityId id);
    Vec3 up(EntityId id);

    // component helpers
    template <typename T>
    T* add(EntityId id);
    template <typename T>
    T* getComponent(EntityId id);
    template <typename T>
    const T* getComponent(EntityId id) const;
    bool removeComponent(EntityId id, ComponentType type);
    bool hasComponent(EntityId id, ComponentType type) const;
    std::vector<ComponentType> componentsOf(EntityId id) const;

    // serialization (JSON, human readable; see docs/FILE_FORMATS.md)
    Json toJson() const;
    bool fromJson(const Json& j, std::string* error = nullptr);
    bool save(const std::string& absoluteOrProjectRelativePath) const;
    bool load(const std::string& absoluteOrProjectRelativePath, std::string* error = nullptr);

    // Runtime state for a play session snapshot
    void resetRuntimeState();

    EntityId activeCamera() const;
    AABB worldBounds();

private:
    std::map<EntityId, Entity> entities_;
    EntityId nextId_ = 1;
};

}  // namespace nf
