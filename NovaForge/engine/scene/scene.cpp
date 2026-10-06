#include "scene/scene.h"
#include "assets/asset_library.h"
#include "assets/model.h"
#include "core/fs.h"
#include "core/log.h"

#include <algorithm>
#include <functional>
#include <type_traits>

namespace nf {

bool Entity::has(ComponentType t) const {
    switch (t) {
        case ComponentType::MeshRenderer: return mesh.has_value();
        case ComponentType::Camera: return camera.has_value();
        case ComponentType::Light: return light.has_value();
        case ComponentType::Collider: return collider.has_value();
        case ComponentType::RigidBody: return rigidbody.has_value();
        case ComponentType::Character: return character.has_value();
        case ComponentType::NPC: return npc.has_value();
        case ComponentType::Health: return health.has_value();
        case ComponentType::Trigger: return trigger.has_value();
        case ComponentType::Interactable: return interactable.has_value();
        case ComponentType::Door: return door.has_value();
        case ComponentType::AudioSource: return audio.has_value();
        case ComponentType::Animator: return animator.has_value();
        case ComponentType::Script: return script.has_value();
        case ComponentType::Particle: return particles.has_value();
        default: return false;
    }
}

// -------------------------------------------------------------- component templates
template <typename T>
static T* addTo(Entity* e);

template <>
MeshRendererComponent* addTo<MeshRendererComponent>(Entity* e) {
    if (!e->mesh) e->mesh = MeshRendererComponent();
    return &*e->mesh;
}
template <>
CameraComponent* addTo<CameraComponent>(Entity* e) {
    if (!e->camera) e->camera = CameraComponent();
    return &*e->camera;
}
template <>
LightComponent* addTo<LightComponent>(Entity* e) {
    if (!e->light) e->light = LightComponent();
    return &*e->light;
}
template <>
ColliderComponent* addTo<ColliderComponent>(Entity* e) {
    if (!e->collider) e->collider = ColliderComponent();
    return &*e->collider;
}
template <>
RigidBodyComponent* addTo<RigidBodyComponent>(Entity* e) {
    if (!e->rigidbody) e->rigidbody = RigidBodyComponent();
    return &*e->rigidbody;
}
template <>
CharacterComponent* addTo<CharacterComponent>(Entity* e) {
    if (!e->character) e->character = CharacterComponent();
    return &*e->character;
}
template <>
NPCComponent* addTo<NPCComponent>(Entity* e) {
    if (!e->npc) e->npc = NPCComponent();
    return &*e->npc;
}
template <>
HealthComponent* addTo<HealthComponent>(Entity* e) {
    if (!e->health) e->health = HealthComponent();
    return &*e->health;
}
template <>
TriggerComponent* addTo<TriggerComponent>(Entity* e) {
    if (!e->trigger) e->trigger = TriggerComponent();
    return &*e->trigger;
}
template <>
InteractableComponent* addTo<InteractableComponent>(Entity* e) {
    if (!e->interactable) e->interactable = InteractableComponent();
    return &*e->interactable;
}
template <>
DoorComponent* addTo<DoorComponent>(Entity* e) {
    if (!e->door) e->door = DoorComponent();
    return &*e->door;
}
template <>
AudioSourceComponent* addTo<AudioSourceComponent>(Entity* e) {
    if (!e->audio) e->audio = AudioSourceComponent();
    return &*e->audio;
}
template <>
AnimatorComponent* addTo<AnimatorComponent>(Entity* e) {
    if (!e->animator) e->animator = AnimatorComponent();
    return &*e->animator;
}
template <>
ScriptComponent* addTo<ScriptComponent>(Entity* e) {
    if (!e->script) e->script = ScriptComponent();
    return &*e->script;
}
template <>
ParticleComponent* addTo<ParticleComponent>(Entity* e) {
    if (!e->particles) e->particles = ParticleComponent();
    return &*e->particles;
}

template <typename T>
T* Scene::add(EntityId id) {
    Entity* e = get(id);
    return e ? addTo<T>(e) : nullptr;
}

template MeshRendererComponent* Scene::add<MeshRendererComponent>(EntityId);
template CameraComponent* Scene::add<CameraComponent>(EntityId);
template LightComponent* Scene::add<LightComponent>(EntityId);
template ColliderComponent* Scene::add<ColliderComponent>(EntityId);
template RigidBodyComponent* Scene::add<RigidBodyComponent>(EntityId);
template CharacterComponent* Scene::add<CharacterComponent>(EntityId);
template NPCComponent* Scene::add<NPCComponent>(EntityId);
template HealthComponent* Scene::add<HealthComponent>(EntityId);
template TriggerComponent* Scene::add<TriggerComponent>(EntityId);
template InteractableComponent* Scene::add<InteractableComponent>(EntityId);
template DoorComponent* Scene::add<DoorComponent>(EntityId);
template AudioSourceComponent* Scene::add<AudioSourceComponent>(EntityId);
template AnimatorComponent* Scene::add<AnimatorComponent>(EntityId);
template ScriptComponent* Scene::add<ScriptComponent>(EntityId);
template ParticleComponent* Scene::add<ParticleComponent>(EntityId);

template <typename T>
T* Scene::getComponent(EntityId id) {
    Entity* e = get(id);
    if (!e) return nullptr;
    if constexpr (std::is_same_v<T, MeshRendererComponent>) return e->mesh ? &*e->mesh : nullptr;
    else if constexpr (std::is_same_v<T, CameraComponent>) return e->camera ? &*e->camera : nullptr;
    else if constexpr (std::is_same_v<T, LightComponent>) return e->light ? &*e->light : nullptr;
    else if constexpr (std::is_same_v<T, ColliderComponent>) return e->collider ? &*e->collider : nullptr;
    else if constexpr (std::is_same_v<T, RigidBodyComponent>) return e->rigidbody ? &*e->rigidbody : nullptr;
    else if constexpr (std::is_same_v<T, CharacterComponent>) return e->character ? &*e->character : nullptr;
    else if constexpr (std::is_same_v<T, NPCComponent>) return e->npc ? &*e->npc : nullptr;
    else if constexpr (std::is_same_v<T, HealthComponent>) return e->health ? &*e->health : nullptr;
    else if constexpr (std::is_same_v<T, TriggerComponent>) return e->trigger ? &*e->trigger : nullptr;
    else if constexpr (std::is_same_v<T, InteractableComponent>) return e->interactable ? &*e->interactable : nullptr;
    else if constexpr (std::is_same_v<T, DoorComponent>) return e->door ? &*e->door : nullptr;
    else if constexpr (std::is_same_v<T, AudioSourceComponent>) return e->audio ? &*e->audio : nullptr;
    else if constexpr (std::is_same_v<T, AnimatorComponent>) return e->animator ? &*e->animator : nullptr;
    else if constexpr (std::is_same_v<T, ScriptComponent>) return e->script ? &*e->script : nullptr;
    else if constexpr (std::is_same_v<T, ParticleComponent>) return e->particles ? &*e->particles : nullptr;
    else return nullptr;
}

template MeshRendererComponent* Scene::getComponent<MeshRendererComponent>(EntityId);
template CameraComponent* Scene::getComponent<CameraComponent>(EntityId);
template LightComponent* Scene::getComponent<LightComponent>(EntityId);
template ColliderComponent* Scene::getComponent<ColliderComponent>(EntityId);
template RigidBodyComponent* Scene::getComponent<RigidBodyComponent>(EntityId);
template CharacterComponent* Scene::getComponent<CharacterComponent>(EntityId);
template NPCComponent* Scene::getComponent<NPCComponent>(EntityId);
template HealthComponent* Scene::getComponent<HealthComponent>(EntityId);
template TriggerComponent* Scene::getComponent<TriggerComponent>(EntityId);
template InteractableComponent* Scene::getComponent<InteractableComponent>(EntityId);
template DoorComponent* Scene::getComponent<DoorComponent>(EntityId);
template AudioSourceComponent* Scene::getComponent<AudioSourceComponent>(EntityId);
template AnimatorComponent* Scene::getComponent<AnimatorComponent>(EntityId);
template ScriptComponent* Scene::getComponent<ScriptComponent>(EntityId);
template ParticleComponent* Scene::getComponent<ParticleComponent>(EntityId);

// -------------------------------------------------------------- lifetime
void Scene::clear() {
    entities_.clear();
    nextId_ = 1;
    name = "Untitled Scene";
    path.clear();
}

EntityId Scene::createEntity(const std::string& entityName, EntityId parent) {
    EntityId id = nextId_++;
    Entity e;
    e.id = id;
    e.name = entityName.empty() ? ("Entity " + std::to_string(id)) : entityName;
    e.parent = valid(parent) ? parent : kInvalidEntity;
    e.worldDirty = true;
    entities_[id] = std::move(e);
    if (valid(parent)) {
        Entity* p = get(parent);
        if (p) p->children.push_back(id);
    }
    return id;
}

EntityId Scene::createFromModel(const std::string& entityName, const std::string& modelPath,
                                EntityId parent) {
    EntityId id = createEntity(entityName, parent);
    Entity* e = get(id);
    if (e) {
        e->mesh = MeshRendererComponent();
        e->mesh->modelPath = modelPath;
        // default a collider for imported models so the object is solid
        if (!AssetLibrary::isPrimitive(modelPath)) {
            auto model = AssetLibrary::get().loadModel(modelPath);
            if (model && model->bounds.valid()) {
                Vec3 ext = model->bounds.max - model->bounds.min;
                if (ext.length() > 0.001f) {
                    e->collider = ColliderComponent();
                    e->collider->shape = ColliderShape::Box;
                    e->collider->size = ext;
                    e->collider->center = model->bounds.center();
                }
            }
        }
    }
    return id;
}

void Scene::destroyEntity(EntityId id, bool recursive) {
    Entity* e = get(id);
    if (!e) return;
    // unparent
    if (valid(e->parent)) {
        Entity* p = get(e->parent);
        if (p) p->children.erase(std::remove(p->children.begin(), p->children.end(), id), p->children.end());
    }
    std::vector<EntityId> kids = e->children;
    if (recursive) {
        for (EntityId k : kids) destroyEntity(k, true);
    } else {
        for (EntityId k : kids) {
            Entity* c = get(k);
            if (c) {
                c->parent = e->parent;
                if (valid(e->parent)) {
                    Entity* p = get(e->parent);
                    if (p) p->children.push_back(k);
                }
            }
        }
    }
    entities_.erase(id);
}

Entity* Scene::get(EntityId id) {
    auto it = entities_.find(id);
    return it == entities_.end() ? nullptr : &it->second;
}
const Entity* Scene::get(EntityId id) const {
    auto it = entities_.find(id);
    return it == entities_.end() ? nullptr : &it->second;
}

std::vector<Entity*> Scene::allEntities() {
    std::vector<Entity*> out;
    out.reserve(entities_.size());
    for (auto& kv : entities_) out.push_back(&kv.second);
    return out;
}

std::vector<EntityId> Scene::roots() const {
    std::vector<EntityId> out;
    for (auto& kv : entities_)
        if (!valid(kv.second.parent)) out.push_back(kv.first);
    return out;
}

std::vector<EntityId> Scene::childrenOf(EntityId id) const {
    const Entity* e = get(id);
    return e ? e->children : std::vector<EntityId>{};
}

std::vector<EntityId> Scene::findByTag(const std::string& tag) const {
    std::vector<EntityId> out;
    for (auto& kv : entities_)
        if (kv.second.tag == tag) out.push_back(kv.first);
    return out;
}

std::vector<EntityId> Scene::findByComponent(ComponentType type) const {
    std::vector<EntityId> out;
    for (auto& kv : entities_)
        if (kv.second.has(type)) out.push_back(kv.first);
    return out;
}

EntityId Scene::findByName(const std::string& n) const {
    for (auto& kv : entities_)
        if (kv.second.name == n) return kv.first;
    return kInvalidEntity;
}

EntityId Scene::firstByTag(const std::string& tag) const {
    auto v = findByTag(tag);
    return v.empty() ? kInvalidEntity : v.front();
}

EntityId Scene::findByScript(const std::string& scriptPath) const {
    for (auto& kv : entities_) {
        if (kv.second.script && kv.second.script->scriptPath == scriptPath) return kv.first;
    }
    return kInvalidEntity;
}

void Scene::setParent(EntityId child, EntityId parent, bool keepWorldTransform) {
    if (!valid(child) || child == parent) return;
    if (valid(parent) && isAncestor(child, parent)) return;  // would create a cycle
    Entity* c = get(child);
    if (!c) return;
    Mat4 world = keepWorldTransform ? worldMatrix(child) : Mat4();
    if (valid(c->parent)) {
        Entity* old = get(c->parent);
        if (old)
            old->children.erase(std::remove(old->children.begin(), old->children.end(), child),
                                old->children.end());
    }
    c->parent = valid(parent) ? parent : kInvalidEntity;
    if (valid(parent)) get(parent)->children.push_back(child);
    markDirty(child);
    if (keepWorldTransform) {
        Mat4 pw = valid(parent) ? worldMatrix(parent) : Mat4();
        Mat4 local = pw.inverse() * world;
        Vec3 t, s;
        Quat r;
        local.decompose(t, r, s);
        c->transform.position = t;
        c->transform.rotation = r;
        c->transform.scale = s;
        markDirty(child);
    }
}

bool Scene::isAncestor(EntityId ancestor, EntityId id) const {
    const Entity* e = get(id);
    int guard = 0;
    while (e && valid(e->parent) && guard++ < 1024) {
        if (e->parent == ancestor) return true;
        e = get(e->parent);
    }
    return false;
}

void Scene::renameEntity(EntityId id, const std::string& newName) {
    Entity* e = get(id);
    if (e && !newName.empty()) e->name = newName;
}

EntityId Scene::duplicateEntity(EntityId id, bool recursive) {
    Entity* src = get(id);
    if (!src) return kInvalidEntity;
    // strip the trailing " N" copy suffix so names stay readable
    std::string baseName = src->name;
    size_t space = baseName.find_last_of(' ');
    if (space != std::string::npos && space + 1 < baseName.size() &&
        std::all_of(baseName.begin() + (long)space + 1, baseName.end(), ::isdigit))
        baseName = baseName.substr(0, space);
    int counter = 1;
    std::string newName;
    do {
        newName = baseName + " " + std::to_string(counter++);
    } while (findByName(newName) != kInvalidEntity);

    EntityId newId = createEntity(newName, src->parent);
    Entity* dst = get(newId);
    EntityId savedParent = src->parent;
    std::string savedName = src->name;
    EntityId savedId = src->id;
    *dst = *src;                      // copy all components
    dst->id = newId;
    dst->name = newName;
    dst->parent = savedParent;
    dst->children.clear();
    dst->modelInstance.reset();
    dst->rigidBodyIndex = -1;
    dst->characterIndex = -1;
    dst->worldDirty = true;
    (void)savedName;
    (void)savedId;
    for (int i = 0; i < 3; ++i) (void)i;
    if (recursive) {
        std::vector<EntityId> kids = src->children;
        for (EntityId k : kids) {
            EntityId newChild = duplicateEntity(k, true);
            setParent(newChild, newId, false);
        }
    }
    return newId;
}

std::vector<EntityId> Scene::duplicateEntities(const std::vector<EntityId>& ids) {
    std::vector<EntityId> out;
    for (EntityId id : ids) out.push_back(duplicateEntity(id, true));
    return out;
}

// -------------------------------------------------------------- transforms
void Scene::markDirty(EntityId id) {
    Entity* e = get(id);
    if (!e) return;
    e->worldDirty = true;
    for (EntityId c : e->children) markDirty(c);
}

void Scene::markAllDirty() {
    for (auto& kv : entities_) kv.second.worldDirty = true;
}

void Scene::updateTransforms() {
    // parents come before children because ids increase with creation order,
    // but a child can be re-parented later, so resolve recursively instead.
    std::function<void(EntityId, const Mat4&)> resolve = [&](EntityId id, const Mat4& parentWorld) {
        Entity* e = get(id);
        if (!e) return;
        if (e->worldDirty) {
            e->cachedWorld = parentWorld * e->transform.matrix();
            e->worldDirty = false;
        }
        for (EntityId c : e->children) resolve(c, e->cachedWorld);
    };
    for (EntityId r : roots()) resolve(r, Mat4());
}

Mat4 Scene::worldMatrix(EntityId id) {
    Entity* e = get(id);
    if (!e) return Mat4();
    if (!e->worldDirty) return e->cachedWorld;
    Mat4 parentWorld = valid(e->parent) ? worldMatrix(e->parent) : Mat4();
    e->cachedWorld = parentWorld * e->transform.matrix();
    e->worldDirty = false;
    return e->cachedWorld;
}

Vec3 Scene::worldPosition(EntityId id) { return worldMatrix(id).translation(); }

Quat Scene::worldRotation(EntityId id) {
    Mat4 m = worldMatrix(id);
    Vec3 t, s;
    Quat r;
    m.decompose(t, r, s);
    return r;
}

void Scene::setWorldPosition(EntityId id, const Vec3& worldPos) {
    Entity* e = get(id);
    if (!e) return;
    Mat4 parentWorld = valid(e->parent) ? worldMatrix(e->parent) : Mat4();
    Mat4 local = parentWorld.inverse() * Mat4::translate(worldPos);
    e->transform.position = local.translation();
    markDirty(id);
}

void Scene::setWorldRotation(EntityId id, const Quat& worldRot) {
    Entity* e = get(id);
    if (!e) return;
    Mat4 parentWorld = valid(e->parent) ? worldMatrix(e->parent) : Mat4();
    Vec3 pt, ps;
    Quat pr;
    parentWorld.decompose(pt, pr, ps);
    e->transform.rotation = (pr.conjugate() * worldRot).normalized();
    markDirty(id);
}

Vec3 Scene::forward(EntityId id) {
    Mat4 m = worldMatrix(id);
    return Vec3(-m.at(2, 0), -m.at(2, 1), -m.at(2, 2)).normalized();
}

Vec3 Scene::up(EntityId id) { return worldMatrix(id).transformDir(Vec3(0, 1, 0)).normalized(); }

// -------------------------------------------------------------- components
bool Scene::removeComponent(EntityId id, ComponentType type) {
    Entity* e = get(id);
    if (!e) return false;
    switch (type) {
        case ComponentType::MeshRenderer: e->mesh.reset(); break;
        case ComponentType::Camera: e->camera.reset(); break;
        case ComponentType::Light: e->light.reset(); break;
        case ComponentType::Collider: e->collider.reset(); break;
        case ComponentType::RigidBody: e->rigidbody.reset(); break;
        case ComponentType::Character: e->character.reset(); break;
        case ComponentType::NPC: e->npc.reset(); break;
        case ComponentType::Health: e->health.reset(); break;
        case ComponentType::Trigger: e->trigger.reset(); break;
        case ComponentType::Interactable: e->interactable.reset(); break;
        case ComponentType::Door: e->door.reset(); break;
        case ComponentType::AudioSource: e->audio.reset(); break;
        case ComponentType::Animator: e->animator.reset(); break;
        case ComponentType::Script: e->script.reset(); break;
        case ComponentType::Particle: e->particles.reset(); break;
        default: return false;
    }
    return true;
}

bool Scene::hasComponent(EntityId id, ComponentType type) const {
    const Entity* e = get(id);
    return e && e->has(type);
}

std::vector<ComponentType> Scene::componentsOf(EntityId id) const {
    std::vector<ComponentType> out;
    const Entity* e = get(id);
    if (!e) return out;
    for (int i = 0; i < (int)ComponentType::Count; ++i) {
        ComponentType t = (ComponentType)i;
        if (e->has(t)) out.push_back(t);
    }
    return out;
}

// -------------------------------------------------------------- runtime
void Scene::resetRuntimeState() {
    for (auto& kv : entities_) {
        Entity& e = kv.second;
        e.modelInstance.reset();
        e.rigidBodyIndex = -1;
        e.characterIndex = -1;
        if (e.npc) {
            e.npc->state = NPCComponent::State::Idle;
            e.npc->stateTime = 0;
            e.npc->attackTimer = 0;
            e.npc->patrolIndex = 0;
            e.npc->hasTarget = false;
        }
        if (e.health) e.health->reset();
        if (e.door) {
            e.door->open = e.door->startsOpen;
            e.door->t = e.door->startsOpen ? 1.0f : 0.0f;
        }
        if (e.trigger) {
            e.trigger->firedEnter = false;
            e.trigger->firedExit = false;
        }
        if (e.interactable) e.interactable->used = false;
        if (e.script) e.script->luaRef = -1;
        if (e.rigidbody) {
            // restore the authored transform
            e.worldDirty = true;
        }
    }
    markAllDirty();
    updateTransforms();
}

EntityId Scene::activeCamera() const {
    EntityId fallback = kInvalidEntity;
    for (auto& kv : entities_) {
        if (!kv.second.camera) continue;
        if (kv.second.camera->isActive) return kv.first;
        if (fallback == kInvalidEntity) fallback = kv.first;
    }
    return fallback;
}

AABB Scene::worldBounds() {
    AABB total;
    updateTransforms();
    for (auto& kv : entities_) {
        Entity& e = kv.second;
        if (!e.mesh) continue;
        auto model = AssetLibrary::get().loadModel(e.mesh->modelPath);
        AABB local;
        if (model && model->bounds.valid()) local = model->bounds;
        else local.expand(Vec3(0, 0, 0));
        total.expand(transformAABB(local, e.cachedWorld));
    }
    if (!total.valid()) total.expand(Vec3(0, 0, 0));
    return total;
}

}  // namespace nf
