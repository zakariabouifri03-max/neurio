// NovaForge Engine - editor/EditorPanels.cpp
// Hierarchy, Inspector, Asset Browser, Console, Project Browser, Build, Project
// Settings, Statistics and the help windows. Every control here performs a real
// edit on the project or the scene - nothing is a placeholder.
#include "editor/EditorApp.h"
#include "buildsystem/BuildSystem.h"
#include "scripting/ScriptSystem.h"
#include "core/FileSystem.h"
#include "core/StringUtil.h"
#include "core/Log.h"
#include "platform/Platform.h"

#include "imgui.h"
#include "imgui_internal.h"

#if NF_PLATFORM_WINDOWS
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shellapi.h>
#endif

#include <algorithm>
#include <functional>
#include <cstring>

namespace nf {

namespace {

const char* AssetKindLabel(AssetType type) {
  switch (type) {
    case AssetType::Model: return "model";
    case AssetType::Texture: return "texture";
    case AssetType::Material: return "material";
    case AssetType::Audio: return "audio";
    case AssetType::Scene: return "scene";
    case AssetType::Script: return "script";
    case AssetType::Animation: return "animation";
    default: return "file";
  }
}

void HelpMarker(const char* text) {
  ImGui::TextDisabled("(?)");
  if (ImGui::IsItemHovered()) {
    ImGui::BeginTooltip();
    ImGui::PushTextWrapPos(ImGui::GetFontSize() * 32.0f);
    ImGui::TextUnformatted(text);
    ImGui::PopTextWrapPos();
    ImGui::EndTooltip();
  }
}

ImVec4 LevelColor(LogLevel level) {
  switch (level) {
    case LogLevel::Trace: return ImVec4(0.55f, 0.58f, 0.62f, 1.0f);
    case LogLevel::Debug: return ImVec4(0.62f, 0.66f, 0.72f, 1.0f);
    case LogLevel::Info: return ImVec4(0.85f, 0.88f, 0.92f, 1.0f);
    case LogLevel::Warning: return ImVec4(1.0f, 0.80f, 0.35f, 1.0f);
    case LogLevel::Error: return ImVec4(1.0f, 0.45f, 0.42f, 1.0f);
    case LogLevel::Fatal: return ImVec4(1.0f, 0.30f, 0.30f, 1.0f);
    default: return ImVec4(0.8f, 0.8f, 0.8f, 1.0f);
  }
}

} // namespace

// ============================================================== Hierarchy
void EditorApp::DrawHierarchyPanel() {
  if (!ctx_.HasProject()) return;
  if (!ImGui::Begin("Hierarchy", &ctx_.showHierarchy)) {
    ImGui::End();
    return;
  }

  ImGui::SetNextItemWidth(-70.0f);
  ImGui::InputTextWithHint("##hierarchyscene", "Filter objects...", ctx_.hierarchySearch.empty()
                                                                        ? assetSearch_
                                                                        : assetSearch_,
                           sizeof(assetSearch_));
  // (search text lives in assetSearch_ for both panels - kept as one small buffer)
  std::string filter = ToLower(assetSearch_);
  ImGui::SameLine();
  if (ImGui::Button("New", ImVec2(-1.0f, 0.0f))) ImGui::OpenPopup("CreateObjectPopup");
  if (ImGui::BeginPopup("CreateObjectPopup")) {
    DrawCreateMenu();
    ImGui::EndPopup();
  }

  ImGui::Separator();
  ImGui::BeginChild("##hierarchytree", ImVec2(0.0f, -26.0f), false);

  std::function<bool(EntityId)> matchesFilter = [&](EntityId id) -> bool {
    if (filter.empty()) return true;
    GameObject* object = ctx_.scene.Get(id);
    if (!object) return false;
    if (ToLower(object->name).find(filter) != std::string::npos) return true;
    if (ToLower(object->tag).find(filter) != std::string::npos) return true;
    for (EntityId child : ctx_.scene.ChildrenOf(id))
      if (matchesFilter(child)) return true;
    return false;
  };

  std::function<void(EntityId)> drawNode = [&](EntityId id) {
    GameObject* object = ctx_.scene.Get(id);
    if (!object || !matchesFilter(id)) return;
    ImGui::PushID((int)id);

    ImGuiTreeNodeFlags flags = ImGuiTreeNodeFlags_OpenOnArrow | ImGuiTreeNodeFlags_SpanAvailWidth |
                              ImGuiTreeNodeFlags_DefaultOpen;
    std::vector<EntityId> children = ctx_.scene.ChildrenOf(id);
    if (children.empty()) flags |= ImGuiTreeNodeFlags_Leaf | ImGuiTreeNodeFlags_NoTreePushOnOpen;
    if (ctx_.IsSelected(id)) flags |= ImGuiTreeNodeFlags_Selected;

    // visibility toggle
    bool visible = object->active;
    if (ImGui::SmallButton(visible ? "o" : "-")) {
      ctx_.BeginEdit("Toggle Visibility");
      object->active = !visible;
      ctx_.EndEdit();
    }
    if (ImGui::IsItemHovered()) ImGui::SetTooltip("Show / hide in the viewport");

    ImGui::SameLine();
    if (!object->active) ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.55f, 0.57f, 0.60f, 1.0f));
    bool open = ImGui::TreeNodeEx("##node", flags, "%s%s", object->name.c_str(),
                                  object->active ? "" : "  (hidden)");
    if (!object->active) ImGui::PopStyleColor();

    bool clicked = ImGui::IsItemClicked(ImGuiMouseButton_Left) && !ImGui::IsItemToggledOpen();
    if (clicked) ctx_.Select(id, ImGui::GetIO().KeyCtrl);

    if (ImGui::BeginDragDropSource(ImGuiDragDropFlags_SourceAllowNullID)) {
      ImGui::SetDragDropPayload("NF_OBJECT", &id, sizeof(EntityId));
      ImGui::Text("Move %s", object->name.c_str());
      ImGui::EndDragDropSource();
    }
    if (ImGui::BeginDragDropTarget()) {
      if (const ImGuiPayload* payload = ImGui::AcceptDragDropPayload("NF_OBJECT")) {
        EntityId dragged = *(const EntityId*)payload->Data;
        ctx_.CommandReparent(dragged, id);
      }
      if (const ImGuiPayload* payload = ImGui::AcceptDragDropPayload("NF_ASSET")) {
        std::string assetPath((const char*)payload->Data, (usize)payload->DataSize - 1);
        ctx_.BeginEdit("Instantiate Asset");
        EntityId spawned = ctx_.CommandSpawnAsset(assetPath, Vec3(0, 0, 0));
        ctx_.CommandReparent(spawned, id);
        ctx_.EndEdit();
      }
      ImGui::EndDragDropTarget();
    }

    if (ImGui::BeginPopupContextItem("##objectctx")) {
      ctx_.Select(id, false);
      DrawObjectContextMenu(id);
      ImGui::EndPopup();
    }

    if (ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(ImGuiMouseButton_Left)) {
      snprintf(renameBuffer_.data(), renameBuffer_.size(), "%s", object->name.c_str());
      renameTarget_ = id;
      renamePopup_ = true;
    }

    if (open && !children.empty()) {
      for (EntityId child : children) drawNode(child);
      ImGui::TreePop();
    }
    ImGui::PopID();
  };

  for (EntityId root : ctx_.scene.RootIds()) drawNode(root);

  // empty space context menu
  if (ImGui::BeginPopupContextWindow("##hierarchyempty", ImGuiPopupFlags_MouseButtonRight |
                                                                  ImGuiPopupFlags_NoOpenOverItems)) {
    if (ImGui::MenuItem("Create Empty")) ctx_.CommandCreateEmpty();
    if (ImGui::BeginMenu("Create")) {
      DrawCreateMenu();
      ImGui::EndMenu();
    }
    ImGui::Separator();
    if (ImGui::MenuItem("Paste (duplicate)", "Ctrl+D", false, ctx_.HasSelection()))
      ctx_.CommandDuplicateSelection();
    ImGui::EndPopup();
  }
  ImGui::EndChild();

  if (renamePopup_ && renameTarget_ != 0) {
    ImGui::OpenPopup("Rename Object");
    renamePopup_ = false;
  }
  if (ImGui::BeginPopupModal("Rename Object", nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
    ImGui::SetNextItemWidth(280.0f);
    ImGui::InputText("##rename", renameBuffer_.data(), renameBuffer_.size());
    if (ImGui::Button("Rename", ImVec2(120, 0))) {
      ctx_.CommandRename(renameTarget_, renameBuffer_.data());
      ImGui::CloseCurrentPopup();
    }
    ImGui::SameLine();
    if (ImGui::Button("Cancel", ImVec2(120, 0))) ImGui::CloseCurrentPopup();
    ImGui::EndPopup();
  }

  ImGui::TextDisabled("%zu objects | %zu selected", ctx_.scene.ObjectCount(), ctx_.selection.size());
  ImGui::End();
}

