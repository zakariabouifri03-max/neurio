// NovaForge Engine - scripting/ScriptSystem.cpp
#include "scripting/ScriptSystem.h"
#include "runtime/GameRuntime.h"
#include "scene/Scene.h"
#include "scene/SceneFactory.h"
#include "physics/PhysicsWorld.h"
#include "audio/AudioSystem.h"
#include "core/FileSystem.h"
#include "core/Log.h"
#include "core/StringUtil.h"

#if NF_PLATFORM_WINDOWS
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
#else
#  include <dlfcn.h>
#endif

namespace nf {

// =========================================================== built-in behaviours
namespace {

struct BehaviorContext {
  Scene* scene = nullptr;
  ScriptComponent* script = nullptr;
  EntityId owner = 0;
  f32 dt = 0.0f;
  EntityId other = 0;
  bool firstFrame = false;
};

using BehaviorFn = void (*)(BehaviorContext&);

void Behavior_Rotator(BehaviorContext& ctx) {
  Vec3 axis = ctx.script->GetVec3("axis", Vec3(0, 1, 0));
  f32 speed = ctx.script->GetFloat("speed", 90.0f);
  if (GameObject* object = ctx.scene->Get(ctx.owner)) {
    if (TransformComponent* transform = object->Transform()) {
      Quat rotation = Quat::FromAxisAngle(Normalize(axis), speed * kDegToRad * ctx.dt);
      transform->SetRotation(rotation * transform->Rotation());
      ctx.scene->MarkTransformDirty(ctx.owner);
    }
  }
}

void Behavior_Bobber(BehaviorContext& ctx) {
  f32 amplitude = ctx.script->GetFloat("amplitude", 0.4f);
  f32 speed = ctx.script->GetFloat("speed", 1.5f);
  GameObject* object = ctx.scene->Get(ctx.owner);
  if (!object || !object->Transform()) return;
  f32 time = ctx.scene->Runtime() ? (f32)ctx.scene->Runtime()->Clock().totalTime : 0.0f;
  if (ctx.firstFrame) ctx.script->parameters["baseY"] = JsonValue(object->Transform()->position.y);
  f32 baseY = ctx.script->parameters["baseY"].AsFloat(object->Transform()->position.y);
  object->Transform()->position.y = baseY + std::sin(time * speed) * amplitude;
  ctx.scene->MarkTransformDirty(ctx.owner);
}

void Behavior_MovingPlatform(BehaviorContext& ctx) {
  Vec3 pointB = ctx.script->GetVec3("pointB", Vec3(0, 4, 0));
  f32 speed = ctx.script->GetFloat("speed", 2.0f);
  GameObject* object = ctx.scene->Get(ctx.owner);
  if (!object || !object->Transform()) return;
  if (ctx.firstFrame) ctx.script->parameters["pointA"] = JsonValue::Vec3Json(object->Transform()->position);
  Vec3 pointA = ctx.script->parameters["pointA"].AsVec3(object->Transform()->position);
  static std::unordered_map<EntityId, f32> progress;
  f32& t = progress[ctx.owner];
  t += ctx.dt * speed * 0.5f;
  f32 triangle = Abs(Fmod(t, 2.0f) - 1.0f);      // 0..1..0
  object->Transform()->position = Lerp(pointA, pointB, triangle);
  ctx.scene->MarkTransformDirty(ctx.owner);
}

void Behavior_LookAtPlayer(BehaviorContext& ctx) {
  EntityId player = ctx.scene->PlayerEntity();
  if (player == 0 || player == ctx.owner) return;
  GameObject* object = ctx.scene->Get(ctx.owner);
  if (!object || !object->Transform()) return;
  Vec3 direction = ctx.scene->WorldTransform(player).position - ctx.scene->WorldTransform(ctx.owner).position;
  direction.y = 0.0f;
  if (LengthSq(direction) < 0.0001f) return;
  Quat desired = Quat::LookRotation(Normalize(direction), Vec3(0, 1, 0));
  Transform world = ctx.scene->WorldTransform(ctx.owner);
  world.rotation = Quat::Slerp(world.rotation, desired, Saturate(3.0f * ctx.dt));
  ctx.scene->SetWorldTransform(ctx.owner, world);
}

void Behavior_TimedDestroy(BehaviorContext& ctx) {
  f32 lifetime = ctx.script->GetFloat("lifetime", 10.0f);
  static std::unordered_map<EntityId, f32> timers;
  f32& time = timers[ctx.owner];
  if (ctx.firstFrame) time = 0.0f;
  time += ctx.dt;
  if (time >= lifetime) {
    NF_INFO(LogCategory::Script, "TimedDestroy removed '%s' after %.1fs",
            ctx.scene->Get(ctx.owner) ? ctx.scene->Get(ctx.owner)->name.c_str() : "?", lifetime);
    ctx.scene->DestroyObject(ctx.owner);
  }
}

void Behavior_DamageOnTouch(BehaviorContext& ctx) {
  if (ctx.other == 0) return;
  f32 damage = ctx.script->GetFloat("damage", 10.0f);
  f32 cooldown = ctx.script->GetFloat("cooldown", 1.0f);
  static std::unordered_map<EntityId, f32> timers;
  f32& time = timers[ctx.owner];
  if (ctx.dt > 0.0f) time -= ctx.dt;
  if (time > 0.0f) return;
  time = cooldown;
  ctx.scene->ApplyDamage(ctx.other, damage, ctx.owner);
  ctx.scene->PublishEvent(Format("Damage:%.1f", damage));
}

void Behavior_SpawnOnStart(BehaviorContext& ctx) {
  if (!ctx.firstFrame) return;
  std::string templateName = ctx.script->GetString("template", "");
  if (templateName.empty()) return;
  EntityId source = ctx.scene->FindByName(templateName);
  GameObject* object = ctx.scene->Get(source);
  if (!object) {
    NF_WARN(LogCategory::Script, "SpawnOnStart: template '%s' not found", templateName.c_str());
    return;
  }
  Vec3 offset = ctx.script->GetVec3("offset", Vec3(0, 1, 0));
  EntityId spawned = ctx.scene->CreateFromTemplate(*object, templateName, offset);
  ctx.scene->PublishEvent(Format("Spawned:%s", templateName.c_str()));
  NF_INFO(LogCategory::Script, "SpawnOnStart created '%s' (entity %llu)", templateName.c_str(),
          (unsigned long long)spawned);
}

void Behavior_LogMessage(BehaviorContext& ctx) {
  if (!ctx.firstFrame) return;
  std::string message = ctx.script->GetString("message", "Script ran");
  NF_INFO(LogCategory::Script, "[Script] %s", message.c_str());
  ctx.scene->PublishEvent(Format("Message:%s", message.c_str()));
}

void Behavior_TriggerAction(BehaviorContext& ctx) {
  if (ctx.other == 0) return;
  std::string action = ctx.script->GetString("action", "open_door");
  EntityId target = (EntityId)ctx.script->GetFloat("target", (f32)ctx.owner);
  if (action == "open_door") {
    if (ComponentBase* door = ctx.scene->GetComponent(target ? target : ctx.owner, "Door"))
      door->OnTriggerEnter(*ctx.scene, ctx.other);
  } else if (action == "damage") {
    ctx.scene->ApplyDamage(ctx.other, ctx.script->GetFloat("amount", 10.0f), ctx.owner);
  } else if (action == "heal") {
    if (GameObject* object = ctx.scene->Get(ctx.other))
      if (HealthComponent* health = object->Get<HealthComponent>())
        health->Heal(*ctx.scene, ctx.script->GetFloat("amount", 25.0f));
  } else if (action == "teleport") {
    if (GameObject* object = ctx.scene->Get(ctx.other))
      if (TransformComponent* transform = object->Transform()) {
        transform->position = ctx.script->GetVec3("destination", Vec3(0, 2, 0));
        ctx.scene->MarkTransformDirty(ctx.other);
      }
  } else if (action == "message") {
    ctx.scene->PublishEvent(Format("Message:%s", ctx.script->GetString("message", "").c_str()));
  } else if (action == "spawn") {
    std::string templateName = ctx.script->GetString("template", "");
    if (EntityId source = ctx.scene->FindByName(templateName))
      if (GameObject* object = ctx.scene->Get(source))
        ctx.scene->CreateFromTemplate(*object, templateName, ctx.scene->WorldTransform(ctx.owner).position);
  }
}

const ScriptBehaviorInfo kBehaviors[] = {
    {"Rotator", "Rotates the object around an axis.", "axis (vec3), speed (deg/sec)"},
    {"Bobber", "Moves the object up and down.", "amplitude, speed"},
    {"MovingPlatform", "Moves between two points.", "pointB (vec3), speed"},
    {"LookAtPlayer", "Turns the object towards the player.", "(none)"},
    {"TimedDestroy", "Destroys the object after N seconds.", "lifetime"},
    {"DamageOnTouch", "Damages whatever enters its trigger.", "damage, cooldown"},
    {"SpawnOnStart", "Clones a template object when play starts.", "template (object name), offset"},
    {"LogMessage", "Writes a message to the console and the HUD.", "message"},
    {"TriggerAction", "Runs an action when something enters its trigger.",
     "action (open_door/damage/heal/teleport/message/spawn), target, amount, message, template"},
};

BehaviorFn FindBehavior(const std::string& name) {
  if (name == "Rotator") return Behavior_Rotator;
  if (name == "Bobber") return Behavior_Bobber;
  if (name == "MovingPlatform") return Behavior_MovingPlatform;
  if (name == "LookAtPlayer") return Behavior_LookAtPlayer;
  if (name == "TimedDestroy") return Behavior_TimedDestroy;
  if (name == "DamageOnTouch") return Behavior_DamageOnTouch;
  if (name == "SpawnOnStart") return Behavior_SpawnOnStart;
  if (name == "LogMessage") return Behavior_LogMessage;
  if (name == "TriggerAction") return Behavior_TriggerAction;
  return nullptr;
}

} // namespace

// ================================================== declarative .nfscript runner
namespace {

// A tiny but real interpreter for .nfscript files: a list of actions executed on
// start / update / trigger, with conditions and script variables.
class ActionScript {
public:
  bool Load(const std::string& path) {
    JsonValue doc;
    std::string error;
    if (!JsonValue::ParseFile(path, &doc, &error)) {
      NF_ERROR(LogCategory::Script, "Unable to load script %s\nReason: %s", path.c_str(),
               error.c_str());
      return false;
    }
    name_ = doc["name"].AsString(fs::Stem(path));
    onStart_ = doc["on_start"];
    onUpdate_ = doc["on_update"];
    onTrigger_ = doc["on_trigger"];
    variables_ = doc["variables"];
    if (!variables_.IsObject()) variables_ = JsonValue::Object();
    loaded_ = true;
    return true;
  }

