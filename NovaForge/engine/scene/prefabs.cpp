#include "scene/prefabs.h"

#include "assets/asset_library.h"
#include "core/fs.h"
#include "core/log.h"
#include "scene/scene_serialize.h"

namespace nf {

Json Prefab::toJson() const {
    Json j = Json::object();
    j.set("format", "NovaForgePrefab");
    j.set("version", 1);
    j.set("name", name);
    if (!description.empty()) j.set("description", description);
    j.set("entity", root.has("entity") ? root["entity"] : Json::object());
    return j;
}

Prefab Prefab::fromJson(const Json& j) {
    Prefab p;
    p.name = j["name"].asString("Prefab");
    p.description = j["description"].asString("");
    p.root = Json::object();
    p.root["entity"] = j.has("entity") ? j["entity"] : Json::object();
    return p;
}

bool Prefab::save(const std::string& path) const {
    return toJson().saveFile(path, 2);
}

bool Prefab::load(const std::string& path, std::string* error) {
    Json j;
    if (!Json::parseFile(path, j, error)) return false;
    *this = fromJson(j);
    return valid();
}

// ------------------------------------------------------------ extraction
static Json entitySubtreeToJson(const Scene& scene, EntityId id) {
    Json j = Json::object();
    const Entity* e = scene.get(id);
    if (!e) return j;
    j.set("name", e->name);
    if (!e->tag.empty()) j.set("tag", e->tag);
    if (!e->active) j.set("active", false);
    j.set("transform", transformToJson(e->transform));
    Json comps = Json::object();
    for (int i = 0; i < (int)ComponentType::Count; ++i) {
        ComponentType t = (ComponentType)i;
        if (!e->has(t)) continue;
        Json jc = componentToJson(*e, t);
        if (jc.isObject() && jc.size() > 0) comps.set(componentJsonKey(t), jc);
    }
    j.set("components", comps);
    if (!e->children.empty()) {
        Json& kids = j.arrayAt("children");
        for (EntityId c : e->children) kids.push(entitySubtreeToJson(scene, c));
    }
    return j;
}

Prefab makePrefabFromEntity(const Scene& scene, EntityId id, const std::string& prefabName) {
    Prefab p;
    p.name = prefabName;
    p.root = Json::object();
    p.root["entity"] = entitySubtreeToJson(scene, id);
    return p;
}

// ------------------------------------------------------------ instantiation
static EntityId instantiateSubtree(Scene& scene, const Json& j, EntityId parent,
                                   const Vec3* overridePos, const Quat* overrideRot) {
    if (!j.isObject()) return kInvalidEntity;
    EntityId id = scene.createEntity(j["name"].asString("Entity"), parent);
    Entity* e = scene.get(id);
    if (!e) return kInvalidEntity;
    e->tag = j["tag"].asString("");
    e->active = j["active"].asBool(true);
    e->transform = transformFromJson(j["transform"]);
    if (overridePos) e->transform.position = *overridePos;
    if (overrideRot) e->transform.rotation = *overrideRot;
    const Json& comps = j["components"];
    for (int i = 0; i < (int)ComponentType::Count; ++i) {
        ComponentType t = (ComponentType)i;
        const char* key = componentJsonKey(t);
        if (!comps.has(key)) continue;
        componentFromJson(*e, t, comps[key]);
    }
    e->worldDirty = true;
    for (const Json& child : j["children"].items())
        instantiateSubtree(scene, child, id, nullptr, nullptr);
    return id;
}

EntityId Prefab::instantiate(Scene& scene, EntityId parent, const Vec3& position,
                            const Quat& rotation) const {
    if (!valid()) {
        NF_LOG_ERROR("Prefab", "prefab '%s' has no entity data", name.c_str());
        return kInvalidEntity;
    }
    return instantiateSubtree(scene, root["entity"], parent, &position, &rotation);
}

// ------------------------------------------------------------ built-ins
namespace builtin_prefabs {

namespace {
Json entity(const std::string& name, const std::string& tag, const Vec3& pos,
            const Vec3& rotDeg = Vec3(0, 0, 0), const Vec3& scale = Vec3(1, 1, 1),
            const Json& components = Json::object()) {
    Json j = Json::object();
    j.set("name", name);
    if (!tag.empty()) j.set("tag", tag);
    Transform t;
    t.position = pos;
    t.rotation = Quat::fromEulerDeg(rotDeg);
    t.scale = scale;
    j.set("transform", transformToJson(t));
    j.set("components", components);
    return j;
}

Json meshComponent(const std::string& model, const std::string& material = "") {
    Json c = Json::object();
    c.set("model", model);
    if (!material.empty()) c.set("material", material);
    return c;
}

Json boxCollider(const Vec3& size, bool trigger = false) {
    Json c = Json::object();
    c.set("shape", "box");
    c.set("size", vec3ToJson(size));
    c.set("isTrigger", trigger);
    return c;
}

Json capsuleCollider(float radius, float height) {
    Json c = Json::object();
    c.set("shape", "capsule");
    c.set("radius", radius);
    c.set("height", height);
    return c;
}

Json sphereCollider(float radius, bool trigger = false) {
    Json c = Json::object();
    c.set("shape", "sphere");
    c.set("radius", radius);
    c.set("isTrigger", trigger);
    return c;
}

Json rigidBody(const std::string& motion, float mass = 1.0f, bool gravity = true,
               bool freezeRotation = false) {
    Json c = Json::object();
    c.set("motionType", motion);
    c.set("mass", mass);
    c.set("useGravity", gravity);
    c.set("freezeRotation", freezeRotation);
    return c;
}

Json lightComponent(const std::string& type, float intensity, Vec3 color = Vec3(1, 1, 1),
                    float range = 15.0f, bool shadows = true) {
    Json c = Json::object();
    c.set("type", type);
    c.set("intensity", intensity);
    c.set("color", vec3ToJson(color));
    c.set("range", range);
    c.set("castShadow", shadows);
    return c;
}

const std::vector<BuiltinPrefab>& listRef() {
    static const std::vector<BuiltinPrefab> items = {
        {"Player", "Player Character", "Third person character: WASD + mouse, jump, sprint",
         "Gameplay"},
        {"Enemy", "Enemy NPC", "Chases the player, attacks in melee range, has health", "Gameplay"},
        {"PatrollingEnemy", "Patrolling Enemy", "Patrols between waypoints, chases on sight",
         "Gameplay"},
        {"HealthPickup", "Health Pickup", "Collect to restore health", "Gameplay"},
        {"Coin", "Coin", "Collectable score item", "Gameplay"},
        {"QuestGiver", "Quest NPC", "Talk to start a simple quest", "Gameplay"},
        {"Door", "Door", "Opens when interacted with or when a trigger fires", "Gameplay"},
        {"Platform", "Platform", "Static box platform", "Objects"},
        {"Crate", "Physics Crate", "Dynamic box with rigid body physics", "Objects"},
        {"Ball", "Physics Ball", "Dynamic sphere", "Objects"},
        {"GoalZone", "Goal Zone", "Winning trigger volume", "Gameplay"},
        {"TriggerZone", "Trigger Volume", "Fires an action when the player enters", "Gameplay"},
        {"DirectionalLight", "Directional Light", "Sun light with shadows", "Lighting"},
        {"PointLight", "Point Light", "Omni light", "Lighting"},
        {"SpotLight", "Spot Light", "Cone light", "Lighting"},
        {"Torch", "Torch", "Point light + flame particles", "Lighting"},
        {"Camera", "Camera", "Gameplay camera (mark as active)", "Camera"},
    };
    return items;
}
}  // namespace

const std::vector<BuiltinPrefab>& list() { return listRef(); }

Prefab create(const std::string& id) {
    Prefab p;
    p.name = id;
    p.root = Json::object();
    std::string model = "primitive://Cube";
    (void)model;

    if (id == "Player") {
        Json comps = Json::object();
        comps.set("meshRenderer", meshComponent("primitive://Capsule"));
        comps.set("collider", capsuleCollider(0.35f, 1.6f));
        Json ch = Json::object();
        ch.set("isPlayer", true);
        ch.set("viewMode", "thirdPerson");
        ch.set("walkSpeed", 4.5);
        ch.set("runSpeed", 8.5);
        ch.set("jumpHeight", 1.5);
        ch.set("cameraDistance", 5.5);
        comps.set("character", ch);
        Json h = Json::object();
        h.set("maxHealth", 100);
        h.set("currentHealth", 100);
        comps.set("health", h);
        comps.set("animator", Json::object());
        p.root["entity"] = entity("Player", "Player", Vec3(0, 1.2f, 0), Vec3(0, 0, 0),
                                  Vec3(0.7f, 1.0f, 0.7f), comps);
    } else if (id == "Enemy" || id == "PatrollingEnemy") {
        Json comps = Json::object();
        comps.set("meshRenderer", meshComponent("primitive://Capsule"));
        comps.set("collider", capsuleCollider(0.4f, 1.5f));
        Json npc = Json::object();
        npc.set("behavior", id == "Enemy" ? "chase" : "patrol");
        npc.set("targetTag", "Player");
        npc.set("detectionRange", 16.0);
        npc.set("attackRange", 2.0);
        npc.set("moveSpeed", 3.0);
        npc.set("attackDamage", 10.0);
        npc.set("attackCooldown", 1.4);
        if (id == "PatrollingEnemy") {
            Json& pts = npc.arrayAt("patrolPoints");
            pts.push(vec3ToJson(Vec3(6, 1, 6)));
            pts.push(vec3ToJson(Vec3(-6, 1, 6)));
            pts.push(vec3ToJson(Vec3(-6, 1, -6)));
        }
        comps.set("npc", npc);
        Json h = Json::object();
        h.set("maxHealth", 60);
        h.set("currentHealth", 60);
        h.set("destroyOnDeath", true);
        comps.set("health", h);
        comps.set("animator", Json::object());
        p.root["entity"] = entity("Enemy", "Enemy", Vec3(8, 1.2f, 8), Vec3(0, 180, 0),
                                  Vec3(0.8f, 1.0f, 0.8f), comps);
    } else if (id == "HealthPickup") {
        Json comps = Json::object();
        comps.set("meshRenderer", meshComponent("primitive://Sphere"));
        Json col = sphereCollider(0.6f, true);
        comps.set("collider", col);
        Json inter = Json::object();
        inter.set("action", "heal");
        inter.set("value", 30.0);
        inter.set("prompt", "[E] Pick up health");
        inter.set("message", "Health restored");
        inter.set("oneShot", true);
        comps.set("interactable", inter);
        Json part = Json::object();
        part.set("color", vec3ToJson(Vec3(0.2f, 0.95f, 0.4f)));
        part.set("count", 20);
        part.set("looping", true);
        comps.set("particles", part);
        Json scr = Json::object();
        scr.set("file", "Assets/Scripts/spin.lua");
        comps.set("script", scr);
        p.root["entity"] = entity("HealthPickup", "Pickup", Vec3(3, 1.0f, 3), Vec3(0, 0, 0),
                                  Vec3(0.7f, 0.7f, 0.7f), comps);
    } else if (id == "Coin") {
        Json comps = Json::object();
        comps.set("meshRenderer", meshComponent("primitive://Torus"));
        comps.set("collider", sphereCollider(0.5f, true));
        Json inter = Json::object();
        inter.set("action", "pickup");
        inter.set("value", 1.0);
        inter.set("prompt", "[E] Collect coin");
        inter.set("message", "Coin collected (+1)");
        inter.set("oneShot", true);
        comps.set("interactable", inter);
        Json scr = Json::object();
        scr.set("file", "Assets/Scripts/spin.lua");
        comps.set("script", scr);
        p.root["entity"] = entity("Coin", "Pickup", Vec3(0, 1.0f, 0), Vec3(90, 0, 0),
                                  Vec3(0.5f, 0.5f, 0.5f), comps);
    } else if (id == "QuestGiver") {
        Json comps = Json::object();
        comps.set("meshRenderer", meshComponent("primitive://Capsule"));
        comps.set("collider", capsuleCollider(0.4f, 1.6f));
        Json npc = Json::object();
        npc.set("behavior", "idle");
        comps.set("npc", npc);
        Json inter = Json::object();
        inter.set("action", "message");
        inter.set("prompt", "[E] Talk");
        inter.set("message", "Village elder: bring me 3 coins and I will open the gate!");
        comps.set("interactable", inter);
        Json scr = Json::object();
        scr.set("file", "Assets/Scripts/quest_giver.lua");
        comps.set("script", scr);
        Json h = Json::object();
        h.set("maxHealth", 1000);
        comps.set("health", h);
        p.root["entity"] = entity("QuestGiver", "NPC", Vec3(-4, 1.2f, 5), Vec3(0, 140, 0),
                                  Vec3(0.9f, 1.05f, 0.9f), comps);
    } else if (id == "Door") {
        Json comps = Json::object();
        comps.set("meshRenderer", meshComponent("primitive://Cube"));
        comps.set("collider", boxCollider(Vec3(1.2f, 2.2f, 0.2f)));
        comps.set("rigidBody", rigidBody("static"));
        Json a = Json::object();
        a.set("action", "toggleDoor");
        a.set("prompt", "[E] Open door");
        comps.set("interactable", a);
        Json d = Json::object();
        d.set("openOffset", vec3ToJson(Vec3(0, 2.4f, 0)));
        d.set("speed", 2.0);
        comps.set("door", d);
        p.root["entity"] = entity("Door", "Door", Vec3(0, 1.1f, 0), Vec3(0, 0, 0),
                                  Vec3(1.2f, 2.2f, 0.2f), comps);
    } else if (id == "Platform") {
        Json comps = Json::object();
        comps.set("meshRenderer", meshComponent("primitive://Cube"));
        comps.set("collider", boxCollider(Vec3(1, 1, 1)));
        comps.set("rigidBody", rigidBody("static"));
        p.root["entity"] = entity("Platform", "Ground", Vec3(0, 0, 0), Vec3(0, 0, 0),
                                  Vec3(8, 0.5f, 8), comps);
    } else if (id == "Crate") {
        Json comps = Json::object();
        comps.set("meshRenderer", meshComponent("primitive://Cube"));
        comps.set("collider", boxCollider(Vec3(1, 1, 1)));
        comps.set("rigidBody", rigidBody("dynamic", 5.0f));
        p.root["entity"] = entity("Crate", "Physics", Vec3(0, 2, 0), Vec3(0, 0, 0),
                                  Vec3(1, 1, 1), comps);
    } else if (id == "Ball") {
        Json comps = Json::object();
        comps.set("meshRenderer", meshComponent("primitive://Sphere"));
        comps.set("collider", sphereCollider(0.5f));
        comps.set("rigidBody", rigidBody("dynamic", 2.0f));
        p.root["entity"] = entity("Ball", "Physics", Vec3(0, 3, 0), Vec3(0, 0, 0),
                                  Vec3(1, 1, 1), comps);
    } else if (id == "GoalZone") {
        Json comps = Json::object();
        comps.set("collider", boxCollider(Vec3(3, 3, 3), true));
        Json mr = meshComponent("primitive://Cube");
        mr.set("visible", false);           // invisible at runtime, drawn as a
        comps.set("meshRenderer", mr);      // translucent volume by the editor
        Json tr = Json::object();
        tr.set("onEnter", "winGame");
        tr.set("message", "You reached the goal!");
        tr.set("oneShot", true);
        comps.set("trigger", tr);
        p.root["entity"] = entity("GoalZone", "Goal", Vec3(0, 1.5f, 20), Vec3(0, 0, 0),
                                  Vec3(3, 3, 3), comps);
    } else if (id == "TriggerZone") {
        Json comps = Json::object();
        comps.set("collider", boxCollider(Vec3(4, 3, 4), true));
        Json mr2 = meshComponent("primitive://Cube");
        mr2.set("visible", false);
        comps.set("meshRenderer", mr2);
        Json tr = Json::object();
        tr.set("onEnter", "openDoor");
        tr.set("target", "Door");
        tr.set("message", "The door opens");
        comps.set("trigger", tr);
        p.root["entity"] = entity("TriggerZone", "Trigger", Vec3(0, 1.5f, -6), Vec3(0, 0, 0),
                                  Vec3(4, 3, 4), comps);
    } else if (id == "DirectionalLight") {
        Json comps = Json::object();
        comps.set("light", lightComponent("directional", 1.15f, Vec3(1.0f, 0.96f, 0.88f), 0.0f, true));
        p.root["entity"] = entity("Sun", "Light", Vec3(0, 12, 0), Vec3(48, -35, 0),
                                  Vec3(1, 1, 1), comps);
    } else if (id == "PointLight") {
        Json comps = Json::object();
        comps.set("light", lightComponent("point", 1.2f, Vec3(1.0f, 0.85f, 0.7f), 14.0f, true));
        p.root["entity"] = entity("PointLight", "Light", Vec3(0, 3, 0), Vec3(0, 0, 0),
                                  Vec3(1, 1, 1), comps);
    } else if (id == "SpotLight") {
        Json comps = Json::object();
        Json lc = lightComponent("spot", 2.0f, Vec3(0.9f, 0.95f, 1.0f), 25.0f, true);
        lc.set("spotAngle", 35.0);
        comps.set("light", lc);
        p.root["entity"] = entity("SpotLight", "Light", Vec3(0, 4, 0), Vec3(60, 0, 0),
                                  Vec3(1, 1, 1), comps);
    } else if (id == "Torch") {
        Json comps = Json::object();
        comps.set("meshRenderer", meshComponent("primitive://Cylinder"));
        Json lc = lightComponent("point", 2.2f, Vec3(1.0f, 0.6f, 0.25f), 9.0f, false);
        comps.set("light", lc);
        Json part = Json::object();
        part.set("color", vec3ToJson(Vec3(1.0f, 0.55f, 0.15f)));
        part.set("count", 14);
        part.set("lifetime", 0.5f);
        part.set("speed", 1.6f);
        part.set("looping", true);
        part.set("playOnStart", true);
        comps.set("particles", part);
        p.root["entity"] = entity("Torch", "Light", Vec3(0, 1.0f, 0), Vec3(0, 0, 0),
                                  Vec3(0.15f, 1.4f, 0.15f), comps);
    } else if (id == "Camera") {
        Json comps = Json::object();
        Json cam = Json::object();
        cam.set("fov", 60.0);
        cam.set("active", true);
        comps.set("camera", cam);
        p.root["entity"] = entity("Camera", "Camera", Vec3(0, 3, -8), Vec3(-10, 0, 0),
                                  Vec3(1, 1, 1), comps);
    } else {
        NF_LOG_WARN("Prefab", "unknown built-in prefab '%s' - creating an empty entity", id.c_str());
        p.root["entity"] = entity(id.empty() ? "Entity" : id, "", Vec3(0, 0, 0));
    }
    return p;
}

EntityId spawn(Scene& scene, const std::string& id, const Vec3& position, EntityId parent) {
    Prefab p = create(id);
    Quat rot = p.root["entity"].has("transform")
                   ? transformFromJson(p.root["entity"]["transform"]).rotation
                   : Quat::identity();
    return p.instantiate(scene, parent, position, rot);
}

}  // namespace builtin_prefabs
}  // namespace nf
