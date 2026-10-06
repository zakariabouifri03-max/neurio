// NovaForge Engine - aiassistant/AiAssistant.cpp
#include "aiassistant/AiAssistant.h"
#include "editor/EditorContext.h"
#include "scripting/ScriptSystem.h"
#include "core/FileSystem.h"
#include "core/StringUtil.h"
#include "core/Log.h"

#include "imgui.h"

#if NF_PLATFORM_WINDOWS
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winhttp.h>
#endif

#include <algorithm>
#include <regex>

namespace nf {

const char* AiActionKindName(AiActionKind kind) {
  switch (kind) {
    case AiActionKind::CreateObject: return "Create Object";
    case AiActionKind::CreatePrimitive: return "Create Primitive";
    case AiActionKind::CreatePlayer: return "Create Player";
    case AiActionKind::CreateNpc: return "Create NPC";
    case AiActionKind::CreateLight: return "Create Light";
    case AiActionKind::CreateCamera: return "Create Camera";
    case AiActionKind::CreateGround: return "Create Ground";
    case AiActionKind::AddComponent: return "Add Component";
    case AiActionKind::SetProperty: return "Set Property";
    case AiActionKind::CreateScript: return "Create Script";
    case AiActionKind::AttachBehaviour: return "Attach Behaviour";
    case AiActionKind::CreateScene: return "Create Scene";
    case AiActionKind::DeleteObject: return "Delete Object";
    case AiActionKind::MoveObject: return "Move Object";
    case AiActionKind::SetEnvironment: return "Environment";
    case AiActionKind::ImportAsset: return "Import Asset";
    case AiActionKind::Explain: return "Explanation";
  }
  return "Action";
}

JsonValue AiProviderSettings::Serialize() const {
  JsonValue doc = JsonValue::Object();
  doc["enabled"] = enabled;
  doc["endpoint"] = endpoint;
  doc["model"] = model;
  doc["apiKey"] = apiKey;          // stored in the project so a team can share the setup
  doc["timeoutSeconds"] = timeoutSeconds;
  doc["format"] = "NovaForge AI provider settings";
  return doc;
}

AiProviderSettings AiProviderSettings::Deserialize(const JsonValue& doc) {
  AiProviderSettings settings;
  if (!doc.IsObject()) return settings;
  settings.enabled = doc["enabled"].AsBool();
  settings.endpoint = doc["endpoint"].AsString(settings.endpoint);
  settings.model = doc["model"].AsString(settings.model);
  settings.apiKey = doc["apiKey"].AsString();
  settings.timeoutSeconds = doc["timeoutSeconds"].AsInt(45);
  return settings;
}

AiAssistant::AiAssistant() {}
AiAssistant::~AiAssistant() {}

void AiAssistant::Initialize(const std::string& projectRoot) {
  projectRoot_ = projectRoot;
  LoadProviderSettings();
}

void AiAssistant::LoadProviderSettings() {
  if (projectRoot_.empty()) return;
  std::string path = fs::Join(projectRoot_, "Settings/ai.json");
  JsonValue doc;
  std::string error;
  if (JsonValue::ParseFile(path, &doc, &error)) {
    provider_ = AiProviderSettings::Deserialize(doc);
    NF_INFO(LogCategory::AI, "AI provider settings loaded (%s, enabled=%d)",
            provider_.model.c_str(), provider_.enabled ? 1 : 0);
  }
}

void AiAssistant::SaveProviderSettings() {
  if (projectRoot_.empty()) return;
  std::string path = fs::Join(projectRoot_, "Settings/ai.json");
  fs::CreateDirectories(fs::Parent(path));
  if (provider_.Serialize().WriteFile(path)) {
    NF_INFO(LogCategory::AI, "AI provider settings written to %s", path.c_str());
  }
}

void AiAssistant::ClearHistory() { history_.clear(); }

// ------------------------------------------------------------------ planning
namespace {

bool ParseNumberList(const std::string& text, std::vector<f32>* out) {
  static const std::regex numberRegex("-?[0-9]+(\\.[0-9]+)?");
  for (auto it = std::sregex_iterator(text.begin(), text.end(), numberRegex);
       it != std::sregex_iterator(); ++it) {
    out->push_back((f32)std::atof(it->str().c_str()));
    if (out->size() >= 6) break;
  }
  return out->size() >= 3;
}

std::string ToLowerTrim(const std::string& text) { return Trim(ToLower(text)); }

bool Contains(const std::string& haystack, const std::string& needle) {
  return ToLower(haystack).find(ToLower(needle)) != std::string::npos;
}

JsonValue MakeActionPayload(AiActionKind kind) {
  JsonValue payload = JsonValue::Object();
  payload["kind"] = (i32)kind;
  return payload;
}

} // namespace

AiPlan AiAssistant::PlanOffline(const std::string& prompt) {
  AiPlan plan;
  plan.prompt = prompt;
  plan.provider = "offline planner";
  std::string text = ToLowerTrim(prompt);

  auto addAction = [&](AiActionKind kind, const std::string& description, const Vec3& position,
                       const std::string& name, bool destructive = false,
                       const std::string& extraKey = "", const std::string& extraValue = "") {
    AiAction action;
    action.kind = kind;
    action.description = description;
    action.destructive = destructive;
    action.payload = MakeActionPayload(kind);
    action.payload["name"] = name;
    action.payload["position"] = JsonValue::Vec3Json(position);
    if (!extraKey.empty()) action.payload[extraKey] = extraValue;
    plan.actions.push_back(action);
    return action;
  };

  // count: "5 enemies", "three crates"
  int count = 1;
  {
    std::smatch match;
    std::regex countRegex("(\\b[0-9]+\\b)");
    if (std::regex_search(text, match, countRegex)) {
      int parsed = std::atoi(match.str(1).c_str());
      if (parsed > 0 && parsed <= 40) count = parsed;
    } else {
      const std::pair<const char*, int> words[] = {{"one", 1}, {"two", 2}, {"three", 3}, {"four", 4},
                                                   {"five", 5}, {"six", 6}, {"eight", 8}, {"ten", 10},
                                                   {"a dozen", 12}, {"several", 4}, {"a few", 3}};
      for (const auto& word : words) {
        if (Contains(text, word.first)) {
          count = word.second;
          break;
        }
      }
    }
  }

  // explicit position: "at 3 0 -5" / "at (10, 0, 4)"
  Vec3 position(0, 0, 0);
  bool hasPosition = false;
  {
    usize at = text.find(" at ");
    if (at != std::string::npos) {
      std::vector<f32> numbers;
      if (ParseNumberList(text.substr(at), &numbers)) {
        position = Vec3(numbers[0], numbers[1], numbers[2]);
        hasPosition = true;
      }
    }
  }
  if (!hasPosition) {
    // spread objects in a ring so they do not overlap
    position = Vec3((f32)((count - 1) / 2) * 2.0f, 0.0f, 0.0f);
  }

  // environment tweaks
  if (Contains(text, "darker") || Contains(text, "night") || Contains(text, "dim")) {
    AiAction action;
    action.kind = AiActionKind::SetEnvironment;
    action.description = "Darken the scene lighting (ambient 0.12, sky gradient to dusk)";
    action.payload = MakeActionPayload(AiActionKind::SetEnvironment);
    action.payload["ambient"] = 0.12f;
    action.payload["skyTop"] = JsonValue::Vec3Json(Vec3(0.05f, 0.07f, 0.16f));
    action.payload["skyBottom"] = JsonValue::Vec3Json(Vec3(0.16f, 0.18f, 0.26f));
    plan.actions.push_back(action);
  } else if (Contains(text, "brighter") || Contains(text, "daylight") || Contains(text, "sunny")) {
    AiAction action;
    action.kind = AiActionKind::SetEnvironment;
    action.description = "Brighten the scene lighting";
    action.payload = MakeActionPayload(AiActionKind::SetEnvironment);
    action.payload["ambient"] = 0.55f;
    action.payload["skyTop"] = JsonValue::Vec3Json(Vec3(0.35f, 0.55f, 0.90f));
    action.payload["skyBottom"] = JsonValue::Vec3Json(Vec3(0.80f, 0.85f, 0.95f));
    plan.actions.push_back(action);
  }
  if (Contains(text, "fog")) {
    AiAction action;
    action.kind = AiActionKind::SetEnvironment;
    action.description = "Enable distance fog";
    action.payload = MakeActionPayload(AiActionKind::SetEnvironment);
    action.payload["fog"] = true;
    action.payload["fogStart"] = 25.0f;
    action.payload["fogEnd"] = 160.0f;
    plan.actions.push_back(action);
  }

  // deletion
  if ((Contains(text, "delete") || Contains(text, "remove") || Contains(text, "destroy"))) {
    std::string target;
    if (Contains(text, "crate")) target = "Crate";
    else if (Contains(text, "enem") || Contains(text, "npc")) target = "Enemy";
    else if (Contains(text, "light")) target = "Light";
    else if (Contains(text, "all")) target = "*";
    else {
      // "delete the door" -> take the last noun-ish word
      std::vector<std::string> words = SplitString(text, ' ');
      if (!words.empty()) {
        std::string candidate = words.back();
        if (candidate.size() > 2) {
          candidate[0] = (char)std::toupper((unsigned char)candidate[0]);
          target = candidate;
        }
      }
    }
    AiAction action;
    action.kind = AiActionKind::DeleteObject;
    action.destructive = true;
    action.description = "Delete " + (target.empty() ? std::string("all objects matching the request")
                                                     : ("all objects named/tagged '" + target + "'"));
    action.payload = MakeActionPayload(AiActionKind::DeleteObject);
    action.payload["target"] = target;
    plan.actions.push_back(action);
  }

  // creation rules
  if (Contains(text, "player")) {
    addAction(AiActionKind::CreatePlayer, "Create a third-person player controller", Vec3(0, 1.5f, 0),
              "Player");
  }
  if (Contains(text, "enemy") || Contains(text, "enemies") || Contains(text, "npc") ||
      Contains(text, "monster")) {
    int created = 0;
    for (int i = 0; i < count; i++) {
      Vec3 spawn = hasPosition ? Vec3(position.x + (f32)i * 2.0f, std::max(0.9f, position.y), position.z)
                               : Vec3(-4.0f + (f32)i * 3.0f, 0.9f, 6.0f);
      addAction(AiActionKind::CreateNpc, Format("Create NPC #%d with a Patrol state machine", i + 1),
                spawn, Format("Enemy%d", created + 1), false, "behavior", "Chase");
      created++;
    }
  }
  if (Contains(text, "light") || Contains(text, "lamp") || Contains(text, "torch")) {
    std::string kind = Contains(text, "spot") ? "Spot" : (Contains(text, "point") ? "Point" : "Directional");
    addAction(AiActionKind::CreateLight, "Create a " + kind + " light",
              hasPosition ? position : Vec3(0.0f, 6.0f, 0.0f),
              Contains(text, "point") ? "Point Light" : (Contains(text, "spot") ? "Spot Light" : "Directional Light"),
              false, "lightType", kind);
  }
  if (Contains(text, "camera")) {
    addAction(AiActionKind::CreateCamera, "Create a camera", Vec3(0, 3, -8), "Camera");
  }
  if (Contains(text, "ground") || Contains(text, "floor") || Contains(text, "terrain")) {
    addAction(AiActionKind::CreateGround, "Add a 40m ground plane with a static collider",
              Vec3(0, 0, 0), "Ground");
  }
  if (Contains(text, "platform")) {
    int created = 0;
    for (int i = 0; i < std::max(1, count); i++) {
      AiAction action;
      action.kind = AiActionKind::CreatePrimitive;
      action.description = Format("Create platform #%d (Box + MovingPlatform script)", i + 1);
      action.payload = MakeActionPayload(AiActionKind::CreatePrimitive);
      action.payload["primitive"] = "Box";
      action.payload["name"] = Format("Platform%d", created + 1);
      action.payload["position"] =
          JsonValue::Vec3Json(hasPosition ? Vec3(position.x + (f32)i * 3.0f, position.y + 1.0f, position.z)
                                          : Vec3(-2.0f + (f32)i * 4.0f, 1.0f, -6.0f));
      action.payload["scale"] = JsonValue::Vec3Json(Vec3(3.0f, 0.4f, 3.0f));
      action.payload["tag"] = "Ground";
      action.payload["attachBehaviour"] = "MovingPlatform";
      plan.actions.push_back(action);
      created++;
    }
  }
  const struct {
    const char* keyword;
    const char* primitive;
  } kPrimitives[] = {
      {"crate", "Box"}, {"box", "Box"},     {"cube", "Box"},   {"sphere", "Sphere"},
      {"ball", "Sphere"}, {"cylinder", "Cylinder"}, {"cone", "Cone"}, {"capsule", "Capsule"},
      {"plane", "Plane"}, {"quad", "Quad"},
  };
  for (const auto& entry : kPrimitives) {
    if (!Contains(text, entry.keyword)) continue;
    int created = 0;
    for (int i = 0; i < count; i++) {
      AiAction action;
      action.kind = AiActionKind::CreatePrimitive;
      Vec3 spawn = hasPosition
                       ? Vec3(position.x + (f32)i * 1.5f, std::max(0.5f, position.y), position.z)
                       : Vec3(-3.0f + (f32)i * 1.6f, 0.5f, 4.0f);
      action.description = Format("Create %s '%s%d'", entry.primitive,
                                  (char)std::toupper((unsigned char)entry.keyword[0]),
                                  created + 1);
      if (strlen(entry.keyword) > 1) {
        std::string cap = entry.keyword;
        cap[0] = (char)std::toupper((unsigned char)cap[0]);
        action.description = "Create " + std::string(entry.primitive) + " '" + cap +
                             std::to_string(created + 1) + "'";
      }
      action.payload = MakeActionPayload(AiActionKind::CreatePrimitive);
      action.payload["primitive"] = entry.primitive;
      std::string base = entry.keyword;
      base[0] = (char)std::toupper((unsigned char)base[0]);
      action.payload["name"] = base + std::to_string(created + 1);
      action.payload["position"] = JsonValue::Vec3Json(spawn);
      if (Contains(text, "red")) action.payload["baseColor"] = JsonValue::Vec4Json(Vec4(0.85f, 0.25f, 0.2f, 1.0f));
      else if (Contains(text, "green")) action.payload["baseColor"] = JsonValue::Vec4Json(Vec4(0.25f, 0.8f, 0.35f, 1.0f));
      else if (Contains(text, "blue")) action.payload["baseColor"] = JsonValue::Vec4Json(Vec4(0.25f, 0.45f, 0.9f, 1.0f));
      else if (Contains(text, "metal")) action.payload["metallic"] = 0.9f;
      if (Contains(text, "physics") || Contains(text, "fall") || Contains(text, "dynamic")) {
        action.payload["collider"] = true;
        action.payload["rigidbody"] = true;
      }
      plan.actions.push_back(action);
      created++;
    }
    break;   // one primitive family per prompt is enough
  }
  if (Contains(text, "door")) {
    addAction(AiActionKind::CreateObject, "Create an interactable door (opens with E)",
              hasPosition ? position : Vec3(0, 1.0f, 0), "Door");
    plan.actions.back().payload["spawnKind"] = "Door";
  }
  if (Contains(text, "pickup") || Contains(text, "health pack") || Contains(text, "coin")) {
    addAction(AiActionKind::CreateObject, "Create a health pickup",
              hasPosition ? position : Vec3(2.5f, 0.8f, 3.5f), "Pickup");
    plan.actions.back().payload["spawnKind"] = "Pickup";
  }
  if (Contains(text, "trigger")) {
    addAction(AiActionKind::CreateObject, "Create a trigger volume (fires on player enter)",
              hasPosition ? position : Vec3(0, 1.5f, 0), "Trigger");
    plan.actions.back().payload["spawnKind"] = "Trigger";
  }

  // scripts
  {
    std::smatch match;
    std::regex scriptRegex("(?:script|behaviour|behavior)\\s+(?:called\\s+|named\\s+)?([A-Za-z_][A-Za-z0-9_]*)");
    if (std::regex_search(text, match, scriptRegex)) {
      std::string name = match.str(1);
      name[0] = (char)std::toupper((unsigned char)name[0]);
      std::string behaviour = "Rotator";
      if (Contains(text, "bob")) behaviour = "Bobber";
      else if (Contains(text, "move") || Contains(text, "platform")) behaviour = "MovingPlatform";
      else if (Contains(text, "look")) behaviour = "LookAtPlayer";
      else if (Contains(text, "damage")) behaviour = "DamageOnTouch";
      else if (Contains(text, "spawn")) behaviour = "SpawnOnStart";
      else if (Contains(text, "log") || Contains(text, "print")) behaviour = "LogMessage";
      else if (Contains(text, "trigger")) behaviour = "TriggerAction";
      else if (Contains(text, "destroy") || Contains(text, "timer")) behaviour = "TimedDestroy";

      AiAction action;
      action.kind = AiActionKind::CreateScript;
      action.description = "Create Assets/Scripts/" + name + ".nfscript using the " + behaviour +
                           " behaviour";
      action.payload = MakeActionPayload(AiActionKind::CreateScript);
      action.payload["name"] = name;
      action.payload["behavior"] = behaviour;
      plan.actions.push_back(action);
    }
  }
  if (Contains(text, "new scene") || Contains(text, "create scene") || Contains(text, "add scene")) {
    AiAction action;
    action.kind = AiActionKind::CreateScene;
    action.description = "Create a new scene with starter content";
    action.payload = MakeActionPayload(AiActionKind::CreateScene);
    action.payload["name"] = "AIScene";
    action.payload["starter"] = true;
    plan.actions.push_back(action);
  }

  // movement / property edits
  {
    std::smatch match;
    std::regex moveRegex("move\\s+([A-Za-z0-9_]+)\\s+to\\s+(-?[0-9.]+)\\s+(-?[0-9.]+)\\s+(-?[0-9.]+)");
    if (std::regex_search(text, match, moveRegex)) {
      AiAction action;
      action.kind = AiActionKind::MoveObject;
      action.description = "Move '" + match.str(1) + "' to (" + match.str(2) + ", " + match.str(3) +
                           ", " + match.str(4) + ")";
      action.payload = MakeActionPayload(AiActionKind::MoveObject);
      action.payload["name"] = match.str(1);
      action.payload["position"] = JsonValue::Vec3Json(Vec3((f32)std::atof(match.str(2).c_str()),
                                                            (f32)std::atof(match.str(3).c_str()),
                                                            (f32)std::atof(match.str(4).c_str())));
      plan.actions.push_back(action);
    }
  }
  {
    std::smatch match;
    std::regex healthRegex("(?:health|hp)\\s*(?:to|=)?\\s*([0-9]+)");
    if (std::regex_search(text, match, healthRegex) && Contains(text, "player")) {
      AiAction action;
      action.kind = AiActionKind::SetProperty;
      action.description = "Set the player's max health to " + match.str(1);
      action.payload = MakeActionPayload(AiActionKind::SetProperty);
      action.payload["objectName"] = "Player";
      action.payload["component"] = "Health";
      action.payload["property"] = "maxHealth";
      action.payload["value"] = (f32)std::atof(match.str(1).c_str());
      plan.actions.push_back(action);
    }
  }
  {
    std::smatch match;
    std::regex speedRegex("(?:speed|faster|slow(?:er)?)\\s*(?:to|=)?\\s*([0-9.]+)");
    if (std::regex_search(text, match, speedRegex)) {
      AiAction action;
      action.kind = AiActionKind::SetProperty;
      action.description = "Set the player's movement speed to " + match.str(1);
      action.payload = MakeActionPayload(AiActionKind::SetProperty);
      action.payload["objectName"] = "Player";
      action.payload["component"] = "CharacterController";
      action.payload["property"] = "moveSpeed";
      action.payload["value"] = (f32)std::atof(match.str(1).c_str());
      plan.actions.push_back(action);
    }
  }

  if (plan.actions.empty()) {
    AiAction action;
    action.kind = AiActionKind::Explain;
    action.description = "No concrete project change could be derived from that request";
    action.payload = MakeActionPayload(AiActionKind::Explain);
    plan.actions.push_back(action);
    plan.summary = "Nothing to change";
    plan.explanation =
        "I only act on requests I can translate into real project edits, so this prompt did not "
        "produce an action. Try things like:\n"
        "  - add a red crate at 3 0 2\n"
        "  - create a player and 3 enemies\n"
        "  - make the scene darker and add fog\n"
        "  - add a moving platform at 0 1 -6\n"
        "  - create a script called DoorOpener using TriggerAction\n"
        "  - delete all crates\n"
        "  - set the player health to 150\n"
        "Enable a remote provider below to plan free-form requests with an LLM instead.";
  } else {
    plan.summary = Pluralize((int)plan.actions.size(), "action") + " planned";
    plan.explanation = "Planned " + Pluralize((int)plan.actions.size(), "edit") +
                       " for: \"" + prompt + "\". Review the list, uncheck anything you do not "
                       "want, then press Apply.";
  }
  return plan;
}

AiPlan AiAssistant::Plan(EditorContext& ctx, const std::string& prompt) {
  AiPlan plan;
  if (provider_.enabled && !provider_.apiKey.empty()) {
    std::string error;
    plan = PlanRemote(ctx, prompt, &error);
    if (plan.actions.empty()) {
      AiPlan fallback = PlanOffline(prompt);
      fallback.remoteFailed = true;
      fallback.remoteError = error;
      fallback.explanation = "The configured AI provider could not be used (" + error +
                             "). Falling back to the built-in offline planner.\n\n" +
                             fallback.explanation;
      plan = fallback;
    }
  } else {
    plan = PlanOffline(prompt);
  }
  return plan;
}

// --------------------------------------------------------------------- remote
std::string AiAssistant::HttpPost(const std::string& url, const std::string& body,
                                  const std::vector<std::pair<std::string, std::string>>& headers,
                                  int timeoutSeconds, std::string* outError) {
#if NF_PLATFORM_WINDOWS
  std::wstring wideUrl(url.begin(), url.end());
  URL_COMPONENTS components = {};
  components.dwStructSize = sizeof(components);
  wchar_t hostName[256] = {0};
  wchar_t urlPath[2048] = {0};
  components.lpszHostName = hostName;
  components.dwHostNameLength = 255;
  components.lpszUrlPath = urlPath;
  components.dwUrlPathLength = 2047;
  if (!WinHttpCrackUrl(wideUrl.c_str(), (DWORD)wideUrl.size(), 0, &components)) {
    if (outError) *outError = "invalid endpoint URL";
    return {};
  }
  bool secure = components.nScheme == INTERNET_SCHEME_HTTPS;
  HINTERNET session = WinHttpOpen(L"NovaForge/0.1", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                  WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  if (!session) {
    if (outError) *outError = "WinHTTP session could not be created";
    return {};
  }
  WinHttpSetTimeouts(session, timeoutSeconds * 1000, timeoutSeconds * 1000, timeoutSeconds * 1000,
                     timeoutSeconds * 1000);
  HINTERNET connection =
      WinHttpConnect(session, hostName, components.nPort ? components.nPort : (secure ? 443 : 80), 0);
  if (!connection) {
    WinHttpCloseHandle(session);
    if (outError) *outError = "could not reach the provider host";
    return {};
  }
  DWORD flags = secure ? WINHTTP_FLAG_SECURE : 0;
  HINTERNET request = WinHttpOpenRequest(connection, L"POST", urlPath, nullptr,
                                         WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
  if (!request) {
    WinHttpCloseHandle(connection);
    WinHttpCloseHandle(session);
    if (outError) *outError = "request could not be created";
    return {};
  }
  std::wstring wideHeaders;
  for (const auto& header : headers) {
    wideHeaders += std::wstring(header.first.begin(), header.first.end()) + L": " +
                   std::wstring(header.second.begin(), header.second.end()) + L"\r\n";
  }
  if (!wideHeaders.empty()) {
    WinHttpAddRequestHeaders(request, wideHeaders.c_str(), (DWORD)wideHeaders.size(),
                             WINHTTP_ADDREQ_FLAG_ADD);
  }
  BOOL sent = WinHttpSendRequest(request, WINHTTP_NO_ADDITIONAL_HEADERS, 0, (LPVOID)body.data(),
                                 (DWORD)body.size(), (DWORD)body.size(), 0);
  std::string response;
  if (sent && WinHttpReceiveResponse(request, nullptr)) {
    DWORD available = 0;
    do {
      available = 0;
      if (!WinHttpQueryDataAvailable(request, &available)) break;
      if (available == 0) break;
      std::string chunk(available, '\0');
      DWORD read = 0;
      if (!WinHttpReadData(request, chunk.data(), available, &read)) break;
      chunk.resize(read);
      response += chunk;
    } while (available > 0);
  } else if (outError) {
    *outError = "network request failed (error " + std::to_string(GetLastError()) + ")";
  }
  WinHttpCloseHandle(request);
  WinHttpCloseHandle(connection);
  WinHttpCloseHandle(session);
  return response;
#else
  NF_UNUSED(url);
  NF_UNUSED(body);
  NF_UNUSED(headers);
  NF_UNUSED(timeoutSeconds);
  if (outError) *outError = "remote AI providers are implemented for the Windows build only";
  return {};
#endif
}

namespace {

// Minimal extraction of the assistant text from an OpenAI style chat completion.
std::string ExtractAssistantContent(const std::string& response) {
  std::string error;
  JsonValue doc = JsonValue::Parse(response, &error);
  JsonValue choices = doc["choices"];
  if (choices.Size() == 0) return {};
  JsonValue message = choices[(usize)0]["message"];
  std::string content = message["content"].AsString();
  return content;
}

std::string ExtractJsonBlock(const std::string& text) {
  usize start = text.find('{');
  usize end = text.rfind('}');
  if (start == std::string::npos || end == std::string::npos || end <= start) return {};
  return text.substr(start, end - start + 1);
}

} // namespace

AiPlan AiAssistant::PlanRemote(EditorContext& ctx, const std::string& prompt, std::string* error) {
  AiPlan plan;
  plan.prompt = prompt;
  plan.provider = provider_.model;
  plan.usedRemoteModel = true;

  JsonValue system = JsonValue::Object();
  system["role"] = "system";
  system["content"] =
      "You are the NovaForge Engine build assistant. Answer ONLY with a JSON object of the shape "
      "{\"summary\":string,\"explanation\":string,\"actions\":[{\"kind\":string,\"params\":object}]}. "
      "Allowed kinds: CreateObject, CreatePrimitive, CreatePlayer, CreateNpc, CreateLight, "
      "CreateCamera, CreateGround, AddComponent, SetProperty, CreateScript, AttachBehaviour, "
      "CreateScene, DeleteObject, MoveObject, SetEnvironment. CreatePrimitive params: "
      "{\"primitive\":\"Box|Sphere|Cylinder|Cone|Capsule|Plane|Quad\",\"name\":string,"
      "\"position\":[x,y,z],\"scale\":[x,y,z]}. CreateNpc params: {\"name\":string,"
      "\"position\":[x,y,z],\"behavior\":\"Idle|Patrol|Chase|Attack|Follow\"}. DeleteObject params: "
      "{\"target\":string}. Never invent other kinds. Keep under 10 actions.";

  JsonValue user = JsonValue::Object();
  user["role"] = "user";
  user["content"] = "Project: " + ctx.project.Settings().name + " (" +
                    std::to_string(ctx.scene.ObjectCount()) + " objects). Request: " + prompt;

  JsonValue messages = JsonValue::Array();
  messages.Push(system);
  messages.Push(user);

  JsonValue request = JsonValue::Object();
  request["model"] = provider_.model;
  request["messages"] = messages;
  request["temperature"] = 0.2f;
  request["max_tokens"] = 900;
  JsonValue responseFormat = JsonValue::Object();
  responseFormat["type"] = "json_object";
  request["response_format"] = responseFormat;

  std::vector<std::pair<std::string, std::string>> headers = {
      {"Content-Type", "application/json"},
      {"Authorization", "Bearer " + provider_.apiKey},
  };
  std::string responseError;
  std::string response = HttpPost(provider_.endpoint, request.Dump(-1), headers,
                                  provider_.timeoutSeconds, &responseError);
  if (response.empty()) {
    if (error) *error = responseError.empty() ? "empty response" : responseError;
    return plan;
  }
  if (error) error->clear();
  std::string content = ExtractAssistantContent(response);
  std::string json = ExtractJsonBlock(content);
  if (json.empty()) {
    if (error) *error = "the model did not return a JSON action plan";
    return plan;
  }
  JsonValue doc = JsonValue::Parse(json, &responseError);
  if (!responseError.empty()) {
    if (error) *error = "invalid JSON from the model: " + responseError;
    return plan;
  }
  plan.summary = doc["summary"].AsString("AI plan");
  plan.explanation = doc["explanation"].AsString();
  JsonValue actions = doc["actions"];
  static const std::vector<std::pair<const char*, AiActionKind>> kKindMap = {
      {"CreateObject", AiActionKind::CreateObject},
      {"CreatePrimitive", AiActionKind::CreatePrimitive},
      {"CreatePlayer", AiActionKind::CreatePlayer},
      {"CreateNpc", AiActionKind::CreateNpc},
      {"CreateLight", AiActionKind::CreateLight},
      {"CreateCamera", AiActionKind::CreateCamera},
      {"CreateGround", AiActionKind::CreateGround},
      {"AddComponent", AiActionKind::AddComponent},
      {"SetProperty", AiActionKind::SetProperty},
      {"CreateScript", AiActionKind::CreateScript},
      {"AttachBehaviour", AiActionKind::AttachBehaviour},
      {"CreateScene", AiActionKind::CreateScene},
      {"DeleteObject", AiActionKind::DeleteObject},
      {"MoveObject", AiActionKind::MoveObject},
      {"SetEnvironment", AiActionKind::SetEnvironment},
  };
  for (usize i = 0; i < actions.Size() && i < 16; i++) {
    JsonValue entry = actions[i];
    std::string kindName = entry["kind"].AsString();
    AiActionKind kind = AiActionKind::Explain;
    bool known = false;
    for (const auto& mapping : kKindMap) {
      if (kindName == mapping.first) {
        kind = mapping.second;
        known = true;
        break;
      }
    }
    if (!known) {
      plan.warning += "Ignored unsupported action kind: " + kindName + "\n";
      continue;
    }
    AiAction action;
    action.kind = kind;
    action.payload = entry["params"].IsObject() ? entry["params"] : JsonValue::Object();
    action.payload["kind"] = (i32)kind;
    action.destructive = kind == AiActionKind::DeleteObject;
    action.description = std::string(AiActionKindName(kind));
    std::string name = action.payload["name"].AsString();
    if (!name.empty()) action.description += " '" + name + "'";
    plan.actions.push_back(action);
  }
  if (plan.actions.empty() && error) *error = "the model returned no usable actions";
  return plan;
}

bool AiAssistant::TestConnection(std::string* outResponse, std::string* outError) {
  if (provider_.endpoint.empty() || provider_.apiKey.empty()) {
    if (outError) *outError = "configure an endpoint and an API key first";
    return false;
  }
  JsonValue system = JsonValue::Object();
  system["role"] = "system";
  system["content"] = "Reply with the single word: ready";
  JsonValue user = JsonValue::Object();
  user["role"] = "user";
  user["content"] = "ping";
  JsonValue messages = JsonValue::Array();
  messages.Push(system);
  messages.Push(user);
  JsonValue request = JsonValue::Object();
  request["model"] = provider_.model;
  request["messages"] = messages;
  request["max_tokens"] = 8;

  std::vector<std::pair<std::string, std::string>> headers = {
      {"Content-Type", "application/json"},
      {"Authorization", "Bearer " + provider_.apiKey},
  };
  std::string error;
  std::string response = HttpPost(provider_.endpoint, request.Dump(-1), headers, 20, &error);
  if (response.empty()) {
    if (outError) *outError = error.empty() ? "no response" : error;
    return false;
  }
  std::string content = ExtractAssistantContent(response);
  if (outResponse) {
    *outResponse = content.empty() ? response.substr(0, 400) : content;
  }
  return true;
}

// --------------------------------------------------------------------- apply
bool AiAssistant::ApplyAction(EditorContext& ctx, AiAction& action, std::string* error) {
  JsonValue payload = action.payload;
  auto positionFrom = [&](const Vec3& fallback) {
    JsonValue value = payload["position"];
    if (value.IsArray() && value.Size() >= 3) return value.AsVec3();
    return fallback;
  };

  switch (action.kind) {
    case AiActionKind::CreateObject: {
      std::string spawnKind = payload["spawnKind"].AsString();
      std::string name = payload["name"].AsString("Object");
      Vec3 position = positionFrom(Vec3(0, 1, 0));
      EntityId id = 0;
      if (spawnKind == "Door") {
        SpawnOptions options;
        options.position = position;
        options.name = name;
        ctx.BeginEdit("AI: create " + name);
        id = SceneFactory::SpawnDoor(ctx.scene, options);
      } else if (spawnKind == "Pickup") {
        SpawnOptions options;
        options.position = position;
        options.name = name;
        ctx.BeginEdit("AI: create " + name);
        id = SceneFactory::SpawnPickup(ctx.scene, PickupKind::Health, options);
      } else if (spawnKind == "Trigger") {
        SpawnOptions options;
        options.position = position;
        options.name = name;
        ctx.BeginEdit("AI: create " + name);
        id = SceneFactory::SpawnTriggerVolume(ctx.scene, Vec3(3, 3, 3), options);
      } else {
        ctx.BeginEdit("AI: create " + name);
        id = ctx.scene.CreateObject(ctx.scene.UniqueName(name));
        ctx.scene.SetWorldPosition(id, position);
      }
      ctx.EndEdit();
      if (id == 0) {
        if (error) *error = "could not create " + name;
        return false;
      }
      ctx.Select(id);
      action.applied = true;
      return true;
    }
    case AiActionKind::CreatePrimitive: {
      std::string primitive = payload["primitive"].AsString("Box");
      std::string name = payload["name"].AsString(primitive);
      Vec3 position = positionFrom(Vec3(0, 0.5f, 0));
      Vec3 scale = payload["scale"].IsArray() ? payload["scale"].AsVec3() : Vec3(1, 1, 1);
      ctx.BeginEdit("AI: create " + name);
      SpawnOptions options;
      options.position = position;
      options.name = ctx.scene.UniqueName(name);
      options.scale = scale;
      EntityId id = SceneFactory::SpawnPrimitive(ctx.scene, primitive, options);
      if (id == 0) {
        ctx.CancelEdit();
        if (error) *error = "unknown primitive " + primitive;
        return false;
      }
      if (GameObject* object = ctx.scene.Get(id)) {
        if (MeshRendererComponent* renderer = object->Get<MeshRendererComponent>()) {
          if (payload["baseColor"].IsArray()) renderer->baseColor = payload["baseColor"].AsVec4();
          if (payload.Has("metallic")) renderer->metallic = payload["metallic"].AsFloat();
        }
        if (payload["collider"].AsBool()) {
          ColliderComponent* collider = ctx.scene.AddComponent<ColliderComponent>(id);
          if (collider) {
            collider->shape = (i32)ColliderShape::Box;
            collider->size = scale;
          }
        }
        if (payload["rigidbody"].AsBool()) ctx.scene.AddComponent<RigidbodyComponent>(id);
        if (payload.Has("tag")) object->tag = payload["tag"].AsString("Untagged");
      }
      ctx.EndEdit();
      ctx.Select(id);
      action.applied = true;
      action.filePreview = "Scenes: new object '" + name + "'";
      return true;
    }
    case AiActionKind::CreatePlayer: {
      ctx.CommandCreatePlayer(false);
      action.applied = true;
      return true;
    }
    case AiActionKind::CreateNpc: {
      std::string behavior = payload["behavior"].AsString("Patrol");
      int behaviorIndex = 1;
      for (int i = 0; i < 6; i++) {
        if (behavior == NpcBehaviorName((NpcBehavior)i)) behaviorIndex = i;
      }
      std::string name = payload["name"].AsString("Enemy");
      ctx.BeginEdit("AI: create NPC " + name);
      SpawnOptions options;
      options.position = positionFrom(Vec3(0, 0.9f, 4.0f));
      options.name = name;
      options.tag = "Enemy";
      EntityId id = SceneFactory::SpawnNpc(ctx.scene, options, (NpcBehavior)behaviorIndex);
      // make sure the NPC can actually chase the player
      if (GameObject* object = ctx.scene.Get(id)) {
        if (AIComponent* ai = object->Get<AIComponent>()) ai->behavior = behaviorIndex;
      }
      ctx.EndEdit();
      ctx.Select(id);
      action.applied = true;
      return true;
    }
    case AiActionKind::CreateLight: {
      std::string kind = payload["lightType"].AsString("Directional");
      int lightType = kind == "Directional" ? 0 : (kind == "Point" ? 1 : 2);
      ctx.BeginEdit("AI: create light");
      SpawnOptions options;
      options.position = positionFrom(Vec3(0, 6, 0));
      options.name = payload["name"].AsString(kind + " Light");
      EntityId id = SceneFactory::SpawnLight(ctx.scene, (LightType)lightType, options);
      ctx.EndEdit();
      ctx.Select(id);
      action.applied = true;
      return true;
    }
    case AiActionKind::CreateCamera: {
      ctx.CommandCreateCamera();
      action.applied = true;
      return true;
    }
    case AiActionKind::CreateGround: {
      ctx.CommandCreateGround();
      action.applied = true;
      return true;
    }
    case AiActionKind::AddComponent: {
      std::string target = payload["object"].AsString();
      std::string component = payload["component"].AsString();
      EntityId id = target.empty() ? ctx.PrimarySelection() : ctx.scene.FindByName(target);
      if (id == 0) {
        if (error) *error = "object not found: " + target;
        return false;
      }
      ctx.CommandAddComponent(id, component);
      action.applied = true;
      return true;
    }
    case AiActionKind::SetProperty: {
      std::string target = payload["objectName"].AsString();
      std::string component = payload["component"].AsString();
      std::string property = payload["property"].AsString();
      EntityId id = target.empty() ? ctx.PrimarySelection() : ctx.scene.FindByName(target);
      if (id == 0) {
        if (error) *error = "object not found: " + target;
        return false;
      }
      GameObject* object = ctx.scene.Get(id);
      ComponentBase* target_component = object ? object->Get(component.c_str()) : nullptr;
      if (!target_component) {
        if (error) *error = "component not found: " + component + " on " + target;
        return false;
      }
      Property* targetProperty = target_component->PropertiesMutable().FindMutable(property);
      if (!targetProperty) {
        if (error) *error = "property not found: " + property;
        return false;
      }
      ctx.BeginEdit("AI: set " + property);
      targetProperty->SetValue(payload["value"]);
      ctx.EndEdit();
      action.filePreview = "Scenes: " + target + "/" + component + "." + property;
      action.applied = true;
      return true;
    }
    case AiActionKind::CreateScript: {
      std::string name = payload["name"].AsString("NewScript");
      std::string behavior = payload["behavior"].AsString("Rotator");
      std::string relative;
      if (!ctx.project.CreateScript(name, behavior, &relative)) {
        if (error) *error = "could not write the script file";
        return false;
      }
      ctx.assets.Rescan();
      action.filePreview = relative + " (created)";
      action.applied = true;
      return true;
    }
    case AiActionKind::AttachBehaviour: {
      std::string objectName = payload["object"].AsString();
      std::string scriptPath = payload["script"].AsString();
      std::string behavior = payload["behavior"].AsString();
      EntityId id = objectName.empty() ? ctx.PrimarySelection() : ctx.scene.FindByName(objectName);
      if (id == 0) {
        if (error) *error = "object not found: " + objectName;
        return false;
      }
      ctx.BeginEdit("AI: attach script");
      ScriptComponent* script = ctx.scene.AddComponent<ScriptComponent>(id);
      if (!script) {
        ctx.CancelEdit();
        if (error) *error = "could not add the Script component";
        return false;
      }
      script->className = behavior.empty() ? "ActionScript" : behavior;
      script->sourcePath = scriptPath;
      ctx.EndEdit();
      action.applied = true;
      return true;
    }
    case AiActionKind::CreateScene: {
      std::string name = payload["name"].AsString("AIScene");
      std::string relative;
      std::string creationError;
      if (!ctx.project.CreateScene(name, payload["starter"].AsBool(true), &relative, &creationError)) {
        if (error) *error = creationError;
        return false;
      }
      ctx.assets.Rescan();
      action.filePreview = relative + " (created)";
      action.applied = true;
      return true;
    }
    case AiActionKind::DeleteObject: {
      std::string target = payload["target"].AsString();
      ctx.BeginEdit("AI: delete " + (target.empty() ? std::string("objects") : target));
      usize removed = 0;
      std::vector<EntityId> victims;
      for (const auto& object : ctx.scene.AllObjects()) {
        bool match = target.empty() || target == "*" ||
                     ToLower(object->name).find(ToLower(target)) != std::string::npos ||
                     ToLower(object->tag) == ToLower(target);
        if (match) victims.push_back(object->id);
      }
      for (EntityId id : victims) {
        ctx.scene.DestroyObject(id);
        removed++;
      }
      ctx.Deselect();
      ctx.EndEdit();
      action.filePreview = "Scenes: removed " + std::to_string(removed) + " object(s)";
      action.applied = true;
      if (removed == 0 && error) *error = "no objects matched '" + target + "'";
      return removed > 0;
    }
    case AiActionKind::MoveObject: {
      std::string name = payload["name"].AsString();
      EntityId id = ctx.scene.FindByName(name);
      if (id == 0) {
        if (error) *error = "object not found: " + name;
        return false;
      }
      ctx.BeginEdit("AI: move " + name);
      Transform transform = ctx.scene.WorldTransform(id);
      transform.position = payload["position"].AsVec3();
      ctx.scene.SetWorldTransform(id, transform);
      ctx.EndEdit();
      action.applied = true;
      return true;
    }
    case AiActionKind::SetEnvironment: {
      ctx.BeginEdit("AI: environment");
      SceneEnvironment& environment = ctx.scene.Environment();
      if (payload.Has("ambient")) environment.ambientIntensity = payload["ambient"].AsFloat();
      if (payload.Has("skyTop")) environment.skyTop = payload["skyTop"].AsVec3();
      if (payload.Has("skyBottom")) environment.skyBottom = payload["skyBottom"].AsVec3();
      if (payload.Has("fog")) environment.fogEnabled = payload["fog"].AsBool();
      if (payload.Has("fogStart")) environment.fogStart = payload["fogStart"].AsFloat();
      if (payload.Has("fogEnd")) environment.fogEnd = payload["fogEnd"].AsFloat();
      ctx.EndEdit();
      action.filePreview = "Scenes: environment settings";
      action.applied = true;
      return true;
    }
    case AiActionKind::ImportAsset: {
      std::string source = payload["path"].AsString();
      if (!ctx.ImportAsset(source, payload["spawn"].AsBool(false))) {
        if (error) *error = "import failed: " + source;
        return false;
      }
      action.applied = true;
      return true;
    }
    case AiActionKind::Explain:
    default:
      action.applied = true;
      return true;
  }
}

bool AiAssistant::ApplyPlan(EditorContext& ctx, AiPlan& plan, std::string* error) {
  appliedUndoCount_ = 0;
  int applied = 0;
  for (AiAction& action : plan.actions) {
    if (!action.enabled) continue;
    std::string actionError;
    usize undoBefore = ctx.undoStack.size();
    if (!ApplyAction(ctx, action, &actionError)) {
      action.description += "  [FAILED: " + actionError + "]";
      if (error) *error = actionError;
      plan.warning += "Action failed: " + actionError + "\n";
      continue;
    }
    if (ctx.undoStack.size() > undoBefore) appliedUndoCount_ += (int)(ctx.undoStack.size() - undoBefore);
    applied++;
  }
  plan.applied = applied > 0;
  plan.reverted = false;
  lastApplyTime_ = NowSeconds();
  history_.push_back(plan);
  ctx.Status(Format("AI: applied %d action(s)", applied));
  NF_INFO(LogCategory::AI, "AI plan applied: %d action(s) from %s", applied, plan.provider.c_str());
  return applied > 0;
}

bool AiAssistant::RevertLastApply(EditorContext& ctx) {
  if (appliedUndoCount_ <= 0) {
    ctx.Status("Nothing to revert", 4.0f);
    return false;
  }
  int undone = 0;
  for (int i = 0; i < appliedUndoCount_; i++) {
    if (!ctx.Undo()) break;
    undone++;
  }
  appliedUndoCount_ = 0;
  ctx.Status(Format("AI: reverted %d change(s)", undone));
  return undone > 0;
}

// ----------------------------------------------------------------- panel UI
void AiAssistant::DrawPanel(EditorContext& ctx) {
  if (!ImGui::Begin("AI Assistant", nullptr)) {
    ImGui::End();
    return;
  }

  ImGui::TextColored(ImVec4(0.75f, 0.7f, 1.0f, 1.0f), "AI Assistant");
  ImGui::SameLine();
  ImGui::TextDisabled("plans real project edits");
  ImGui::Separator();

  if (ImGui::CollapsingHeader("Provider")) {
    ImGui::Checkbox("Use a remote model (OpenAI-compatible)", &provider_.enabled);
    if (provider_.enabled) {
      static char endpoint[512];
      static char model[128];
      static char apiKey[512];
      snprintf(endpoint, sizeof(endpoint), "%s", provider_.endpoint.c_str());
      snprintf(model, sizeof(model), "%s", provider_.model.c_str());
      snprintf(apiKey, sizeof(apiKey), "%s", provider_.apiKey.c_str());
      if (ImGui::InputText("Endpoint", endpoint, sizeof(endpoint)))
        provider_.endpoint = endpoint;
      if (ImGui::InputText("Model", model, sizeof(model))) provider_.model = model;
      if (ImGui::InputText("API key", apiKey, sizeof(apiKey), ImGuiInputTextFlags_Password))
        provider_.apiKey = apiKey;
      if (ImGui::Button("Save Settings")) {
        SaveProviderSettings();
        ctx.Status("AI provider settings saved to Settings/ai.json");
      }
      ImGui::SameLine();
      if (ImGui::Button("Test Connection")) {
        std::string response, error;
        if (TestConnection(&response, &error)) {
          ctx.Status("AI provider reachable: " + response.substr(0, 60), 8.0f);
          lastError_.clear();
        } else {
          lastError_ = error;
          ctx.Status("AI provider test failed: " + error, 10.0f);
        }
      }
      if (!lastError_.empty())
        ImGui::TextColored(ImVec4(1, 0.5f, 0.5f, 1), "Last error: %s", lastError_.c_str());
      ImGui::TextDisabled("The key is stored in Settings/ai.json inside the project.");
    } else {
      ImGui::TextDisabled("Offline planner active (no network, no key required).");
    }
  }

  ImGui::Spacing();
  ImGui::SetNextItemWidth(-1.0f);
  ImGui::InputTextMultiline("##prompt", aiPromptBuffer_, sizeof(aiPromptBuffer_), ImVec2(-1.0f, 60.0f));
  if (ImGui::Button("Plan Changes", ImVec2(140.0f, 28.0f))) {
    current_ = Plan(ctx, aiPromptBuffer_);
    planIsFresh_ = true;
    confirmationPending_ = false;
    ctx.Status("AI plan ready: " + current_.summary);
  }
  ImGui::SameLine();
  if (ImGui::Button("Clear", ImVec2(90.0f, 28.0f))) {
    current_ = AiPlan{};
    aiPromptBuffer_[0] = '\0';
  }
  ImGui::SameLine();
  ImGui::TextDisabled("Try: \"add a red crate at 3 0 2\"");

  if (!current_.actions.empty()) {
    ImGui::Separator();
    ImGui::TextWrapped("%s", current_.explanation.c_str());
    if (current_.usedRemoteModel)
      ImGui::TextColored(current_.remoteFailed ? ImVec4(1, 0.6f, 0.4f, 1) : ImVec4(0.6f, 0.9f, 1.0f, 1),
                         "Planner: %s", current_.provider.c_str());
    else
      ImGui::TextDisabled("Planner: %s", current_.provider.c_str());
    if (!current_.warning.empty())
      ImGui::TextColored(ImVec4(1, 0.8f, 0.4f, 1), "%s", current_.warning.c_str());

    ImGui::Spacing();
    ImGui::Text("AI ACTION -> expected changes:");
    ImGui::BeginChild("##actions", ImVec2(0.0f, 180.0f), true);
    for (usize i = 0; i < current_.actions.size(); i++) {
      AiAction& action = current_.actions[i];
      ImGui::PushID((int)i);
      ImGui::Checkbox("##enabled", &action.enabled);
      ImGui::SameLine();
      ImVec4 color = action.destructive ? ImVec4(1.0f, 0.55f, 0.45f, 1.0f)
                                        : ImVec4(0.85f, 0.9f, 0.98f, 1.0f);
      ImGui::TextColored(color, "[%s] %s", AiActionKindName(action.kind), action.description.c_str());
      if (!action.filePreview.empty()) {
        ImGui::Indent(28.0f);
        ImGui::TextDisabled("%s", action.filePreview.c_str());
        ImGui::Unindent(28.0f);
      }
      ImGui::PopID();
    }
    ImGui::EndChild();

    bool destructive = false;
    for (const auto& action : current_.actions)
      if (action.enabled && action.destructive) destructive = true;

    if (destructive) {
      ImGui::TextColored(ImVec4(1.0f, 0.6f, 0.4f, 1.0f),
                         "This plan deletes objects. Confirmation is required.");
      ImGui::Checkbox("I understand, delete these objects", &confirmationPending_);
    }
    bool canApply = !current_.applied && (!destructive || confirmationPending_);
    if (!canApply) ImGui::BeginDisabled();
    if (ImGui::Button("Apply", ImVec2(140.0f, 30.0f))) {
      std::string error;
      if (ApplyPlan(ctx, current_, &error)) {
        ctx.Status("AI changes applied - use Revert to undo");
      } else if (!error.empty()) {
        ctx.Status("AI apply failed: " + error, 8.0f);
      }
    }
    if (!canApply) ImGui::EndDisabled();
    ImGui::SameLine();
    if (ImGui::Button("Revert Last Apply", ImVec2(170.0f, 30.0f))) RevertLastApply(ctx);
    ImGui::SameLine();
    if (ImGui::Button("Apply To New Scene", ImVec2(180.0f, 30.0f))) {
      if (ctx.NewScene(false)) {
        std::string error;
        ApplyPlan(ctx, current_, &error);
      }
    }
    if (current_.applied)
      ImGui::TextColored(ImVec4(0.5f, 1.0f, 0.6f, 1.0f), "Applied - the project files and scene are updated.");
  }

  if (!history_.empty()) {
    ImGui::Separator();
    if (ImGui::CollapsingHeader(Format("History (%zu)", history_.size()).c_str())) {
      for (usize i = 0; i < history_.size(); i++) {
        ImGui::PushID((int)i);
        ImGui::TextDisabled("%s", history_[i].prompt.empty() ? "(empty prompt)" : history_[i].prompt.c_str());
        ImGui::SameLine();
        ImGui::TextColored(history_[i].applied ? ImVec4(0.5f, 1.0f, 0.6f, 1.0f)
                                               : ImVec4(0.7f, 0.7f, 0.7f, 1.0f),
                           "%s", history_[i].applied ? "applied" : "planned");
        if (ImGui::SmallButton("Restore")) current_ = history_[i];
        ImGui::PopID();
      }
      if (ImGui::Button("Clear History")) ClearHistory();
    }
  }
  ImGui::End();
}

} // namespace nf