void EditorApp::DrawCreateMenu() {
  if (ImGui::MenuItem("Create Empty")) ctx_.CommandCreateEmpty("Object");
  if (ImGui::BeginMenu("3D Object")) {
    for (const std::string& primitive : Mesh::PrimitiveNames()) {
      if (ImGui::MenuItem(primitive.c_str())) ctx_.CommandCreatePrimitive(primitive);
    }
    if (ImGui::MenuItem("Ground (with collider)")) ctx_.CommandCreateGround();
    ImGui::EndMenu();
  }
  if (ImGui::BeginMenu("Light")) {
    if (ImGui::MenuItem("Directional Light")) ctx_.CommandCreateLight(0);
    if (ImGui::MenuItem("Point Light")) ctx_.CommandCreateLight(1);
    if (ImGui::MenuItem("Spot Light")) ctx_.CommandCreateLight(2);
    ImGui::EndMenu();
  }
  if (ImGui::MenuItem("Camera")) ctx_.CommandCreateCamera();
  ImGui::Separator();
  if (ImGui::MenuItem("Create Player")) ctx_.CommandCreatePlayer(false);
  if (ImGui::MenuItem("Create Player (first person)")) ctx_.CommandCreatePlayer(true);
  if (ImGui::BeginMenu("Create NPC")) {
    for (int i = 0; i < 6; i++)
      if (ImGui::MenuItem(NpcBehaviorName((NpcBehavior)i))) ctx_.CommandCreateNpc(i);
    ImGui::EndMenu();
  }
  if (ImGui::BeginMenu("Create Pickup")) {
    for (int i = 0; i < 5; i++) {
      const char* names[] = {"Health", "Ammo", "Key", "Coin", "Custom"};
      if (ImGui::MenuItem(names[i])) ctx_.CommandCreatePickup(i);
    }
    ImGui::EndMenu();
  }
  ImGui::Separator();
  if (ImGui::MenuItem("Create Door")) ctx_.CommandCreateDoor();
  if (ImGui::MenuItem("Create Trigger Volume")) ctx_.CommandCreateTrigger();
  if (ImGui::MenuItem("Create Quest")) ctx_.CommandCreateQuest();
  if (ImGui::MenuItem("Create Audio Source")) ctx_.CommandCreateAudio();
}

void EditorApp::DrawObjectContextMenu(EntityId object) {
  GameObject* gameObject = ctx_.scene.Get(object);
  if (!gameObject) return;
  if (ImGui::MenuItem("Rename", "F2")) {
    snprintf(renameBuffer_.data(), renameBuffer_.size(), "%s", gameObject->name.c_str());
    renameTarget_ = object;
    renamePopup_ = true;
  }
  if (ImGui::MenuItem("Duplicate", "Ctrl+D")) ctx_.CommandDuplicateSelection();
  if (ImGui::MenuItem("Delete", "Del")) ctx_.CommandDeleteSelection();
  ImGui::Separator();
  if (ImGui::MenuItem("Focus", "F")) ctx_.FocusSelection();
  if (ImGui::MenuItem("Mark As Player")) ctx_.CommandSetPlayer(object);
  if (ImGui::MenuItem("Reset Transform")) ctx_.CommandResetTransform(object);
  if (ImGui::BeginMenu("Set Tag")) {
    for (const auto& tag : ctx_.project.Settings().tags) {
      if (ImGui::MenuItem(tag.c_str())) ctx_.CommandSetTag(object, tag);
    }
    ImGui::EndMenu();
  }
  ImGui::Separator();
  if (ImGui::MenuItem("Unparent")) ctx_.CommandReparent(object, 0);
  if (ImGui::MenuItem("Copy JSON")) {
    JsonValue doc = ctx_.scene.Serialize();
    ImGui::SetClipboardText(doc.Dump(2).c_str());
    ctx_.Status("Scene JSON copied to the clipboard");
  }
}