  bool loaded() const { return loaded_; }
  const std::string& name() const { return name_; }

  void RunStart(Scene& scene, EntityId entity) {
    RunList(scene, entity, 0, onStart_, 0.0f);
  }
  void RunUpdate(Scene& scene, EntityId entity, f32 dt) {
    time_ += dt;
    RunList(scene, entity, 0, onUpdate_, dt);
  }
  void RunTrigger(Scene& scene, EntityId entity, EntityId other) {
    other_ = other;
    RunList(scene, entity, 0, onTrigger_, 0.0f);
    other_ = 0;
  }

private:
  bool EvaluateCondition(Scene& scene, EntityId entity, JsonValue& condition) {
    std::string type = condition["type"].AsString();
    if (type == "player_near") {
      f32 distance = condition["distance"].AsFloat(3.0f);
      EntityId player = scene.PlayerEntity();
      if (player == 0) return false;
      return Distance(scene.WorldTransform(player).position, scene.WorldTransform(entity).position) <= distance;
    }
    if (type == "health_below") {
      f32 fraction = condition["fraction"].AsFloat(0.5f);
      if (GameObject* object = scene.Get(entity))
        if (HealthComponent* health = object->Get<HealthComponent>())
          return health->HealthPercent() < fraction;
      return false;
    }
    if (type == "variable_equals") {
      std::string key = condition["key"].AsString();
      return variables_[key].AsFloat(0) == condition["value"].AsFloat(0);
    }
    if (type == "time_after") return time_ >= condition["seconds"].AsFloat(1.0f);
    if (type == "triggered") return other_ != 0;
    NF_WARN(LogCategory::Script, "Unknown condition '%s' (treated as false)", type.c_str());
    return false;
  }

