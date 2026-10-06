// NovaForge Engine - core/Json.h
// Small dependency-free JSON reader/writer used by every NovaForge file format
// (project.json, .nfscene, .nfmat, .nfscript, .gltf reading, AI action plans ...).
#pragma once

#include "core/Base.h"
#include "core/Math.h"
#include <map>
#include <variant>

namespace nf {

class JsonValue {
public:
  enum class Type { Null, Bool, Number, String, Array, Object };

  JsonValue() : type_(Type::Null) {}
  JsonValue(bool v) : type_(Type::Bool), bool_(v) {}
  JsonValue(f32 v) : type_(Type::Number), num_(v) {}
  JsonValue(f64 v) : type_(Type::Number), num_(v) {}
  JsonValue(i32 v) : type_(Type::Number), num_((f64)v) {}
  JsonValue(u32 v) : type_(Type::Number), num_((f64)v) {}
  JsonValue(u64 v) : type_(Type::Number), num_((f64)v) {}
  JsonValue(i64 v) : type_(Type::Number), num_((f64)v) {}
  JsonValue(const char* s) : type_(Type::String), str_(s ? s : "") {}
  JsonValue(std::string s) : type_(Type::String), str_(std::move(s)) {}

  static JsonValue Array() { JsonValue v; v.type_ = Type::Array; return v; }
  static JsonValue Object() { JsonValue v; v.type_ = Type::Object; return v; }
  static JsonValue Vec3Json(const Vec3& v);
  static JsonValue Vec4Json(const Vec4& v);

  Type GetType() const { return type_; }
  bool IsNull() const { return type_ == Type::Null; }
  bool IsBool() const { return type_ == Type::Bool; }
  bool IsNumber() const { return type_ == Type::Number; }
  bool IsString() const { return type_ == Type::String; }
  bool IsArray() const { return type_ == Type::Array; }
  bool IsObject() const { return type_ == Type::Object; }

  // ---- typed accessors with defaults (never throw)
  bool AsBool(bool def = false) const { return type_ == Type::Bool ? bool_ : def; }
  f64 AsNumber(f64 def = 0) const { return type_ == Type::Number ? num_ : def; }
  f32 AsFloat(f32 def = 0) const { return type_ == Type::Number ? (f32)num_ : def; }
  i32 AsInt(i32 def = 0) const { return type_ == Type::Number ? (i32)num_ : def; }
  u32 AsUInt(u32 def = 0) const { return type_ == Type::Number ? (u32)num_ : def; }
  u64 AsUInt64(u64 def = 0) const { return type_ == Type::Number ? (u64)num_ : def; }
  std::string AsString(const std::string& def = "") const {
    return type_ == Type::String ? str_ : def;
  }
  Vec3 AsVec3(const Vec3& def = Vec3(0, 0, 0)) const;
  Vec4 AsVec4(const Vec4& def = Vec4(0, 0, 0, 1)) const;
  Quat AsQuat(const Quat& def = Quat(0, 0, 0, 1)) const;

  // ---- arrays
  usize Size() const {
    if (type_ == Type::Array) return arr_.size();
    if (type_ == Type::Object) return obj_.size();
    return 0;
  }
  const JsonValue& operator[](usize index) const {
    static const JsonValue null;
    if (type_ != Type::Array || index >= arr_.size()) return null;
    return arr_[index];
  }
  JsonValue& operator[](usize index) {
    if (type_ != Type::Array) {
      type_ = Type::Array;
      arr_.clear();
    }
    if (index >= arr_.size()) arr_.resize(index + 1);
    return arr_[index];
  }
  void Push(JsonValue v) {
    if (type_ != Type::Array) { type_ = Type::Array; arr_.clear(); }
    arr_.push_back(std::move(v));
  }

  // ---- objects (insertion ordered for readable files)
  const JsonValue& operator[](const std::string& key) const {
    static const JsonValue null;
    auto it = objIndex_.find(key);
    if (it == objIndex_.end()) return null;
    return obj_[it->second].second;
  }
  JsonValue& operator[](const char* key) { return (*this)[std::string(key ? key : "")]; }
  JsonValue& operator[](const std::string& key) {
    auto it = objIndex_.find(key);
    if (it == objIndex_.end()) {
      type_ = Type::Object;
      objIndex_[key] = obj_.size();
      obj_.emplace_back(key, JsonValue());
      return obj_.back().second;
    }
    return obj_[it->second].second;
  }
  bool Has(const std::string& key) const { return objIndex_.count(key) > 0; }
  void Remove(const std::string& key);
  const std::vector<std::pair<std::string, JsonValue>>& Members() const { return obj_; }
  void Set(const std::string& key, JsonValue v) { (*this)[key] = std::move(v); }

  std::vector<std::string> Keys() const {
    std::vector<std::string> k;
    k.reserve(obj_.size());
    for (auto& p : obj_) k.push_back(p.first);
    return k;
  }

  // ---- serialisation
  std::string Dump(int indent = 2) const;
  static JsonValue Parse(const std::string& text, std::string* outError = nullptr);
  static bool ParseFile(const std::string& path, JsonValue* out, std::string* outError = nullptr);
  bool WriteFile(const std::string& path, int indent = 2) const;

private:
  void DumpTo(std::string& out, int indent, int depth) const;

  Type type_ = Type::Null;
  bool bool_ = false;
  f64 num_ = 0;
  std::string str_;
  std::vector<JsonValue> arr_;
  std::vector<std::pair<std::string, JsonValue>> obj_;
  std::map<std::string, usize> objIndex_;
};

} // namespace nf