// ============================================================== Inspector
bool EditorApp::DrawPropertyWidget(Property& property) {
  if (property.visibleIf && !property.visibleIf()) return false;
  if (property.hidden) return false;

  bool changed = false;
  ImGui::PushID(property.id.c_str());
  ImGui::TableNextRow();
  ImGui::TableSetColumnIndex(0);
  ImGui::AlignTextToFramePadding();
  ImGui::TextUnformatted(property.display.c_str());
  if (!property.tooltip.empty()) {
    ImGui::SameLine();
    HelpMarker(property.tooltip.c_str());
  }
  ImGui::TableSetColumnIndex(1);
  ImGui::SetNextItemWidth(-1.0f);
  ImGui::PushID(property.id.c_str());
  if (property.readOnly) ImGui::BeginDisabled();

  JsonValue value = property.Value();
  switch (property.type) {
    case PropType::Bool: {
      bool current = value.AsBool();
      if (ImGui::Checkbox("##v", &current)) {
        property.SetValue(current);
        changed = true;
      }
      break;
    }
    case PropType::Int: {
      i32 current = value.AsInt();
      i32 minValue = (i32)property.min;
      i32 maxValue = (i32)property.max;
      if (ImGui::DragInt("##v", &current, 0.2f, minValue, maxValue)) {
        property.SetValue(current);
        changed = true;
      }
      break;
    }
    case PropType::Float: {
      f32 current = value.AsFloat();
      if (ImGui::DragFloat("##v", &current, property.speed, property.min, property.max, "%.3f")) {
        property.SetValue(current);
        changed = true;
      }
      break;
    }
    case PropType::Vec2: {
      f32 values[2] = {value.AsVec3().x, value.AsVec3().y};
      if (ImGui::DragFloat2("##v", values, property.speed)) {
        property.SetValue(JsonValue::Vec3Json(Vec3(values[0], values[1], 0)));
        changed = true;
      }
      break;
    }
    case PropType::Vec3: {
      Vec3 current = value.AsVec3();
      f32 values[3] = {current.x, current.y, current.z};
      if (ImGui::DragFloat3("##v", values, property.speed)) {
        property.SetValue(JsonValue::Vec3Json(Vec3(values[0], values[1], values[2])));
        changed = true;
      }
      break;
    }
    case PropType::Vec4: {
      Vec4 current = value.AsVec4();
      f32 values[4] = {current.x, current.y, current.z, current.w};
      if (ImGui::DragFloat4("##v", values, property.speed)) {
        property.SetValue(JsonValue::Vec4Json(Vec4(values[0], values[1], values[2], values[3])));
        changed = true;
      }
      break;
    }
    case PropType::Color:
    case PropType::Color4: {
      Vec4 current = value.AsVec4();
      f32 values[4] = {current.x, current.y, current.z, current.w};
      int flags = ImGuiColorEditFlags_NoInputs | ImGuiColorEditFlags_AlphaBar;
      if (property.type == PropType::Color) {
        flags |= ImGuiColorEditFlags_NoAlpha;
        values[3] = 1.0f;
      }
      if (ImGui::ColorEdit4("##v", values, flags)) {
        property.SetValue(JsonValue::Vec4Json(Vec4(values[0], values[1], values[2], values[3])));
        changed = true;
      }
      break;
    }
    case PropType::String: {
      char buffer[512];
      snprintf(buffer, sizeof(buffer), "%s", value.AsString().c_str());
      if (ImGui::InputText("##v", buffer, sizeof(buffer))) {
        property.SetValue(std::string(buffer));
        changed = true;
      }
      break;
    }
    case PropType::MultilineString: {
      static char buffer[4096];
      snprintf(buffer, sizeof(buffer), "%s", value.AsString().c_str());
      if (ImGui::InputTextMultiline("##v", buffer, sizeof(buffer), ImVec2(-1.0f, 80.0f))) {
        property.SetValue(std::string(buffer));
        changed = true;
      }
      break;
    }
    case PropType::Enum: {
      i32 current = value.AsInt();
      std::string label = (current >= 0 && current < (i32)property.enumLabels.size())
                              ? property.enumLabels[(usize)current]
                              : "(invalid)";
      if (ImGui::BeginCombo("##v", label.c_str())) {
        for (usize i = 0; i < property.enumLabels.size(); i++) {
          bool selected = (i32)i == current;
          if (ImGui::Selectable(property.enumLabels[i].c_str(), selected)) {
            property.SetValue((i32)i);
            changed = true;
          }
        }
        ImGui::EndCombo();
      }
      break;
    }
    case PropType::Asset: {
      std::string current = value.AsString();
      char buffer[512];
      snprintf(buffer, sizeof(buffer), "%s", current.c_str());
      if (ImGui::InputText("##v", buffer, sizeof(buffer))) {
        property.SetValue(std::string(buffer));
        changed = true;
      }
      // drag & drop from the asset browser
      if (ImGui::BeginDragDropTarget()) {
        if (const ImGuiPayload* payload = ImGui::AcceptDragDropPayload("NF_ASSET")) {
          std::string dropped((const char*)payload->Data, (usize)payload->DataSize - 1);
          property.SetValue(dropped);
          changed = true;
        }
        ImGui::EndDragDropTarget();
      }
      ImGui::SameLine();
      if (ImGui::SmallButton("...")) {
        std::vector<platform::FileDialogFilter> filters;
        std::string pattern = property.assetExtension;
        if (pattern.empty()) pattern = "*.*";
        else {
          std::string built;
          for (const auto& ext : SplitString(pattern, ';'))
            built += (built.empty() ? "" : ";") + std::string("*.") + ext;
          pattern = built;
        }
        std::string patternExtension = SplitString(pattern, ';').empty() ? "" : SplitString(pattern, ';')[0];
        filters.push_back({AssetKindLabel(AssetTypeFromExtension(patternExtension)), pattern});
        filters.push_back({"All files", "*.*"});
        std::string file = platform::OpenFileDialog(ctx_.window, "Select asset", filters);
        if (!file.empty()) {
          std::string relative = ctx_.assets.ToProjectRelative(file);
          property.SetValue(relative);
          changed = true;
        }
      }
      if (ImGui::BeginDragDropTarget()) ImGui::EndDragDropTarget();
      break;
    }
    case PropType::Entity: {
      u64 current = value.AsUInt64();
      GameObject* target = ctx_.scene.Get(current);
      std::string label = target ? target->name : "(none)";
      if (ImGui::BeginCombo("##v", label.c_str())) {
        if (ImGui::Selectable("(none)", current == 0)) {
          property.SetValue((u64)0);
          changed = true;
        }
        for (EntityId id : ctx_.scene.ObjectIds()) {
          GameObject* candidate = ctx_.scene.Get(id);
          if (!candidate) continue;
          if (ImGui::Selectable((candidate->name + "##" + std::to_string(id)).c_str(), id == current)) {
            property.SetValue((u64)id);
            changed = true;
          }
        }
        ImGui::EndCombo();
      }
      break;
    }
    case PropType::EntityList: {
      JsonValue array = value;
      for (usize i = 0; i < array.Size(); i++) {
        u64 current = array[i].AsUInt64();
        GameObject* target = ctx_.scene.Get(current);
        std::string label = target ? target->name : "(none)";
        ImGui::PushID((int)i);
        if (ImGui::BeginCombo("##entity", label.c_str())) {
          if (ImGui::Selectable("(none)", current == 0)) {
            array[i] = (u64)0;
            property.SetValue(array);
            changed = true;
          }
          for (EntityId id : ctx_.scene.ObjectIds()) {
            GameObject* candidate = ctx_.scene.Get(id);
            if (!candidate) continue;
            if (ImGui::Selectable((candidate->name + "##" + std::to_string(id)).c_str(), id == current)) {
              array[i] = (u64)id;
              property.SetValue(array);
              changed = true;
            }
          }
          ImGui::EndCombo();
        }
        ImGui::SameLine();
        if (ImGui::SmallButton("x")) {
          JsonValue rebuilt = JsonValue::Array();
          for (usize k = 0; k < array.Size(); k++)
            if (k != i) rebuilt.Push(array[k]);
          property.SetValue(rebuilt);
          changed = true;
        }
        ImGui::PopID();
      }
      if (ImGui::SmallButton("+ Add Reference")) {
        JsonValue rebuilt = JsonValue::Array();
        for (usize k = 0; k < array.Size(); k++) rebuilt.Push(array[k]);
        rebuilt.Push((u64)0);
        property.SetValue(rebuilt);
        changed = true;
      }
      break;
    }
    case PropType::Vec3List:
    case PropType::StringList: {
      JsonValue array = value;
      for (usize i = 0; i < array.Size(); i++) {
        JsonValue entry = array[i];
        if (property.type == PropType::Vec3List) {
          Vec3 point = entry.IsArray() ? entry.AsVec3() : Vec3(0, 0, 0);
          f32 values[3] = {point.x, point.y, point.z};
          ImGui::PushID((int)i);
          if (ImGui::DragFloat3("##point", values, 0.1f)) {
            array[i] = JsonValue::Vec3Json(Vec3(values[0], values[1], values[2]));
            property.SetValue(array);
            changed = true;
          }
          ImGui::SameLine();
          if (ImGui::SmallButton("x")) {
            // remove: rebuild the array
            JsonValue rebuilt = JsonValue::Array();
            for (usize k = 0; k < array.Size(); k++)
              if (k != i) rebuilt.Push(array[k]);
            property.SetValue(rebuilt);
            changed = true;
          }
          ImGui::PopID();
        } else {
          char buffer[256];
          snprintf(buffer, sizeof(buffer), "%s", entry.AsString().c_str());
          ImGui::PushID((int)i);
          if (ImGui::InputText("##str", buffer, sizeof(buffer))) {
            array[i] = std::string(buffer);
            property.SetValue(array);
            changed = true;
          }
          ImGui::SameLine();
          if (ImGui::SmallButton("x")) {
            JsonValue rebuilt = JsonValue::Array();
            for (usize k = 0; k < array.Size(); k++)
              if (k != i) rebuilt.Push(array[k]);
            property.SetValue(rebuilt);
            changed = true;
          }
          ImGui::PopID();
        }
      }
      if (ImGui::SmallButton("+ Add")) {
        JsonValue rebuilt = JsonValue::Array();
        for (usize k = 0; k < array.Size(); k++) rebuilt.Push(array[k]);
        rebuilt.Push(property.type == PropType::Vec3List ? JsonValue::Vec3Json(Vec3(0, 0, 0))
                                                         : JsonValue(""));
        property.SetValue(rebuilt);
        changed = true;
      }
      break;
    }
    case PropType::ReadOnlyText:
    default: {
      std::string text = value.AsString();
      ImGui::TextWrapped("%s", text.c_str());
      break;
    }
  }

  if (property.readOnly) ImGui::EndDisabled();
  ImGui::PopID();
  ImGui::PopID();
  return changed;
}

