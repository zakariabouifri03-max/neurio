// NovaForge Engine - aiassistant/AiAssistant.h
// The editor's AI assistant. It turns natural language into *real* project edits:
// scene objects, components, properties, scripts and scenes. Two planners exist:
//
//   * Offline planner  - a deterministic rule based planner that always works,
//                        no network, no API key. This is the default.
//   * Remote planner   - any OpenAI-compatible /chat/completions endpoint. The
//                        model is asked for a JSON action plan which is validated
//                        before anything is applied.
//
// Every plan is shown to the user first (with the files/components it touches),
// destructive actions require explicit confirmation, and applying a plan is
// reversible through the editor's undo history.
#pragma once

#include "core/Base.h"
#include "core/Json.h"

namespace nf {

struct EditorContext;

enum class AiActionKind : int {
  CreateObject = 0,
  CreatePrimitive,
  CreatePlayer,
  CreateNpc,
  CreateLight,
  CreateCamera,
  CreateGround,
  AddComponent,
  SetProperty,
  CreateScript,
  AttachBehaviour,
  CreateScene,
  DeleteObject,
  MoveObject,
  SetEnvironment,
  ImportAsset,
  Explain
};

const char* AiActionKindName(AiActionKind kind);

struct AiAction {
  AiActionKind kind = AiActionKind::Explain;
  std::string description;          // shown in the plan list
  JsonValue payload;                // machine readable parameters
  bool destructive = false;         // deleting / overwriting requires confirmation
  bool enabled = true;              // the user can uncheck an action
  bool applied = false;
  std::string filePreview;          // "Scenes/Main.nfscene::Player/MeshRenderer.baseColor"
};

struct AiPlan {
  std::string prompt;
  std::string summary;
  std::string explanation;
  std::vector<AiAction> actions;
  std::vector<std::string> filesAffected;
  std::string provider = "offline planner";
  bool usedRemoteModel = false;
  bool remoteFailed = false;
  std::string remoteError;
  std::string warning;
  bool applied = false;
  bool reverted = false;
};

struct AiProviderSettings {
  bool enabled = false;             // false = offline planner only (default)
  std::string endpoint = "https://api.openai.com/v1/chat/completions";
  std::string model = "gpt-4o-mini";
  std::string apiKey;
  int timeoutSeconds = 45;

  JsonValue Serialize() const;
  static AiProviderSettings Deserialize(const JsonValue& doc);
};

class AiAssistant {
public:
  AiAssistant();
  ~AiAssistant();

  void Initialize(const std::string& projectRoot);

  // Editor panel (drawn inside the editor's dock space).
  void DrawPanel(EditorContext& ctx);

  // Builds a plan for `prompt` without touching the project.
  AiPlan Plan(EditorContext& ctx, const std::string& prompt);

  // Executes a plan (all enabled actions). Returns false and fills `error` when
  // an action could not be applied; already applied actions are kept (the caller
  // can offer "Revert").
  bool ApplyPlan(EditorContext& ctx, AiPlan& plan, std::string* error = nullptr);

  // Undoes everything the last applied plan did (editor undo stack entries).
  bool RevertLastApply(EditorContext& ctx);

  // Sends a minimal request to the configured endpoint to verify credentials.
  bool TestConnection(std::string* outResponse, std::string* outError);

  AiProviderSettings& Provider() { return provider_; }
  const std::vector<AiPlan>& History() const { return history_; }
  void SaveProviderSettings();
  void ClearHistory();

  // Used by tests and the console: the offline planner without an editor context.
  static AiPlan PlanOffline(const std::string& prompt);

private:
  bool ApplyAction(EditorContext& ctx, AiAction& action, std::string* error);
  AiPlan PlanRemote(EditorContext& ctx, const std::string& prompt, std::string* error);
  std::string HttpPost(const std::string& url, const std::string& body,
                       const std::vector<std::pair<std::string, std::string>>& headers,
                       int timeoutSeconds, std::string* outError);
  void LoadProviderSettings();

  AiProviderSettings provider_;
  std::vector<AiPlan> history_;
  AiPlan current_;
  bool confirmationPending_ = false;
  bool planIsFresh_ = false;
  f64 lastApplyTime_ = 0.0;
  int appliedUndoCount_ = 0;
  std::string projectRoot_;
  std::string lastError_;
  char aiPromptBuffer_[2048] = {};
};

} // namespace nf