  void RunAction(Scene& scene, EntityId entity, JsonValue& action, f32 dt) {
    std::string type = action["action"].AsString();
    GameObject* object = scene.Get(entity);
    if (!object) return;

    if (type == "log" || type == "message") {
      std::string message = action["message"].AsString("(script)");
      NF_INFO(LogCategory::Script, "[%s] %s", name_.c_str(), message.c_str());
      if (type == "message") scene.PublishEvent(Format("Message:%s", message.c_str()));
    } else if (type == "rotate") {
      Vec3 axis = action["axis"].AsVec3(Vec3(0, 1, 0));
      f32 speed = action["speed"].AsFloat(90.0f);
      if (TransformComponent* transform = object->Transform()) {
        transform->SetRotation(Quat::FromAxisAngle(Normalize(axis), speed * kDegToRad * dt) *
                               transform->Rotation());
        scene.MarkTransformDirty(entity);
      }
    } else if (type == "move") {
      Vec3 delta = action["delta"].AsVec3(Vec3(0, 0, 0));
      if (TransformComponent* transform = object->Transform()) {
        transform->position += delta * (dt > 0.0f ? dt : 1.0f);
        scene.MarkTransformDirty(entity);
      }
    } else if (type == "set_position") {
      if (TransformComponent* transform = object->Transform()) {
        transform->position = action["value"].AsVec3(transform->position);
        scene.MarkTransformDirty(entity);
      }
    } else if (type == "bob") {
      f32 amplitude = action["amplitude"].AsFloat(0.4f);
      f32 speed = action["speed"].AsFloat(1.5f);
      if (TransformComponent* transform = object->Transform()) {
        if (baseY_ == 0.0f) baseY_ = transform->position.y;
        transform->position.y = baseY_ + std::sin(time_ * speed) * amplitude;
        scene.MarkTransformDirty(entity);
      }
    } else if (type == "set_visible") {
      if (MeshRendererComponent* renderer = object->Get<MeshRendererComponent>())
        renderer->visible = action["value"].AsBool(true);
    } else if (type == "set_color") {
      if (MeshRendererComponent* renderer = object->Get<MeshRendererComponent>())
        renderer->baseColor = action["value"].AsVec4(renderer->baseColor);
    } else if (type == "damage") {
      EntityId target = (EntityId)action["target"].AsUInt64(other_ != 0 ? other_ : entity);
      scene.ApplyDamage(target, action["amount"].AsFloat(10.0f), entity);
    } else if (type == "heal") {
      EntityId target = (EntityId)action["target"].AsUInt64(other_ != 0 ? other_ : entity);
      if (GameObject* targetObject = scene.Get(target))
        if (HealthComponent* health = targetObject->Get<HealthComponent>())
          health->Heal(scene, action["amount"].AsFloat(25.0f));
    } else if (type == "open_door") {
      EntityId target = (EntityId)action["target"].AsUInt64(entity);
      if (ComponentBase* door = scene.GetComponent(target, "Door")) door->OnTriggerEnter(scene, entity);
    } else if (type == "close_door") {
      EntityId target = (EntityId)action["target"].AsUInt64(entity);
      if (ComponentBase* door = scene.GetComponent(target, "Door")) door->OnTriggerExit(scene, entity);
    } else if (type == "spawn") {
      std::string templateName = action["template"].AsString();
      EntityId source = scene.FindByName(templateName);
      if (GameObject* source_object = scene.Get(source)) {
        Vec3 offset = action["offset"].AsVec3(Vec3(0, 0, 0));
        scene.CreateFromTemplate(*source_object, templateName, offset);
        scene.PublishEvent(Format("Spawned:%s", templateName.c_str()));
      } else {
        NF_WARN(LogCategory::Script, "Script '%s': spawn template '%s' not found", name_.c_str(),
                templateName.c_str());
      }
    } else if (type == "play_sound") {
      if (AudioSystem* audio = scene.Audio()) {
        audio->PlayAt(action["clip"].AsString(), scene.WorldTransform(entity).position,
                      action["volume"].AsFloat(1.0f), false, true);
      }
    } else if (type == "teleport") {
      EntityId target = (EntityId)action["target"].AsUInt64(other_ != 0 ? other_ : entity);
      if (GameObject* targetObject = scene.Get(target))
        if (TransformComponent* transform = targetObject->Transform()) {
          transform->position = action["value"].AsVec3(transform->position);
          scene.MarkTransformDirty(target);
        }
    } else if (type == "look_at_player") {
      EntityId player = scene.PlayerEntity();
      if (player != 0 && player != entity) {
        Vec3 direction = scene.WorldTransform(player).position - scene.WorldTransform(entity).position;
        direction.y = 0;
        if (LengthSq(direction) > 1e-5f)
          if (TransformComponent* transform = object->Transform()) {
            transform->SetRotation(Quat::LookRotation(Normalize(direction), Vec3(0, 1, 0)));
            scene.MarkTransformDirty(entity);
          }
      }
    } else if (type == "set_variable") {
      variables_[action["key"].AsString("v")] = JsonValue(action["value"].AsFloat(0.0f));
    } else if (type == "complete_quest") {
      EntityId target = (EntityId)action["target"].AsUInt64(entity);
      if (ComponentBase* quest = scene.GetComponent(target, "Quest")) quest->OnStart(scene);
    } else if (type == "destroy") {
      scene.DestroyObject(entity);
    } else if (type == "if") {
      if (EvaluateCondition(scene, entity, action["condition"])) {
        JsonValue thenActions = action["then"];
        RunList(scene, entity, 0, thenActions, dt);
      } else {
        JsonValue elseActions = action["else"];
        RunList(scene, entity, 0, elseActions, dt);
      }
    } else if (!type.empty()) {
      NF_WARN(LogCategory::Script, "Script '%s': unknown action '%s' (ignored)", name_.c_str(),
              type.c_str());
    }
  }