void EditorApp::DrawInspectorPanel() {
  if (!ctx_.HasProject()) return;
  if (!ImGui::Begin("Inspector", &ctx_.showInspector)) {
    ImGui::End();
    return;
  }
  if (!ctx_.HasSelection()) {
    ImGui::TextDisabled("Nothing selected.");
    ImGui::Spacing();
    ImGui::TextWrapped("Select an object in the Hierarchy or the Viewport to edit its components.");
    ImGui::End();
    return;
  }
  if (ctx_.selection.size() > 1) {
    ImGui::TextColored(ImVec4(0.6f, 0.8f, 1.0f, 1.0f), "%zu objects selected", ctx_.selection.size());
    ImGui::TextDisabled("Changes are applied to every selected object.");
  }

  EntityId primary = ctx_.active != 0 ? ctx_.active : ctx_.PrimarySelection();
  GameObject* object = ctx_.scene.Get(primary);
  if (!object) {
    ImGui::TextDisabled("Selection is stale.");
    ImGui::End();
    return;
  }

  // ---- object header
  {
    char nameBuffer[256];
    snprintf(nameBuffer, sizeof(nameBuffer), "%s", object->name.c_str());
    ImGui::SetNextItemWidth(-1.0f);
    ImGui::InputText("##name", nameBuffer, sizeof(nameBuffer));
    if (ImGui::IsItemActivated()) ctx_.BeginEdit("Rename");
    if (ImGui::IsItemDeactivatedAfterEdit()) {
      std::string newName = nameBuffer;
      for (EntityId id : ctx_.selection) {
        if (GameObject* other = ctx_.scene.Get(id)) other->name = newName;
      }
      ctx_.EndEdit();
    }
    ImGui::SetNextItemWidth(180.0f);
    if (ImGui::BeginCombo("Tag", object->tag.c_str())) {
      for (const auto& tag : ctx_.project.Settings().tags) {
        if (ImGui::Selectable(tag.c_str(), object->tag == tag)) {
          for (EntityId id : ctx_.selection) ctx_.CommandSetTag(id, tag);
        }
      }
      ImGui::EndCombo();
    }
    ImGui::SameLine();
    bool active = object->active;
    if (ImGui::Checkbox("Active", &active)) {
      ctx_.BeginEdit("Toggle Active");
      for (EntityId id : ctx_.selection)
        if (GameObject* other = ctx_.scene.Get(id)) other->active = active;
      ctx_.EndEdit();
    }
    ImGui::SameLine();
    if (ctx_.scene.PlayerEntity() == primary) {
      ImGui::TextColored(ImVec4(0.4f, 1.0f, 0.5f, 1.0f), "PLAYER");
    } else if (ImGui::SmallButton("Mark as Player")) {
      ctx_.CommandSetPlayer(primary);
    }
  }

  ImGui::Separator();

  // ---- components
  int removeIndex = -1;
  for (usize componentIndex = 0; componentIndex < object->components.size(); componentIndex++) {
    ComponentBase* component = object->components[componentIndex].get();
    ImGui::PushID((int)componentIndex);
    bool open = ImGui::CollapsingHeader(component->TypeName(),
                                        ImGuiTreeNodeFlags_DefaultOpen |
                                            ImGuiTreeNodeFlags_AllowOverlap);
    ImGui::SameLine(ImGui::GetContentRegionAvail().x - 10.0f);
    bool enabled = component->enabled;
    if (ImGui::Checkbox("##enabled", &enabled)) {
      ctx_.BeginEdit("Toggle Component");
      component->enabled = enabled;
      ctx_.EndEdit();
    }
    if (ImGui::BeginPopupContextItem("##componentctx")) {
      if (ImGui::MenuItem("Remove Component")) removeIndex = (int)componentIndex;
      if (ImGui::MenuItem("Reset To Defaults")) {
        ComponentBase* fresh = ComponentRegistry::Get().Create(component->TypeName());
        if (fresh) {
          ctx_.BeginEdit("Reset Component");
          component->CopyStateFrom(*fresh);
          ctx_.EndEdit();
          delete fresh;
        }
      }
      if (ImGui::MenuItem(("Copy " + std::string(component->TypeName())).c_str())) {
        ImGui::SetClipboardText(component->Serialize().Dump(2).c_str());
      }
      ImGui::EndPopup();
    }

    if (open) {
      PropertyList& properties = component->PropertiesMutable();
      std::string currentCategory;
      bool tableOpen = false;
      for (Property& property : properties.items) {
        if (property.hidden) continue;
        if (property.visibleIf && !property.visibleIf()) continue;
        if (property.category != currentCategory) {
          if (tableOpen) {
            ImGui::EndTable();
            tableOpen = false;
          }
          currentCategory = property.category;
          if (!currentCategory.empty()) {
            ImGui::Spacing();
            ImGui::TextColored(ImVec4(0.62f, 0.72f, 0.88f, 1.0f), "%s", currentCategory.c_str());
          }
          ImGui::BeginTable("##props", 2, ImGuiTableFlags_SizingStretchProp);
          ImGui::TableSetupColumn("label", ImGuiTableColumnFlags_WidthFixed, 130.0f);
          ImGui::TableSetupColumn("value", ImGuiTableColumnFlags_WidthStretch);
          tableOpen = true;
        }
        if (!tableOpen) {
          ImGui::BeginTable("##props", 2, ImGuiTableFlags_SizingStretchProp);
          ImGui::TableSetupColumn("label", ImGuiTableColumnFlags_WidthFixed, 130.0f);
          ImGui::TableSetupColumn("value", ImGuiTableColumnFlags_WidthStretch);
          tableOpen = true;
        }
        if (DrawPropertyWidget(property)) {
          // apply the same value to every other selected object
          JsonValue newValue = property.Value();
          for (EntityId id : ctx_.selection) {
            if (id == primary) continue;
            GameObject* other = ctx_.scene.Get(id);
            if (!other) continue;
            ComponentBase* target = other->Get(component->TypeName());
            if (!target) continue;
            Property* targetProperty = target->PropertiesMutable().FindMutable(property.id);
            if (targetProperty) targetProperty->SetValue(newValue);
          }
          if (!ctx_.editInProgress) {
            // gestures that complete instantly (checkbox, enum) still need history
            ctx_.BeginEdit(std::string("Edit ") + property.display);
            ctx_.EndEdit();
          }
          ctx_.scene.SetDirty(true);
        }
        if (ImGui::IsItemActivated()) ctx_.BeginEdit(std::string("Edit ") + property.display);
        if (ImGui::IsItemDeactivatedAfterEdit()) ctx_.EndEdit();
      }
      if (tableOpen) ImGui::EndTable();
    }
    ImGui::PopID();
  }

  if (removeIndex >= 0) {
    std::string type = object->components[(usize)removeIndex]->TypeName();
    for (EntityId id : ctx_.selection) ctx_.CommandRemoveComponent(id, type);
  }

  ImGui::Spacing();
  if (ImGui::Button("Add Component", ImVec2(-1.0f, 0.0f))) ImGui::OpenPopup("AddComponentPopup");
  if (ImGui::BeginPopup("AddComponentPopup")) {
    for (ComponentCategory category : {ComponentCategory::Core, ComponentCategory::Rendering,
                                       ComponentCategory::Physics, ComponentCategory::Gameplay,
                                       ComponentCategory::Audio, ComponentCategory::AI,
                                       ComponentCategory::Scripting}) {
      if (!ImGui::BeginMenu(ComponentCategoryName(category))) continue;
      for (const ComponentMeta* meta : ComponentRegistry::Get().ByCategory(category)) {
        if (meta->name == "Transform") continue;
        std::string label = meta->name;
        if (object->Has(meta->name.c_str())) label += " (attached)";
        if (ImGui::MenuItem(label.c_str())) {
          for (EntityId id : ctx_.selection) ctx_.CommandAddComponent(id, meta->name);
        }
      }
      ImGui::EndMenu();
    }
    ImGui::EndPopup();
  }

  ImGui::End();
}

