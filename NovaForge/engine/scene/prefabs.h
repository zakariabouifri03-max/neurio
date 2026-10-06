// NovaForge Engine - prefabs (.nfprefab.json)
//
// A prefab is a saved entity subtree. Instantiating it creates real entities
// with new ids, so prefabs can be placed many times in a scene. Prefabs are
// what the AI assistant and the built-in object library use to spawn ready
// made gameplay objects (player, enemy, pickup, door, ...).
#pragma once
#include "scene/scene.h"

#include <string>

namespace nf {

class Scene;

struct Prefab {
    std::string name = "Prefab";
    std::string description;
    Json root;                       // {"entity": {...}} subtree in scene JSON form

    Json toJson() const;
    static Prefab fromJson(const Json& j);
    bool save(const std::string& path) const;
    bool load(const std::string& path, std::string* error = nullptr);
    bool valid() const { return root.isObject() && root.has("entity"); }

    // Creates the prefab's entities in `scene` under `parent`.
    EntityId instantiate(Scene& scene, EntityId parent = kInvalidEntity,
                         const Vec3& position = Vec3(0, 0, 0),
                         const Quat& rotation = Quat::identity()) const;
};

// Extracts an entity (and its children) from a scene into a prefab.
Prefab makePrefabFromEntity(const Scene& scene, EntityId id, const std::string& prefabName);

// --- built-in prefab library (no files needed) ------------------------
namespace builtin_prefabs {
struct BuiltinPrefab {
    const char* id;            // "Player", "Enemy", "Pickup", "Door", "Platform", ...
    const char* displayName;
    const char* description;
    const char* category;      // "Gameplay", "Objects", "Lighting", "AI"
};
const std::vector<BuiltinPrefab>& list();
Prefab create(const std::string& id);
// Spawns a built-in prefab directly into the scene (used by menus + AI).
EntityId spawn(Scene& scene, const std::string& id, const Vec3& position,
               EntityId parent = kInvalidEntity);
}  // namespace builtin_prefabs

}  // namespace nf
