// NovaForge Engine - component <-> JSON helpers
// Used by the scene serializer, the prefab system and the AI assistant
// (which edits components through these functions).
#pragma once
#include "core/json.h"
#include "scene/components.h"

namespace nf {

struct Entity;
class Scene;

Json vec3ToJson(const Vec3& v);
Json quatToJson(const Quat& q);
Vec3 vec3FromJson(const Json& j, const Vec3& def = Vec3(0, 0, 0));
Quat quatFromJson(const Json& j);

Json transformToJson(const Transform& t);
Transform transformFromJson(const Json& j);

Json componentToJson(const Entity& e, ComponentType type);
bool componentFromJson(Entity& e, ComponentType type, const Json& j);

// "mesh", "camera", ... - the JSON key used inside an entity object
const char* componentJsonKey(ComponentType type);

}  // namespace nf