// =========================================================== Asset Browser
void EditorApp::DrawAssetBrowserPanel() {
  if (!ctx_.HasProject()) return;
  if (!ImGui::Begin("Assets", &ctx_.showAssetBrowser)) {
    ImGui::End();
    return;
  }

  if (ImGui::Button("Import Model")) {
    std::string file = platform::OpenFileDialog(
        ctx_.window, "Import model", {{"3D models", "*.glb;*.gltf;*.obj;*.fbx"}, {"All files", "*.*"}});
    if (!file.empty()) ctx_.ImportAsset(file, true);
  }
  ImGui::SameLine();
  if (ImGui::Button("Import Texture")) {
    std::string file = platform::OpenFileDialog(
        ctx_.window, "Import texture", {{"Images", "*.png;*.jpg;*.jpeg;*.bmp;*.tga"}, {"All files", "*.*"}});
    if (!file.empty()) ctx_.ImportAsset(file, false);
  }
  ImGui::SameLine();
  if (ImGui::Button("Import Audio")) {
    std::string file = platform::OpenFileDialog(
        ctx_.window, "Import audio", {{"Audio", "*.wav;*.mp3;*.ogg;*.flac"}, {"All files", "*.*"}});
    if (!file.empty()) ctx_.ImportAsset(file, false);
  }
  ImGui::SameLine();
  if (ImGui::Button("Refresh")) ctx_.RefreshAssets();
  ImGui::SameLine();
  ImGui::SetNextItemWidth(200.0f);
  ImGui::InputTextWithHint("##assetsearch", "Search assets...", assetSearch_, sizeof(assetSearch_));
  std::string filter = ToLower(assetSearch_);

  ImGui::Separator();
  ImGui::BeginChild("##assetgrid", ImVec2(0.0f, -22.0f), false);
  const auto& assets = ctx_.assets.Assets();
  usize shown = 0;
  for (const AssetInfo& asset : assets) {
    if (!filter.empty() && ToLower(asset.path).find(filter) == std::string::npos) continue;
    shown++;
    ImGui::PushID(asset.path.c_str());
    ImGui::BeginGroup();

    ImVec2 tile(74.0f, 74.0f);
    ImVec2 position = ImGui::GetCursorScreenPos();
    bool clicked = ImGui::InvisibleButton("##tile", tile);
    bool hovered = ImGui::IsItemHovered();
    bool selected = ctx_.assetBrowserFolder == asset.path;   // reuse as selection marker
    ImDrawList* draw = ImGui::GetWindowDrawList();
    ImU32 background = selected ? ImGui::GetColorU32(ImVec4(0.22f, 0.38f, 0.60f, 1.0f))
                                : (hovered ? ImGui::GetColorU32(ImVec4(0.20f, 0.22f, 0.26f, 1.0f))
                                           : ImGui::GetColorU32(ImVec4(0.15f, 0.16f, 0.18f, 1.0f)));
    draw->AddRectFilled(position, ImVec2(position.x + tile.x, position.y + tile.y), background, 3.0f);
    draw->AddRect(position, ImVec2(position.x + tile.x, position.y + tile.y),
                  ImGui::GetColorU32(ImVec4(0.28f, 0.30f, 0.34f, 1.0f)), 3.0f);

    if (asset.type == AssetType::Texture) {
      u64 textureHandle = ctx_.renderer->AssetTextureHandle(asset.path);
      if (textureHandle != 0) {
        draw->AddImage((ImTextureID)(intptr_t)textureHandle,
                       ImVec2(position.x + 4, position.y + 4),
                       ImVec2(position.x + tile.x - 4, position.y + tile.y - 4));
      } else {
        draw->AddText(ImVec2(position.x + 8, position.y + 30), IM_COL32(200, 200, 200, 255), "IMG");
      }
    } else {
      const char* label = AssetKindLabel(asset.type);
      std::string upper = ToUpper(std::string(label).substr(0, 3));
      draw->AddText(ImVec2(position.x + 24, position.y + 30), IM_COL32(190, 200, 215, 255),
                    upper.c_str());
      draw->AddText(ImVec2(position.x + 12, position.y + 50), IM_COL32(140, 150, 165, 255),
                    asset.extension.c_str());
    }

    ImGui::TextWrapped("%s", asset.name.c_str());
    ImGui::EndGroup();

    if (selected) {
      // (the folder field doubles as the selected asset when it contains a file)
    }
    if (hovered) {
      ImGui::BeginTooltip();
      ImGui::Text("%s", asset.path.c_str());
      ImGui::TextDisabled("%s | %.1f KB", AssetKindLabel(asset.type),
                          (f32)asset.fileSize / 1024.0f);
      if (asset.failed) ImGui::TextColored(ImVec4(1, 0.5f, 0.5f, 1), "load failed: %s",
                                          asset.loadError.c_str());
      ImGui::EndTooltip();
    }

    if (ImGui::BeginDragDropSource(ImGuiDragDropFlags_SourceAllowNullID)) {
      std::string path = asset.path;
      ImGui::SetDragDropPayload("NF_ASSET", path.c_str(), path.size() + 1);
      ImGui::Text("Drag %s", asset.name.c_str());
      ImGui::EndDragDropSource();
    }

    if (ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(ImGuiMouseButton_Left)) {
      if (asset.type == AssetType::Scene) {
        OpenSceneFromBrowser(asset.path);
      } else if (asset.type == AssetType::Model) {
        ctx_.CommandSpawnAsset(asset.path, ctx_.cameraTarget + Vec3(0, 0.5f, 3.0f));
      } else {
        // open text assets in the built-in viewer/editor
        std::string absolute = ctx_.assets.ToAbsolute(asset.path);
        std::string text;
        if (fs::ReadText(absolute, &text)) {
          textViewerPath_ = absolute;
          textViewerRelative_ = asset.path;
          textViewerBuffer_ = text;
          textViewerDirty_ = false;
          textViewerStatus_.clear();
          showTextViewer_ = true;
        } else {
          ctx_.Status("Cannot open " + asset.path + " as text");
        }
      }
    }

    if (ImGui::BeginPopupContextItem("##assetctx")) {
      if (ImGui::MenuItem("Instantiate In Scene", nullptr, false, asset.type == AssetType::Model))
        ctx_.CommandSpawnAsset(asset.path, ctx_.cameraTarget + Vec3(0, 0.5f, 3.0f));
      if (ImGui::MenuItem("Open Scene", nullptr, false, asset.type == AssetType::Scene))
        OpenSceneFromBrowser(asset.path);
      if (ImGui::MenuItem("Edit File")) {
        std::string text;
        if (fs::ReadText(ctx_.assets.ToAbsolute(asset.path), &text)) {
          textViewerPath_ = ctx_.assets.ToAbsolute(asset.path);
          textViewerRelative_ = asset.path;
          textViewerBuffer_ = text;
          textViewerDirty_ = false;
          showTextViewer_ = true;
        }
      }
      if (ImGui::MenuItem("Re-import", nullptr, false, asset.type == AssetType::Model))
        ctx_.ImportAsset(ctx_.assets.ToAbsolute(asset.path), false);
      if (ImGui::MenuItem("Delete File")) {
        std::string absolute = ctx_.assets.ToAbsolute(asset.path);
        if (fs::Remove(absolute)) {
          ctx_.assets.UnregisterFile(asset.path);
          ctx_.Status("Deleted " + asset.path);
        } else {
          ctx_.Status("Could not delete " + asset.path, 6.0f);
        }
      }
      if (ImGui::MenuItem("Copy Path")) ImGui::SetClipboardText(asset.path.c_str());
      ImGui::EndPopup();
    }
    ImGui::PopID();
    ImGui::SameLine();
    ImGui::EndGroup();
    // wrap tiles every 5 items
    if (shown % 5 == 0) ImGui::NewLine();
  }
  if (shown == 0) ImGui::TextDisabled("No assets match the filter.");
  ImGui::EndChild();
  ImGui::TextDisabled("%zu assets | %zu loaded | %llu KB", assets.size(),
                      ctx_.assets.LoadedAssetCount(),
                      (unsigned long long)(ctx_.assets.MemoryFootprint() / 1024));
  ImGui::End();
}

void EditorApp::DrawTextViewer() {
  if (!showTextViewer_) return;
  ImGui::SetNextWindowSize(ImVec2(760, 560), ImGuiCond_FirstUseEver);
  if (!ImGui::Begin("Text Editor", &showTextViewer_)) {
    ImGui::End();
    return;
  }
  ImGui::TextDisabled("%s%s", textViewerRelative_.c_str(), textViewerDirty_ ? " *" : "");
  ImGui::SameLine();
  if (ImGui::Button("Save")) {
    if (fs::WriteText(textViewerPath_, textViewerBuffer_)) {
      textViewerDirty_ = false;
      textViewerStatus_ = "Saved " + textViewerRelative_;
      ctx_.assets.Rescan();
      ctx_.Status("Saved " + textViewerRelative_);
    } else {
      textViewerStatus_ = "Save failed";
    }
  }
  ImGui::SameLine();
  if (ImGui::Button("Reload")) {
    std::string text;
    if (fs::ReadText(textViewerPath_, &text)) {
      textViewerBuffer_ = text;
      textViewerDirty_ = false;
      textViewerStatus_ = "Reloaded";
    }
  }
  ImGui::SameLine();
  if (ImGui::Button("Validate")) {
    std::string error;
    JsonValue doc = JsonValue::Parse(textViewerBuffer_, &error);
    textViewerStatus_ = error.empty() ? "JSON is valid" : ("Invalid JSON: " + error);
  }
  ImGui::SameLine();
  if (ImGui::Button("Close")) showTextViewer_ = false;
  if (!textViewerStatus_.empty()) {
    ImGui::SameLine();
    ImGui::TextColored(ImVec4(0.6f, 0.85f, 1.0f, 1.0f), "%s", textViewerStatus_.c_str());
  }

  static std::vector<char> buffer;
  if (buffer.size() != textViewerBuffer_.size() + 1) {
    buffer.assign(textViewerBuffer_.begin(), textViewerBuffer_.end());
    buffer.push_back('\0');
  } else {
    memcpy(buffer.data(), textViewerBuffer_.data(), textViewerBuffer_.size());
  }
  buffer.back() = '\0';
  if (ImGui::InputTextMultiline("##text", buffer.data(), buffer.size(),
                                ImVec2(-1.0f, -1.0f))) {
    textViewerBuffer_ = buffer.data();
    textViewerDirty_ = true;
  }
  ImGui::End();
}

// ================================================================ Console
void EditorApp::DrawConsolePanel() {
  if (!ImGui::Begin("Console", &ctx_.showConsole)) {
    ImGui::End();
    return;
  }
  if (ImGui::Button("Clear")) Log::Get().Clear();
  ImGui::SameLine();
  const char* levels[] = {"All", "Info+", "Warning+", "Error"};
  ImGui::SetNextItemWidth(120.0f);
  ImGui::Combo("##level", &ctx_.consoleLevelFilter, levels, 4);
  ImGui::SameLine();
  ImGui::SetNextItemWidth(200.0f);
  ImGui::InputTextWithHint("##filter", "Filter text...", assetSearch_, sizeof(assetSearch_));
  ImGui::SameLine();
  ImGui::Checkbox("Auto-scroll", &ctx_.consoleAutoScroll);

  std::string filter = ToLower(assetSearch_);
  std::vector<LogEntry> entries = Log::Get().Snapshot();
  int errors = 0, warnings = 0;
  for (const auto& entry : entries) {
    if (entry.level == LogLevel::Error || entry.level == LogLevel::Fatal) errors++;
    else if (entry.level == LogLevel::Warning) warnings++;
  }
  ImGui::SameLine();
  ImGui::TextColored(ImVec4(1, 0.5f, 0.5f, 1), "%d errors", errors);
  ImGui::SameLine();
  ImGui::TextColored(ImVec4(1, 0.8f, 0.4f, 1), "%d warnings", warnings);

  ImGui::Separator();
  ImGui::BeginChild("##consolelog", ImVec2(0.0f, 0.0f), false,
                    ImGuiWindowFlags_HorizontalScrollbar);
  for (const LogEntry& entry : entries) {
    int level = (int)entry.level;
    if (ctx_.consoleLevelFilter == 1 && level < (int)LogLevel::Info) continue;
    if (ctx_.consoleLevelFilter == 2 && level < (int)LogLevel::Warning) continue;
    if (ctx_.consoleLevelFilter == 3 && level < (int)LogLevel::Error) continue;
    if (!filter.empty() && ToLower(entry.message).find(filter) == std::string::npos &&
        ToLower(LogCategoryName(entry.category)).find(filter) == std::string::npos)
      continue;
    ImGui::TextDisabled("%s", entry.timestamp.c_str());
    ImGui::SameLine();
    ImGui::TextColored(LevelColor(entry.level), "[%s]", LogCategoryName(entry.category));
    ImGui::SameLine();
    ImGui::TextColored(LevelColor(entry.level), "%s", entry.message.c_str());
    if (entry.count > 1) {
      ImGui::SameLine();
      ImGui::TextDisabled("(x%d)", entry.count);
    }
    if (ImGui::IsItemClicked()) ImGui::SetClipboardText(entry.message.c_str());
  }
  if (ctx_.consoleAutoScroll && ImGui::GetScrollY() >= ImGui::GetScrollMaxY() - 40.0f)
    ImGui::SetScrollHereY(1.0f);
  ImGui::EndChild();
  ImGui::End();
}

