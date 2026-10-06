#include "scene/scene_serialize.h"
#include "scene/scene.h"

#include "core/fs.h"
#include "core/log.h"

namespace nf {

Json vec3ToJson(const Vec3& v) {
    Json j = Json::array();
    j.push(v.x);
    j.push(v.y);
    j.push(v.z);
    return j;
}
Json quatToJson(const Quat& q) {
    Json j = Json::array();
    j.push(q.x);
    j.push(q.y);
    j.push(q.z);
    j.push(q.w);
    return j;
}
Vec3 vec3FromJson(const Json& j, const Vec3& def) {
    if (!j.isArray() || j.size() < 3) return def;
    return Vec3(j[0].asFloat(def.x), j[1].asFloat(def.y), j[2].asFloat(def.z));
}
Quat quatFromJson(const Json& j) {
    if (!j.isArray() || j.size() < 4) return Quat::identity();
    return Quat(j[0].asFloat(), j[1].asFloat(), j[2].asFloat(), j[3].asFloat(1.0f)).normalized();
}

Json transformToJson(const Transform& t) {
    Json j = Json::object();
    j.set("position", vec3ToJson(t.position));
    j.set("rotation", quatToJson(t.rotation));
    if (t.scale.x != 1.0f || t.scale.y != 1.0f || t.scale.z != 1.0f)
        j.set("scale", vec3ToJson(t.scale));
    return j;
}

Transform transformFromJson(const Json& j) {
    Transform t;
    t.position = vec3FromJson(j["position"]);
    t.rotation = quatFromJson(j["rotation"]);
    t.scale = vec3FromJson(j["scale"], Vec3(1, 1, 1));
    return t;
}

const char* componentJsonKey(ComponentType type) {
    switch (type) {
        case ComponentType::MeshRenderer: return "meshRenderer";
        case ComponentType::Camera: return "camera";
        case ComponentType::Light: return "light";
        case ComponentType::Collider: return "collider";
        case ComponentType::RigidBody: return "rigidBody";
        case ComponentType::Character: return "character";
        case ComponentType::NPC: return "npc";
        case ComponentType::Health: return "health";
        case ComponentType::Trigger: return "trigger";
        case ComponentType::Interactable: return "interactable";
        case ComponentType::Door: return "door";
        case ComponentType::AudioSource: return "audioSource";
        case ComponentType::Animator: return "animator";
        case ComponentType::Script: return "script";
        case ComponentType::Particle: return "particles";
        default: return "unknown";
    }
}

static const char* lightTypeName(LightType t) {
    switch (t) {
        case LightType::Directional: return "directional";
        case LightType::Point: return "point";
        case LightType::Spot: return "spot";
    }
    return "directional";
}
static LightType lightTypeFrom(const std::string& s) {
    if (s == "point") return LightType::Point;
    if (s == "spot") return LightType::Spot;
    return LightType::Directional;
}
static const char* shapeName(ColliderShape s) {
    switch (s) {
        case ColliderShape::Box: return "box";
        case ColliderShape::Sphere: return "sphere";
        case ColliderShape::Capsule: return "capsule";
        case ColliderShape::Cylinder: return "cylinder";
        case ColliderShape::Mesh: return "mesh";
    }
    return "box";
}
static ColliderShape shapeFrom(const std::string& s) {
    if (s == "sphere") return ColliderShape::Sphere;
    if (s == "capsule") return ColliderShape::Capsule;
    if (s == "cylinder") return ColliderShape::Cylinder;
    if (s == "mesh") return ColliderShape::Mesh;
    return ColliderShape::Box;
}
static const char* motionName(MotionType m) {
    switch (m) {
        case MotionType::Static: return "static";
        case MotionType::Dynamic: return "dynamic";
        case MotionType::Kinematic: return "kinematic";
    }
    return "dynamic";
}
static MotionType motionFrom(const std::string& s) {
    if (s == "static") return MotionType::Static;
    if (s == "kinematic") return MotionType::Kinematic;
    return MotionType::Dynamic;
}

Json componentToJson(const Entity& e, ComponentType type) {
    Json j = Json::object();
    switch (type) {
        case ComponentType::MeshRenderer: {
            if (!e.mesh) break;
            const auto& m = *e.mesh;
            j.set("model", m.modelPath);
            if (!m.materialOverride.empty()) j.set("material", m.materialOverride);
            if (!m.subMaterialOverrides.empty()) {
                Json& a = j.arrayAt("subMaterials");
                for (auto& s : m.subMaterialOverrides) a.push(s);
            }
            if (m.colorTint.x != 1 || m.colorTint.y != 1 || m.colorTint.z != 1)
                j.set("colorTint", vec3ToJson(m.colorTint));
            j.set("visible", m.visible);
            j.set("castShadow", m.castShadow);
            j.set("receiveShadow", m.receiveShadow);
            break;
        }
        case ComponentType::Camera: {
            if (!e.camera) break;
            const auto& c = *e.camera;
            j.set("fov", c.fovDegrees);
            j.set("near", c.nearPlane);
            j.set("far", c.farPlane);
            j.set("orthographic", c.orthographic);
            j.set("active", c.isActive);
            j.set("backgroundColor", vec3ToJson(c.backgroundColor));
            break;
        }
        case ComponentType::Light: {
            if (!e.light) break;
            const auto& l = *e.light;
            j.set("type", std::string(lightTypeName(l.type)));
            j.set("color", vec3ToJson(l.color));
            j.set("intensity", l.intensity);
            j.set("range", l.range);
            j.set("spotAngle", l.spotAngleDegrees);
            j.set("spotSoftness", l.spotSoftness);
            j.set("castShadow", l.castShadow);
            j.set("enabled", l.enabled);
            break;
        }
        case ComponentType::Collider: {
            if (!e.collider) break;
            const auto& c = *e.collider;
            j.set("shape", std::string(shapeName(c.shape)));
            j.set("center", vec3ToJson(c.center));
            j.set("size", vec3ToJson(c.size));
            j.set("radius", c.radius);
            j.set("height", c.height);
            j.set("isTrigger", c.isTrigger);
            j.set("friction", c.friction);
            j.set("restitution", c.restitution);
            j.set("layer", c.layer);
            break;
        }
        case ComponentType::RigidBody: {
            if (!e.rigidbody) break;
            const auto& r = *e.rigidbody;
            j.set("motionType", std::string(motionName(r.motionType)));
            j.set("mass", r.mass);
            j.set("linearDamping", r.linearDamping);
            j.set("angularDamping", r.angularDamping);
            j.set("useGravity", r.useGravity);
            j.set("freezeRotation", r.freezeRotation);
            break;
        }
        case ComponentType::Character: {
            if (!e.character) break;
            const auto& c = *e.character;
            j.set("isPlayer", c.isPlayer);
            j.set("viewMode", c.viewMode == CharacterComponent::ViewMode::FirstPerson
                                  ? "firstPerson" : "thirdPerson");
            j.set("walkSpeed", c.walkSpeed);
            j.set("runSpeed", c.runSpeed);
            j.set("jumpHeight", c.jumpHeight);
            j.set("mouseSensitivity", c.mouseSensitivity);
            j.set("cameraDistance", c.cameraDistance);
            j.set("cameraHeight", c.cameraHeight);
            j.set("spawnYaw", c.spawnYawDegrees);
            break;
        }
        case ComponentType::NPC: {
            if (!e.npc) break;
            const auto& n = *e.npc;
            j.set("behavior", n.behavior == NPCComponent::Behavior::Patrol ? "patrol"
                            : n.behavior == NPCComponent::Behavior::FollowPlayer ? "follow"
                            : n.behavior == NPCComponent::Behavior::Idle ? "idle"
                                                                        : "chase");
            j.set("targetTag", n.targetTag);
            j.set("detectionRange", n.detectionRange);
            j.set("loseTargetRange", n.loseTargetRange);
            j.set("attackRange", n.attackRange);
            j.set("moveSpeed", n.moveSpeed);
            j.set("turnSpeed", n.turnSpeed);
            j.set("attackDamage", n.attackDamage);
            j.set("attackCooldown", n.attackCooldown);
            j.set("idleTime", n.idleTime);
            j.set("faceTarget", n.faceTarget);
            j.set("loopPatrol", n.loopPatrol);
            Json& pts = j.arrayAt("patrolPoints");
            for (auto& p : n.patrolPoints) pts.push(vec3ToJson(p));
            break;
        }
        case ComponentType::Health: {
            if (!e.health) break;
            j.set("maxHealth", e.health->maxHealth);
            j.set("currentHealth", e.health->currentHealth);
            j.set("destroyOnDeath", e.health->destroyOnDeath);
            j.set("invulnerable", e.health->invulnerable);
            break;
        }
        case ComponentType::Trigger: {
            if (!e.trigger) break;
            const auto& t = *e.trigger;
            auto actionName = [](TriggerComponent::Action a) -> const char* {
                switch (a) {
                    case TriggerComponent::Action::OpenDoor: return "openDoor";
                    case TriggerComponent::Action::CloseDoor: return "closeDoor";
                    case TriggerComponent::Action::Damage: return "damage";
                    case TriggerComponent::Action::Heal: return "heal";
                    case TriggerComponent::Action::Pickup: return "pickup";
                    case TriggerComponent::Action::PlaySound: return "playSound";
                    case TriggerComponent::Action::SetActive: return "setActive";
                    case TriggerComponent::Action::WinGame: return "winGame";
                    default: return "none";
                }
            };
            j.set("onEnter", std::string(actionName(t.onEnter)));
            j.set("onExit", std::string(actionName(t.onExit)));
            j.set("target", t.targetEntity);
            j.set("value", t.value);
            j.set("message", t.message);
            j.set("oneShot", t.oneShot);
            break;
        }
        case ComponentType::Interactable: {
            if (!e.interactable) break;
            const auto& i = *e.interactable;
            const char* names[] = {"none", "pickup", "toggleDoor", "message", "damage", "heal", "teleport"};
            j.set("action", std::string(names[(int)i.action]));
            j.set("prompt", i.prompt);
            j.set("message", i.message);
            j.set("value", i.value);
            j.set("target", i.targetEntity);
            j.set("teleportTo", vec3ToJson(i.teleportTo));
            j.set("oneShot", i.oneShot);
            j.set("interactRange", i.interactRange);
            break;
        }
        case ComponentType::Door: {
            if (!e.door) break;
            j.set("openOffset", vec3ToJson(e.door->openOffset));
            j.set("speed", e.door->speed);
            j.set("startsOpen", e.door->startsOpen);
            j.set("locked", e.door->locked);
            break;
        }
        case ComponentType::AudioSource: {
            if (!e.audio) break;
            const auto& a = *e.audio;
            j.set("clip", a.clip);
            j.set("volume", a.volume);
            j.set("pitch", a.pitch);
            j.set("loop", a.loop);
            j.set("playOnStart", a.playOnStart);
            j.set("minDistance", a.minDistance);
            j.set("maxDistance", a.maxDistance);
            j.set("spatial", a.spatial);
            break;
        }
        case ComponentType::Animator: {
            if (!e.animator) break;
            const auto& a = *e.animator;
            j.set("defaultClip", a.defaultClip);
            j.set("playOnStart", a.playOnStart);
            j.set("loop", a.loop);
            j.set("speed", a.speed);
            j.set("idleClip", a.idleClip);
            j.set("walkClip", a.walkClip);
            j.set("runClip", a.runClip);
            j.set("attackClip", a.attackClip);
            j.set("deathClip", a.deathClip);
            break;
        }
        case ComponentType::Script: {
            if (!e.script) break;
            j.set("file", e.script->scriptPath);
            j.set("enabled", e.script->enabled);
            break;
        }
        case ComponentType::Particle: {
            if (!e.particles) break;
            const auto& p = *e.particles;
            j.set("color", vec3ToJson(p.color));
            j.set("size", p.size);
            j.set("lifetime", p.lifetime);
            j.set("speed", p.speed);
            j.set("count", p.count);
            j.set("playOnStart", p.playOnStart);
            j.set("looping", p.looping);
            j.set("emitOnInteract", p.emitOnInteract);
            break;
        }
        default:
            break;
    }
    return j;
}

bool componentFromJson(Entity& e, ComponentType type, const Json& j) {
    if (!j.isObject()) return false;
    switch (type) {
        case ComponentType::MeshRenderer: {
            e.mesh = MeshRendererComponent();
            auto& m = *e.mesh;
            m.modelPath = j["model"].asString(m.modelPath);
            m.materialOverride = j["material"].asString("");
            for (const Json& s : j["subMaterials"].items()) m.subMaterialOverrides.push_back(s.asString());
            m.colorTint = vec3FromJson(j["colorTint"], Vec3(1, 1, 1));
            m.visible = j["visible"].asBool(true);
            m.castShadow = j["castShadow"].asBool(true);
            m.receiveShadow = j["receiveShadow"].asBool(true);
            return true;
        }
        case ComponentType::Camera: {
            e.camera = CameraComponent();
            auto& c = *e.camera;
            c.fovDegrees = j["fov"].asFloat(c.fovDegrees);
            c.nearPlane = j["near"].asFloat(c.nearPlane);
            c.farPlane = j["far"].asFloat(c.farPlane);
            c.orthographic = j["orthographic"].asBool(false);
            c.isActive = j["active"].asBool(false);
            c.backgroundColor = vec3FromJson(j["backgroundColor"], c.backgroundColor);
            return true;
        }
        case ComponentType::Light: {
            e.light = LightComponent();
            auto& l = *e.light;
            l.type = lightTypeFrom(j["type"].asString("directional"));
            l.color = vec3FromJson(j["color"], Vec3(1, 1, 1));
            l.intensity = j["intensity"].asFloat(1.0f);
            l.range = j["range"].asFloat(15.0f);
            l.spotAngleDegrees = j["spotAngle"].asFloat(40.0f);
            l.spotSoftness = j["spotSoftness"].asFloat(0.25f);
            l.castShadow = j["castShadow"].asBool(true);
            l.enabled = j["enabled"].asBool(true);
            return true;
        }
        case ComponentType::Collider: {
            e.collider = ColliderComponent();
            auto& c = *e.collider;
            c.shape = shapeFrom(j["shape"].asString("box"));
            c.center = vec3FromJson(j["center"]);
            c.size = vec3FromJson(j["size"], Vec3(1, 1, 1));
            c.radius = j["radius"].asFloat(0.5f);
            c.height = j["height"].asFloat(1.8f);
            c.isTrigger = j["isTrigger"].asBool(false);
            c.friction = j["friction"].asFloat(0.6f);
            c.restitution = j["restitution"].asFloat(0.1f);
            c.layer = j["layer"].asString("Default");
            return true;
        }
        case ComponentType::RigidBody: {
            e.rigidbody = RigidBodyComponent();
            auto& r = *e.rigidbody;
            r.motionType = motionFrom(j["motionType"].asString("dynamic"));
            r.mass = j["mass"].asFloat(1.0f);
            r.linearDamping = j["linearDamping"].asFloat(0.05f);
            r.angularDamping = j["angularDamping"].asFloat(0.2f);
            r.useGravity = j["useGravity"].asBool(true);
            r.freezeRotation = j["freezeRotation"].asBool(false);
            return true;
        }
        case ComponentType::Character: {
            e.character = CharacterComponent();
            auto& c = *e.character;
            c.isPlayer = j["isPlayer"].asBool(true);
            c.viewMode = j["viewMode"].asString("thirdPerson") == "firstPerson"
                             ? CharacterComponent::ViewMode::FirstPerson
                             : CharacterComponent::ViewMode::ThirdPerson;
            c.walkSpeed = j["walkSpeed"].asFloat(4.0f);
            c.runSpeed = j["runSpeed"].asFloat(8.0f);
            c.jumpHeight = j["jumpHeight"].asFloat(1.5f);
            c.mouseSensitivity = j["mouseSensitivity"].asFloat(0.12f);
            c.cameraDistance = j["cameraDistance"].asFloat(5.0f);
            c.cameraHeight = j["cameraHeight"].asFloat(1.5f);
            c.spawnYawDegrees = j["spawnYaw"].asFloat(0.0f);
            return true;
        }
        case ComponentType::NPC: {
            e.npc = NPCComponent();
            auto& n = *e.npc;
            std::string b = j["behavior"].asString("chase");
            n.behavior = b == "patrol" ? NPCComponent::Behavior::Patrol
                       : b == "follow" ? NPCComponent::Behavior::FollowPlayer
                       : b == "idle" ? NPCComponent::Behavior::Idle
                                     : NPCComponent::Behavior::ChasePlayer;
            n.targetTag = j["targetTag"].asString("Player");
            n.detectionRange = j["detectionRange"].asFloat(14.0f);
            n.loseTargetRange = j["loseTargetRange"].asFloat(22.0f);
            n.attackRange = j["attackRange"].asFloat(2.2f);
            n.moveSpeed = j["moveSpeed"].asFloat(2.8f);
            n.turnSpeed = j["turnSpeed"].asFloat(8.0f);
            n.attackDamage = j["attackDamage"].asFloat(12.0f);
            n.attackCooldown = j["attackCooldown"].asFloat(1.2f);
            n.idleTime = j["idleTime"].asFloat(1.5f);
            n.faceTarget = j["faceTarget"].asBool(true);
            n.loopPatrol = j["loopPatrol"].asBool(true);
            for (const Json& p : j["patrolPoints"].items()) n.patrolPoints.push_back(vec3FromJson(p));
            return true;
        }
        case ComponentType::Health: {
            e.health = HealthComponent();
            e.health->maxHealth = j["maxHealth"].asFloat(100.0f);
            e.health->currentHealth = j["currentHealth"].asFloat(e.health->maxHealth);
            e.health->destroyOnDeath = j["destroyOnDeath"].asBool(false);
            e.health->invulnerable = j["invulnerable"].asBool(false);
            return true;
        }
        case ComponentType::Trigger: {
            e.trigger = TriggerComponent();
            auto& t = *e.trigger;
            auto actionFrom = [](const std::string& s) {
                if (s == "openDoor") return TriggerComponent::Action::OpenDoor;
                if (s == "closeDoor") return TriggerComponent::Action::CloseDoor;
                if (s == "damage") return TriggerComponent::Action::Damage;
                if (s == "heal") return TriggerComponent::Action::Heal;
                if (s == "pickup") return TriggerComponent::Action::Pickup;
                if (s == "playSound") return TriggerComponent::Action::PlaySound;
                if (s == "setActive") return TriggerComponent::Action::SetActive;
                if (s == "winGame") return TriggerComponent::Action::WinGame;
                return TriggerComponent::Action::None;
            };
            t.onEnter = actionFrom(j["onEnter"].asString("none"));
            t.onExit = actionFrom(j["onExit"].asString("none"));
            t.targetEntity = j["target"].asString("");
            t.value = j["value"].asFloat(10.0f);
            t.message = j["message"].asString("");
            t.oneShot = j["oneShot"].asBool(false);
            return true;
        }
        case ComponentType::Interactable: {
            e.interactable = InteractableComponent();
            auto& i = *e.interactable;
            std::string s = j["action"].asString("message");
            i.action = s == "pickup" ? InteractableComponent::Action::Pickup
                     : s == "toggleDoor" ? InteractableComponent::Action::ToggleDoor
                     : s == "damage" ? InteractableComponent::Action::Damage
                     : s == "heal" ? InteractableComponent::Action::Heal
                     : s == "teleport" ? InteractableComponent::Action::Teleport
                                       : InteractableComponent::Action::Message;
            i.prompt = j["prompt"].asString("Press E to interact");
            i.message = j["message"].asString("Hello!");
            i.value = j["value"].asFloat(20.0f);
            i.targetEntity = j["target"].asString("");
            i.teleportTo = vec3FromJson(j["teleportTo"], Vec3(0, 1, 0));
            i.oneShot = j["oneShot"].asBool(false);
            i.interactRange = j["interactRange"].asFloat(2.5f);
            return true;
        }
        case ComponentType::Door: {
            e.door = DoorComponent();
            e.door->openOffset = vec3FromJson(j["openOffset"], Vec3(0, 2.2f, 0));
            e.door->speed = j["speed"].asFloat(2.0f);
            e.door->startsOpen = j["startsOpen"].asBool(false);
            e.door->locked = j["locked"].asBool(false);
            return true;
        }
        case ComponentType::AudioSource: {
            e.audio = AudioSourceComponent();
            auto& a = *e.audio;
            a.clip = j["clip"].asString("");
            a.volume = j["volume"].asFloat(1.0f);
            a.pitch = j["pitch"].asFloat(1.0f);
            a.loop = j["loop"].asBool(false);
            a.playOnStart = j["playOnStart"].asBool(false);
            a.minDistance = j["minDistance"].asFloat(1.0f);
            a.maxDistance = j["maxDistance"].asFloat(30.0f);
            a.spatial = j["spatial"].asBool(true);
            return true;
        }
        case ComponentType::Animator: {
            e.animator = AnimatorComponent();
            auto& a = *e.animator;
            a.defaultClip = j["defaultClip"].asString("");
            a.playOnStart = j["playOnStart"].asBool(true);
            a.loop = j["loop"].asBool(true);
            a.speed = j["speed"].asFloat(1.0f);
            a.idleClip = j["idleClip"].asString(a.idleClip);
            a.walkClip = j["walkClip"].asString(a.walkClip);
            a.runClip = j["runClip"].asString(a.runClip);
            a.attackClip = j["attackClip"].asString(a.attackClip);
            a.deathClip = j["deathClip"].asString(a.deathClip);
            return true;
        }
        case ComponentType::Script: {
            e.script = ScriptComponent();
            e.script->scriptPath = j["file"].asString("");
            e.script->enabled = j["enabled"].asBool(true);
            return true;
        }
        case ComponentType::Particle: {
            e.particles = ParticleComponent();
            auto& p = *e.particles;
            p.color = vec3FromJson(j["color"], Vec3(1, 0.6f, 0.2f));
            p.size = j["size"].asFloat(0.15f);
            p.lifetime = j["lifetime"].asFloat(0.8f);
            p.speed = j["speed"].asFloat(2.5f);
            p.count = j["count"].asInt(24);
            p.playOnStart = j["playOnStart"].asBool(false);
            p.looping = j["looping"].asBool(false);
            p.emitOnInteract = j["emitOnInteract"].asBool(true);
            return true;
        }
        default:
            return false;
    }
}

// ------------------------------------------------------------ scene <-> json
Json Scene::toJson() const {
    Json root = Json::object();
    root.set("format", "NovaForgeScene");
    root.set("version", 1);
    root.set("name", name);
    Json& arr = root.arrayAt("entities");
    for (const auto& kv : entities_) {
        const Entity& e = kv.second;
        Json je = Json::object();
        je.set("id", (int)e.id);
        je.set("name", e.name);
        if (!e.tag.empty()) je.set("tag", e.tag);
        je.set("parent", (int)(valid(e.parent) ? e.parent : 0));
        if (!e.active) je.set("active", false);
        je.set("transform", transformToJson(e.transform));
        for (int i = 0; i < (int)ComponentType::Count; ++i) {
            ComponentType t = (ComponentType)i;
            if (!e.has(t)) continue;
            Json jc = componentToJson(e, t);
            if (!jc.isObject() || jc.size() == 0) continue;
            je.set(componentJsonKey(t), jc);
        }
        arr.push(je);
    }
    return root;
}

bool Scene::fromJson(const Json& root, std::string* error) {
    entities_.clear();
    nextId_ = 1;
    if (!root.isObject()) {
        if (error) *error = "scene root is not a JSON object";
        return false;
    }
    std::string fmt = root["format"].asString("");
    if (!fmt.empty() && fmt != "NovaForgeScene") {
        if (error) *error = "unexpected scene format '" + fmt + "' (expected NovaForgeScene)";
        return false;
    }
    name = root["name"].asString("Untitled Scene");
    path.clear();
    std::vector<std::pair<EntityId, EntityId>> pendingParents;
    for (const Json& je : root["entities"].items()) {
        Entity e;
        e.id = (EntityId)je["id"].asInt((int)nextId_);
        e.name = je["name"].asString("Entity");
        e.tag = je["tag"].asString("");
        e.parent = (EntityId)je["parent"].asInt(0);
        e.active = je["active"].asBool(true);
        e.transform = transformFromJson(je["transform"]);
        e.worldDirty = true;
        for (int i = 0; i < (int)ComponentType::Count; ++i) {
            ComponentType t = (ComponentType)i;
            const char* key = componentJsonKey(t);
            if (!je.has(key)) continue;
            componentFromJson(e, t, je[key]);
        }
        nextId_ = std::max(nextId_, e.id + 1);
        EntityId id = e.id;
        EntityId parent = e.parent;
        entities_[id] = std::move(e);
        if (parent != 0) pendingParents.emplace_back(id, parent);
    }
    for (auto& pp : pendingParents) {
        Entity* child = get(pp.first);
        Entity* parent = get(pp.second);
        if (!child) continue;
        if (!parent) {
            child->parent = kInvalidEntity;
            continue;
        }
        parent->children.push_back(pp.first);
    }
    updateTransforms();
    return true;
}

bool Scene::save(const std::string& p) const {
    if (p.empty()) {
        NF_LOG_ERROR("Scene", "cannot save scene: no path given");
        return false;
    }
    return toJson().saveFile(p, 2);
}

bool Scene::load(const std::string& p, std::string* error) {
    Json root;
    std::string err;
    if (!Json::parseFile(p, root, &error ? error : &err)) {
        if (error && error->empty()) *error = err;
        return false;
    }
    if (!fromJson(root, error)) return false;
    path = p;
    return true;
}

}  // namespace nf