  void RunList(Scene& scene, EntityId entity, int depth, JsonValue& list, f32 dt) {
    if (depth > 6 || !list.IsArray()) return;
    for (usize i = 0; i < list.Size(); i++) {
      JsonValue action = list[i];
      RunAction(scene, entity, action, dt);
      if (!scene.IsValid(entity)) return;
    }
  }

  std::string name_ = "Script";
  JsonValue onStart_, onUpdate_, onTrigger_, variables_;
  bool loaded_ = false;
  f32 time_ = 0.0f;
  f32 baseY_ = 0.0f;
  EntityId other_ = 0;
};

struct ScriptInstanceState {
  ActionScript script;
  std::string loadedPath;
  bool started = false;
  bool firstRun = true;
};

std::unordered_map<EntityId, ScriptInstanceState>& ScriptStates() {
  static std::unordered_map<EntityId, ScriptInstanceState> states;
  return states;
}

// ------------------------------------------------- native module registry
#if NF_PLATFORM_WINDOWS
using ModuleHandle = HMODULE;
ModuleHandle LoadLibraryUtf8(const std::string& path) { return ::LoadLibraryA(path.c_str()); }
void* ModuleSymbol(ModuleHandle handle, const char* symbol) {
  return (void*)::GetProcAddress(handle, symbol);
}
void UnloadLibraryHandle(ModuleHandle handle) { ::FreeLibrary(handle); }
#else
using ModuleHandle = void*;
ModuleHandle LoadLibraryUtf8(const std::string& path) { return dlopen(path.c_str(), RTLD_NOW); }
void* ModuleSymbol(ModuleHandle handle, const char* symbol) { return dlsym(handle, symbol); }
void UnloadLibraryHandle(ModuleHandle handle) { dlclose(handle); }
#endif

struct LoadedModuleInfo {
  std::string path;
  ModuleHandle handle = nullptr;
};
std::vector<LoadedModuleInfo>& Modules() {
  static std::vector<LoadedModuleInfo> modules;
  return modules;
}

} // namespace

// =============================================================== ScriptSystem
void ScriptSystem::Initialize(Scene& scene) {
  NF_UNUSED(scene);
  ScriptStates().clear();
}

void ScriptSystem::Shutdown(Scene& scene) {
  NF_UNUSED(scene);
  ScriptStates().clear();
}

void ScriptSystem::OnStart(Scene& scene, ScriptComponent& script) {
  ScriptInstanceState& state = ScriptStates()[script.owner];
  state.started = true;
  state.firstRun = true;
  if (!script.sourcePath.empty() && state.loadedPath != script.sourcePath) {
    state.script = ActionScript{};
    std::string absolute = fs::IsAbsolute(script.sourcePath)
                               ? script.sourcePath
                               : fs::Join(scene.Assets().ProjectRoot(), script.sourcePath);
    if (!state.script.Load(absolute)) {
      script.parameters["loadError"] = JsonValue("script could not be loaded");
    } else {
      state.loadedPath = script.sourcePath;
    }
  }
  if (state.script.loaded()) {
    state.script.RunStart(scene, script.owner);
    return;
  }
  if (BehaviorFn behavior = FindBehavior(script.className)) {
    BehaviorContext context{&scene, &script, script.owner, 0.0f, 0, true};
    behavior(context);
  } else if (!script.className.empty()) {
    NF_WARN(LogCategory::Script, "Behaviour '%s' is not registered (available: Rotator, Bobber, "
                                 "MovingPlatform, LookAtPlayer, TimedDestroy, DamageOnTouch, "
                                 "SpawnOnStart, LogMessage, TriggerAction)",
            script.className.c_str());
  }
}

void ScriptSystem::OnUpdate(Scene& scene, ScriptComponent& script, f32 dt) {
  ScriptInstanceState& state = ScriptStates()[script.owner];
  if (state.script.loaded()) {
    state.script.RunUpdate(scene, script.owner, dt);
    return;
  }
  if (BehaviorFn behavior = FindBehavior(script.className)) {
    BehaviorContext context{&scene, &script, script.owner, dt, 0, state.firstRun};
    behavior(context);
    state.firstRun = false;
  }
}

void ScriptSystem::OnFixedUpdate(Scene& scene, ScriptComponent& script, f32 dt) {
  NF_UNUSED(scene);
  NF_UNUSED(script);
  NF_UNUSED(dt);
}

void ScriptSystem::OnTrigger(Scene& scene, ScriptComponent& script, EntityId other) {
  ScriptInstanceState& state = ScriptStates()[script.owner];
  if (state.script.loaded()) {
    state.script.RunTrigger(scene, script.owner, other);
    return;
  }
  if (BehaviorFn behavior = FindBehavior(script.className)) {
    BehaviorContext context{&scene, &script, script.owner, 0.0f, other, false};
    behavior(context);
  }
}

void ScriptSystem::OnReset(Scene& scene, ScriptComponent& script) {
  NF_UNUSED(scene);
  NF_UNUSED(script);
  ScriptStates().erase(script.owner);
}

std::vector<ScriptBehaviorInfo> ScriptSystem::BuiltinBehaviors() {
  return {std::begin(kBehaviors), std::end(kBehaviors)};
}

bool ScriptSystem::IsBuiltinBehavior(const std::string& name) { return FindBehavior(name) != nullptr; }

bool ScriptSystem::LoadModule(const std::string& path, std::string* error) {
  for (auto& module : Modules()) {
    if (module.path == path) return true;   // already loaded
  }
  std::string absolute = fs::Absolute(path);
  if (!fs::Exists(absolute)) {
    if (error) *error = "module not found: " + path;
    return false;
  }
  ModuleHandle handle = LoadLibraryUtf8(absolute);
  if (!handle) {
    if (error) *error = "could not load module: " + path;
    NF_ERROR(LogCategory::Script, "Failed to load script module %s", path.c_str());
    return false;
  }
  using RegisterFn = void (*)();
  auto registerFn = (RegisterFn)ModuleSymbol(handle, "NovaForgeRegisterComponents");
  if (!registerFn) {
    UnloadLibraryHandle(handle);
    if (error) {
      *error = "module does not export NovaForgeRegisterComponents(): " + path;
    }
    NF_ERROR(LogCategory::Script,
             "Module %s does not export NovaForgeRegisterComponents() - not a NovaForge script module",
             path.c_str());
    return false;
  }
  // components registered by the module tag themselves with their module name
  ComponentRegistry::Get().UnregisterModule(fs::FileName(path));
  registerFn();
  Modules().push_back({path, handle});
  NF_INFO(LogCategory::Script, "Loaded script module %s (%zu component types registered)",
          fs::FileName(path).c_str(), ComponentRegistry::Get().All().size());
  return true;
}

void ScriptSystem::UnloadModule(const std::string& path) {
  auto& modules = Modules();
  for (usize i = 0; i < modules.size(); i++) {
    if (modules[i].path != path) continue;
    ComponentRegistry::Get().UnregisterModule(fs::FileName(path));
    UnloadLibraryHandle(modules[i].handle);
    modules.erase(modules.begin() + (i64)i);
    NF_INFO(LogCategory::Script, "Unloaded script module %s", fs::FileName(path).c_str());
    return;
  }
}

std::vector<std::string> ScriptSystem::LoadedModules() {
  std::vector<std::string> out;
  for (auto& module : Modules()) out.push_back(module.path);
  return out;
}

void ScriptSystem::UnloadAllModules() {
  for (auto& module : Modules()) UnloadLibraryHandle(module.handle);
  Modules().clear();
}

bool ScriptSystem::WriteTemplateScript(const std::string& path, const std::string& name,
                                       const std::string& behavior) {
  JsonValue doc = JsonValue::Object();
  doc["format"] = "NovaForge Script";
  doc["version"] = 1;
  doc["name"] = name;
  JsonValue variables = JsonValue::Object();
  variables["count"] = 0;
  doc["variables"] = variables;

  JsonValue onStart = JsonValue::Array();
  JsonValue log = JsonValue::Object();
  log["action"] = "log";
  log["message"] = name + " started";
  onStart.Push(log);
  doc["on_start"] = onStart;

  JsonValue onUpdate = JsonValue::Array();
  if (behavior == "Bobber") {
    JsonValue bob = JsonValue::Object();
    bob["action"] = "bob";
    bob["amplitude"] = 0.4;
    bob["speed"] = 1.5;
    onUpdate.Push(bob);
  } else if (behavior == "LookAtPlayer") {
    JsonValue look = JsonValue::Object();
    look["action"] = "look_at_player";
    onUpdate.Push(look);
  } else {
    JsonValue rotate = JsonValue::Object();
    rotate["action"] = "rotate";
    JsonValue axis = JsonValue::Array();
    axis.Push(0.0);
    axis.Push(1.0);
    axis.Push(0.0);
    rotate["axis"] = axis;
    rotate["speed"] = 90.0;
    onUpdate.Push(rotate);
  }
  doc["on_update"] = onUpdate;

  JsonValue onTrigger = JsonValue::Array();
  JsonValue conditional = JsonValue::Object();
  conditional["action"] = "if";
  JsonValue condition = JsonValue::Object();
  condition["type"] = "triggered";
  conditional["condition"] = condition;
  JsonValue thenActions = JsonValue::Array();
  JsonValue message = JsonValue::Object();
  message["action"] = "message";
  message["message"] = name + ": trigger entered";
  thenActions.Push(message);
  conditional["then"] = thenActions;
  onTrigger.Push(conditional);
  doc["on_trigger"] = onTrigger;

  if (!doc.WriteFile(path)) {
    NF_ERROR(LogCategory::Script, "Could not write script %s", path.c_str());
    return false;
  }
  NF_INFO(LogCategory::Script, "Created script %s", path.c_str());
  return true;
}

} // namespace nf