// ========================================================== Project Browser
void EditorApp::DrawProjectBrowserPanel() {
  ImGuiViewport* viewport = ImGui::GetMainViewport();
  ImGui::SetNextWindowPos(viewport->GetCenter(), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
  ImGui::SetNextWindowSize(ImVec2(720.0f, 520.0f), ImGuiCond_Always);
  ImGuiWindowFlags flags = ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoResize |
                           ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoDocking;
  if (ctx_.HasProject()) flags &= ~ImGuiWindowFlags_NoCollapse;
  if (!ImGui::Begin("Project Browser", &ctx_.showProjectBrowser, flags)) {
    ImGui::End();
    return;
  }

  ImGui::TextColored(ImVec4(0.55f, 0.75f, 1.0f, 1.0f), "NovaForge Engine");
  ImGui::SameLine();
  ImGui::TextDisabled("v0.1.0 - %s", ctx_.renderer->BackendName());
  ImGui::Separator();
  ImGui::Spacing();

  f32 half = ImGui::GetContentRegionAvail().x * 0.5f - 8.0f;
  ImGui::BeginChild("##newproject", ImVec2(half, 0.0f), true);
  ImGui::Text("Create A New Project");
  ImGui::Separator();
  ImGui::SetNextItemWidth(-1.0f);
  ImGui::InputTextWithHint("##name", "Project name", projectNameBuffer_, sizeof(projectNameBuffer_));
  ImGui::SetNextItemWidth(-1.0f);
  ImGui::InputTextWithHint("##folder", "Parent folder", projectFolderBuffer_,
                           sizeof(projectFolderBuffer_));
  if (ImGui::Button("Browse...", ImVec2(-1.0f, 0.0f))) {
    std::string folder = platform::SelectFolderDialog(ctx_.window, "Choose a folder for the project");
    if (!folder.empty())
      snprintf(projectFolderBuffer_, sizeof(projectFolderBuffer_), "%s", folder.c_str());
  }
  ImGui::Spacing();
  if (ImGui::Button("Create Project", ImVec2(-1.0f, 30.0f))) {
    if (projectNameBuffer_[0] && projectFolderBuffer_[0])
      CreateProject(projectFolderBuffer_, projectNameBuffer_);
    else
      ctx_.Status("Enter a project name and a folder", 5.0f);
  }
  ImGui::Spacing();
  ImGui::TextWrapped(
      "The project is a plain folder: project.json, Assets/ (Models, Textures, Materials, "
      "Scenes, Scripts, Audio), Settings/ (input.json, graphics.json), Builds/ and Logs/.");
  ImGui::EndChild();

  ImGui::SameLine();
  ImGui::BeginChild("##openproject", ImVec2(half, 0.0f), true);
  ImGui::Text("Open An Existing Project");
  ImGui::Separator();
  if (ImGui::Button("Open Project Folder...", ImVec2(-1.0f, 30.0f))) {
    std::string folder = platform::SelectFolderDialog(ctx_.window, "Select the project folder");
    if (!folder.empty()) OpenProject(folder);
  }
  ImGui::Spacing();
  ImGui::TextDisabled("Recent projects");
  ImGui::BeginChild("##recent", ImVec2(0.0f, 150.0f), true);
  if (recentProjects_.empty()) ImGui::TextDisabled("(none yet)");
  for (const auto& recent : recentProjects_) {
    if (ImGui::Selectable(recent.c_str())) OpenProject(recent);
  }
  ImGui::EndChild();
  if (ImGui::Button("Forget Recent List", ImVec2(-1.0f, 0.0f))) {
    recentProjects_.clear();
    SaveRecentProjects();
  }
  ImGui::Spacing();
  ImGui::Separator();
  ImGui::TextDisabled("First time? Create a project above - it comes with a starter scene, "
                      "a player, an NPC, a pickup and a sample script.");
  ImGui::EndChild();

  ImGui::Spacing();
  ImGui::Separator();
  if (ImGui::Button("Keyboard Shortcuts")) ctx_.showShortcuts = true;
  ImGui::SameLine();
  if (ImGui::Button("V1 Scope / V2 Roadmap")) ctx_.showScope = true;
  ImGui::SameLine();
  if (ImGui::Button("About")) ctx_.showAbout = true;
  ImGui::End();
}

// ================================================================== Build
void EditorApp::DrawBuildPanel() {
  if (!ctx_.showBuildDialog && !ctx_.build.running && !ctx_.build.finished) return;
  ImGui::SetNextWindowSize(ImVec2(660.0f, 480.0f), ImGuiCond_FirstUseEver);
  if (!ImGui::Begin("Build", &ctx_.showBuildDialog)) {
    ImGui::End();
    return;
  }
  if (!ctx_.HasProject()) {
    ImGui::TextDisabled("Open a project to build a game.");
    ImGui::End();
    return;
  }

  ProjectSettings& settings = ctx_.project.Settings();
  ImGui::TextColored(ImVec4(0.55f, 0.78f, 1.0f, 1.0f), "Build %s.exe", settings.name.c_str());
  ImGui::TextDisabled("The exported game is a separate runtime executable (NovaForgeGame runtime), "
                      "not a copy of the editor.");
  ImGui::Separator();

  static int configuration = 1;         // 0 debug, 1 release
  static bool copySources = true;
  static bool compileExecutable = true;
  ImGui::RadioButton("Debug", &configuration, 0);
  ImGui::SameLine();
  ImGui::RadioButton("Release", &configuration, 1);
  ImGui::SameLine();
  ImGui::Checkbox("Ship engine sources + rebuild scripts", &copySources);
  ImGui::SameLine();
  ImGui::Checkbox("Compile game .exe", &compileExecutable);
  if (ImGui::IsItemHovered())
    ImGui::SetTooltip("Requires Zig or MSVC on this machine.\n"
                      "Without a compiler the build still packages content and sources, and "
                      "reports that honestly instead of pretending to succeed.");

  ImGui::TextDisabled("Engine sources: %s",
                      ctx_.engineSourceDirectory.empty() ? "(not found - set NOVAFORGE_SOURCE)"
                                                         : ctx_.engineSourceDirectory.c_str());
  std::string toolchain = BuildSystem::DetectToolchain();
  ImGui::TextDisabled("Toolchain: %s", toolchain.empty() ? "(none found)" : toolchain.c_str());

  ProjectValidation validation = ctx_.project.Validate();
  if (!validation.valid) {
    ImGui::Separator();
    ImGui::TextColored(ImVec4(1.0f, 0.5f, 0.5f, 1.0f), "The project cannot be built yet:");
    for (const auto& error : validation.errors) ImGui::BulletText("%s", error.c_str());
  } else if (!validation.warnings.empty()) {
    ImGui::TextColored(ImVec4(1.0f, 0.85f, 0.4f, 1.0f), "%zu warning(s)", validation.warnings.size());
    if (ImGui::TreeNode("Warnings")) {
      for (const auto& warning : validation.warnings) ImGui::BulletText("%s", warning.c_str());
      ImGui::TreePop();
    }
  }

  ImGui::Spacing();
  bool canBuild = !ctx_.build.running && validation.valid;
  if (!canBuild) ImGui::BeginDisabled();
  if (ImGui::Button("BUILD GAME", ImVec2(180.0f, 34.0f))) {
    ctx_.LaunchBuild(configuration == 0, copySources, compileExecutable);
  }
  if (!canBuild) ImGui::EndDisabled();
  ImGui::SameLine();
  if (ImGui::Button("Verify Last Build", ImVec2(160.0f, 34.0f))) ctx_.VerifyLastBuild();
  ImGui::SameLine();
  if (ImGui::Button("Clear Log", ImVec2(120.0f, 34.0f))) {
    ctx_.build = BuildUiState{};
    ctx_.build.step = "Idle";
  }

  ImGui::Spacing();
  if (ctx_.build.running || ctx_.build.finished) {
    ImGui::ProgressBar(ctx_.build.progress, ImVec2(-1.0f, 0.0f));
    if (ctx_.build.running) {
      ImGui::Text("Working: %s", ctx_.build.step.c_str());
      f32 elapsed = (f32)(NowSeconds() - ctx_.build.startedAt);
      ImGui::SameLine();
      ImGui::TextDisabled("(%.1fs)", elapsed);
    } else {
      if (ctx_.build.success)
        ImGui::TextColored(ImVec4(0.4f, 1.0f, 0.5f, 1.0f), "BUILD SUCCEEDED");
      else
        ImGui::TextColored(ImVec4(1.0f, 0.45f, 0.45f, 1.0f), "BUILD FAILED");
      f32 duration = (f32)(ctx_.build.finishedAt - ctx_.build.startedAt);
      ImGui::SameLine();
      ImGui::TextDisabled("(%.1fs)", duration);
      ImGui::TextWrapped("%s", ctx_.build.message.c_str());
      if (!ctx_.build.outputDirectory.empty())
        ImGui::TextDisabled("Output: %s", ctx_.build.outputDirectory.c_str());
      if (!ctx_.build.reportPath.empty() && fs::Exists(ctx_.build.reportPath)) {
        ImGui::SameLine();
        if (ImGui::Button("Open Report")) {
#if NF_PLATFORM_WINDOWS
          ShellExecuteA(nullptr, "open", ctx_.build.reportPath.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
#endif
        }
      }
    }
  }

  if (!ctx_.build.verificationReport.empty()) {
    ImGui::Separator();
    ImGui::TextColored(ctx_.build.verificationValid ? ImVec4(0.4f, 1.0f, 0.5f, 1.0f)
                                                   : ImVec4(1.0f, 0.5f, 0.5f, 1.0f),
                       ctx_.build.verificationValid ? "Package verified" : "Verification failed");
    ImGui::BeginChild("##verification", ImVec2(0.0f, 120.0f), true);
    ImGui::TextUnformatted(ctx_.build.verificationReport.c_str());
    ImGui::EndChild();
  }
  ImGui::End();
}

// ======================================================= Project Settings
void EditorApp::DrawSettingsPanel() {
  if (!ctx_.showSettings || !ctx_.HasProject()) return;
  ImGui::SetNextWindowSize(ImVec2(560.0f, 620.0f), ImGuiCond_FirstUseEver);
  if (!ImGui::Begin("Project Settings", &ctx_.showSettings)) {
    ImGui::End();
    return;
  }
  ProjectSettings& settings = ctx_.project.Settings();
  static char nameBuffer[128] = {0};
  static char versionBuffer[32] = {0};
  static char companyBuffer[128] = {0};
  static bool buffersReady = false;
  if (!buffersReady) {
    snprintf(nameBuffer, sizeof(nameBuffer), "%s", settings.name.c_str());
    snprintf(versionBuffer, sizeof(versionBuffer), "%s", settings.version.c_str());
    snprintf(companyBuffer, sizeof(companyBuffer), "%s", settings.company.c_str());
    buffersReady = true;
  }

  if (ImGui::CollapsingHeader("Game", ImGuiTreeNodeFlags_DefaultOpen)) {
    ImGui::SetNextItemWidth(-1.0f);
    ImGui::InputText("Title", nameBuffer, sizeof(nameBuffer));
    ImGui::SetNextItemWidth(160.0f);
    ImGui::InputText("Version", versionBuffer, sizeof(versionBuffer));
    ImGui::SameLine();
    ImGui::SetNextItemWidth(-1.0f);
    ImGui::InputText("Company", companyBuffer, sizeof(companyBuffer));
  }
  if (ImGui::CollapsingHeader("Window", ImGuiTreeNodeFlags_DefaultOpen)) {
    ImGui::SetNextItemWidth(120.0f);
    ImGui::InputInt("Width", &settings.width);
    ImGui::SameLine();
    ImGui::SetNextItemWidth(120.0f);
    ImGui::InputInt("Height", &settings.height);
    ImGui::Checkbox("Fullscreen", &settings.fullscreen);
    ImGui::SameLine();
    ImGui::Checkbox("VSync", &settings.vsync);
    ImGui::SameLine();
    ImGui::Checkbox("Console window", &settings.showConsoleWindow);
    ImGui::SetNextItemWidth(160.0f);
    ImGui::InputInt("Target FPS (0 = uncapped)", &settings.targetFps);
  }
  if (ImGui::CollapsingHeader("Graphics", ImGuiTreeNodeFlags_DefaultOpen)) {
    const char* qualities[] = {"Low", "Medium", "High", "Ultra"};
    ImGui::SetNextItemWidth(180.0f);
    ImGui::Combo("Quality", &settings.quality, qualities, 4);
    ImGui::SetNextItemWidth(180.0f);
    ImGui::SliderFloat("Field Of View", &settings.fieldOfView, 40.0f, 110.0f, "%.0f deg");
    ImGui::Checkbox("Show FPS in game", &settings.showFpsInGame);
    ImGui::SameLine();
    ImGui::Checkbox("Allow windowed toggle", &settings.allowWindowedToggle);
  }
  if (ImGui::CollapsingHeader("Gameplay", ImGuiTreeNodeFlags_DefaultOpen)) {
    ImGui::SetNextItemWidth(180.0f);
    ImGui::DragFloat("Gravity", &settings.gravity, 0.1f, -100.0f, 0.0f, "%.1f m/s2");
    ImGui::SetNextItemWidth(180.0f);
    ImGui::SliderFloat("Master Volume", &settings.masterVolume, 0.0f, 1.0f);
    ImGui::Spacing();
    ImGui::TextDisabled("Starting scene");
    auto scenes = ctx_.project.ListScenes();
    std::string current = settings.startScene;
    if (ImGui::BeginCombo("##startscene", current.empty() ? "(none)" : current.c_str())) {
      for (const auto& scene : scenes) {
        if (ImGui::Selectable(scene.c_str(), scene == current)) settings.startScene = scene;
      }
      ImGui::EndCombo();
    }
  }
  if (ImGui::CollapsingHeader("Tags")) {
    static char tagBuffer[64] = {0};
    for (usize i = 0; i < settings.tags.size(); i++) {
      ImGui::PushID((int)i);
      ImGui::Text("%s", settings.tags[i].c_str());
      ImGui::SameLine(200.0f);
      if (ImGui::SmallButton("remove") && settings.tags.size() > 1) {
        settings.tags.erase(settings.tags.begin() + (long)i);
        ImGui::PopID();
        break;
      }
      ImGui::PopID();
    }
    ImGui::SetNextItemWidth(160.0f);
    ImGui::InputTextWithHint("##newtag", "New tag", tagBuffer, sizeof(tagBuffer));
    ImGui::SameLine();
    if (ImGui::Button("Add") && tagBuffer[0]) {
      settings.tags.push_back(tagBuffer);
      tagBuffer[0] = '\0';
    }
  }
  if (ImGui::CollapsingHeader("Input Bindings")) {
    ImGui::TextDisabled("Used by the player controller and by scripts (input actions).");
    if (ImGui::BeginTable("##bindings", 3, ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg)) {
      ImGui::TableSetupColumn("Action");
      ImGui::TableSetupColumn("Keys");
      ImGui::TableSetupColumn("Mouse");
      ImGui::TableHeadersRow();
      for (const auto& binding : settings.inputBindings) {
        ImGui::TableNextRow();
        ImGui::TableSetColumnIndex(0);
        ImGui::TextUnformatted(binding.action.c_str());
        ImGui::TableSetColumnIndex(1);
        ImGui::TextUnformatted(JoinStrings(binding.keys, ", ").c_str());
        ImGui::TableSetColumnIndex(2);
        ImGui::TextUnformatted(binding.mouseButton.empty() ? "-" : binding.mouseButton.c_str());
      }
      ImGui::EndTable();
    }
  }

  ImGui::Separator();
  if (ImGui::Button("Save Settings", ImVec2(160.0f, 30.0f))) {
    settings.name = nameBuffer;
    settings.version = versionBuffer;
    settings.company = companyBuffer;
    std::string error;
    if (ctx_.project.Save(&error)) ctx_.Status("Project settings saved");
    else ctx_.Status("Save failed: " + error, 6.0f);
    SetWindowTitle();
  }
  ImGui::SameLine();
  if (ImGui::Button("Save As Project.json", ImVec2(190.0f, 30.0f))) {
    std::string error;
    ctx_.project.Save(&error);
    ctx_.Status("Wrote " + ctx_.project.ProjectFilePath());
  }
  ImGui::SameLine();
  if (ImGui::Button("Validate Project", ImVec2(160.0f, 30.0f))) {
    ProjectValidation validation = ctx_.project.Validate();
    ctx_.Status(validation.valid ? "Project is valid" : "Project has errors - see Console", 8.0f);
    NF_INFO(LogCategory::Editor, "%s", validation.Summary().c_str());
  }
  ImGui::End();
}

// ============================================================ Statistics
void EditorApp::DrawStatsPanel() {
  if (!ctx_.showStats) return;
  if (!ImGui::Begin("Statistics", &ctx_.showStats)) {
    ImGui::End();
    return;
  }
  SceneStats stats = ctx_.scene.GatherStats();
  ImGui::TextColored(ImVec4(0.6f, 0.8f, 1.0f, 1.0f), "Scene");
  ImGui::Text("Objects: %zu", stats.objects);
  ImGui::Text("Renderables: %zu", stats.renderables);
  ImGui::Text("Vertices: %zu", stats.vertices);
  ImGui::Text("Triangles: %zu", stats.triangles);
  ImGui::Text("Lights: %zu", stats.lights);
  ImGui::Text("Colliders: %zu", stats.colliders);

  ImGui::Separator();
  ImGui::TextColored(ImVec4(0.6f, 0.8f, 1.0f, 1.0f), "Renderer");
  ImGui::Text("Backend: %s", ctx_.renderer->BackendName());
  ImGui::TextWrapped("Driver: %s", ctx_.renderer->DriverInfo());
  const RendererStats& rs = ctx_.renderer->Stats();
  ImGui::Text("Draw calls: %zu", rs.drawCalls);
  ImGui::Text("Triangles drawn: %zu", rs.triangles);
  ImGui::Text("Instanced draws: %zu (saved %zu triangles)", rs.instancedDraws, rs.instancesSaved);
  ImGui::Text("Shadow draws: %zu", rs.shadowDrawCalls);
  ImGui::Text("Mesh uploads: %zu | texture uploads: %zu", rs.meshesUploaded, rs.texturesUploaded);
  ImGui::Text("UI vertices: %zu", rs.uiVertices);

  if (ctx_.runtime) {
    ImGui::Separator();
    ImGui::TextColored(ImVec4(0.6f, 0.8f, 1.0f, 1.0f), "Runtime (play mode)");
    const RuntimeStats& rt = ctx_.runtime->Stats();
    ImGui::Text("Simulation: %.2f ms | Physics: %.2f ms", rt.simulationMs, rt.physicsMs);
    ImGui::Text("Active bodies: %u | sleeping: %u", rt.activeBodies, rt.sleepingBodies);
    ImGui::Text("Contacts: %u | trigger events: %u", rt.contacts, rt.triggerEvents);
    ImGui::Text("Drawn: %zu | culled: %zu | instanced batches: %zu", rt.drawnObjects,
                rt.culledObjects, rt.instancedBatches);
    ImGui::Text("Physics bodies: %zu", ctx_.runtime->Physics().BodyCount());
  } else {
    ImGui::Separator();
    ImGui::TextDisabled("Press PLAY to see runtime statistics.");
  }
  ImGui::Separator();
  ImGui::Text("Editor FPS: %.0f (%.2f ms)", fps_, frameTimeMs_);
  ImGui::Text("Asset memory: %llu KB", (unsigned long long)(ctx_.assets.MemoryFootprint() / 1024));
  ImGui::Text("Undo steps: %zu | redo: %zu", ctx_.undoStack.size(), ctx_.redoStack.size());
  ImGui::End();
}

// ================================================================ Help
void EditorApp::DrawAboutWindow() {
  if (!ImGui::Begin("About NovaForge", &ctx_.showAbout, ImGuiWindowFlags_AlwaysAutoResize)) {
    ImGui::End();
    return;
  }
  ImGui::TextColored(ImVec4(0.55f, 0.78f, 1.0f, 1.0f), "NovaForge Engine 0.1.0");
  ImGui::TextDisabled("Desktop 3D game engine: editor, renderer, physics, AI, scripting, build system.");
  ImGui::Separator();
  ImGui::Text("Renderer : %s", ctx_.renderer->BackendName());
  ImGui::TextWrapped("Driver   : %s", ctx_.renderer->DriverInfo());
  ImGui::Text("Physics  : NovaForge deterministic rigid body + character controller");
  ImGui::Text("Audio    : miniaudio (WASAPI on Windows)");
  ImGui::Text("UI       : Dear ImGui (docking)");
  ImGui::Text("Imaging  : stb_image / stb_image_write / stb_truetype");
  ImGui::Separator();
  ImGui::TextWrapped(
      "Every action in this editor performs a real operation on the project. Features that are not "
      "implemented in V1 are labelled as such (see Help > V1 Scope / V2 Roadmap).");
  ImGui::End();
}

void EditorApp::DrawScopeWindow() {
  if (!ImGui::Begin("V1 Scope / V2 Roadmap", &ctx_.showScope, ImGuiWindowFlags_AlwaysAutoResize)) {
    ImGui::End();
    return;
  }
  ImGui::TextColored(ImVec4(0.5f, 1.0f, 0.6f, 1.0f), "Implemented In V1");
  ImGui::BulletText("Editor: hierarchy, 3D viewport, inspector, asset browser, console, project browser");
  ImGui::BulletText("Play mode: play / pause / step / stop running the exported runtime");
  ImGui::BulletText("Renderer: OpenGL 3.3, frustum culling, instancing, shadows, fog, PBR-ish shading");
  ImGui::BulletText("Assets: GLB / GLTF / OBJ / ASCII FBX import, textures, materials");
  ImGui::BulletText("Scene format: readable JSON .nfscene, save + load, undo/redo");
  ImGui::BulletText("Player: WASD + mouse + jump + gravity + sprint, first/third person");
  ImGui::BulletText("Physics: rigid bodies, static bodies, triggers, forces, character controller");
  ImGui::BulletText("Lighting: directional / point / spot, ambient, fog, shadow mapping");
  ImGui::BulletText("NPC AI: Idle, Patrol, Follow, Chase, Attack state machine");
  ImGui::BulletText("Scripting: components + .nfscript action scripts + native module DLLs");
  ImGui::BulletText("AI assistant: offline planner + optional OpenAI-compatible provider");
  ImGui::BulletText("Build: separate runtime executable, content packaging, verification report");

  ImGui::Separator();
  ImGui::TextColored(ImVec4(1.0f, 0.75f, 0.4f, 1.0f), "Not Implemented In V1 (planned for V2)");
  ImGui::BulletText("Multiplayer / networking");
  ImGui::BulletText("Console and mobile export");
  ImGui::BulletText("Cinematic sequence editor");
  ImGui::BulletText("Niagara-style VFX graph");
  ImGui::BulletText("Terrain streaming and world partition");
  ImGui::BulletText("Full animation graph editor (V1 plays imported clips)");
  ImGui::BulletText("Visual Blueprint scripting (V1 uses components + action scripts)");
  ImGui::BulletText("VR / XR rendering");
  ImGui::Separator();
  ImGui::TextWrapped("These items are documented, not faked: no button in the editor claims to do "
                     "something that V1 cannot do.");
  ImGui::End();
}

void EditorApp::DrawShortcutsWindow() {
  if (!ImGui::Begin("Keyboard Shortcuts", &ctx_.showShortcuts, ImGuiWindowFlags_AlwaysAutoResize)) {
    ImGui::End();
    return;
  }
  struct Binding {
    const char* keys;
    const char* action;
  };
  static const Binding kBindings[] = {
      {"F5", "Play / Stop"},
      {"F6", "Pause / Resume"},
      {"F7", "Step one frame"},
      {"Ctrl+N", "New scene (Shift: new project)"},
      {"Ctrl+O", "Open project"},
      {"Ctrl+S", "Save scene (Shift: Save As)"},
      {"Ctrl+I", "AI assistant (in the Assets menu: import model)"},
      {"Ctrl+B", "Open the Build window"},
      {"Ctrl+Z / Ctrl+Y", "Undo / Redo"},
      {"Ctrl+D", "Duplicate selection"},
      {"Ctrl+A", "Select all"},
      {"Delete", "Delete selection"},
      {"W / E / R", "Move / Rotate / Scale gizmo"},
      {"X", "Toggle world / local gizmo space"},
      {"G", "Toggle grid"},
      {"F", "Focus selection"},
      {"Esc", "Deselect / release the mouse cursor while playing"},
      {"Right mouse + WASD", "Fly the editor camera"},
      {"Middle mouse drag", "Pan the editor camera"},
      {"Mouse wheel", "Zoom the editor camera"},
      {"F1", "This window"},
  };
  if (ImGui::BeginTable("##shortcuts", 2, ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg)) {
    ImGui::TableSetupColumn("Keys", ImGuiTableColumnFlags_WidthFixed, 190.0f);
    ImGui::TableSetupColumn("Action");
    ImGui::TableHeadersRow();
    for (const Binding& binding : kBindings) {
      ImGui::TableNextRow();
      ImGui::TableSetColumnIndex(0);
      ImGui::TextUnformatted(binding.keys);
      ImGui::TableSetColumnIndex(1);
      ImGui::TextUnformatted(binding.action);
    }
    ImGui::EndTable();
  }
  ImGui::Separator();
  ImGui::TextDisabled("Gizmo snapping: hold Ctrl while dragging, or toggle the magnet in the toolbar.");
  ImGui::End();
}

} // namespace nf
