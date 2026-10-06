// NovaForge Engine - core/Json.cpp
#include "core/Json.h"
#include "core/Math.h"
#include "core/FileSystem.h"
#include "core/Log.h"

#include <cstdlib>

namespace nf {

// ------------------------------------------------------------------ Vec helpers
JsonValue JsonValue::Vec3Json(const Vec3& v) {
  JsonValue a = JsonValue::Array();
  a.Push(v.x); a.Push(v.y); a.Push(v.z);
  return a;
}
JsonValue JsonValue::Vec4Json(const Vec4& v) {
  JsonValue a = JsonValue::Array();
  a.Push(v.x); a.Push(v.y); a.Push(v.z); a.Push(v.w);
  return a;
}
Vec3 JsonValue::AsVec3(const Vec3& def) const {
  if (type_ == Type::Array && arr_.size() >= 3)
    return {arr_[0].AsFloat(def.x), arr_[1].AsFloat(def.y), arr_[2].AsFloat(def.z)};
  return def;
}
Vec4 JsonValue::AsVec4(const Vec4& def) const {
  if (type_ == Type::Array && arr_.size() >= 4)
    return {arr_[0].AsFloat(def.x), arr_[1].AsFloat(def.y), arr_[2].AsFloat(def.z), arr_[3].AsFloat(def.w)};
  if (type_ == Type::Array && arr_.size() == 3)
    return {arr_[0].AsFloat(), arr_[1].AsFloat(), arr_[2].AsFloat(), def.w};
  return def;
}
Quat JsonValue::AsQuat(const Quat& def) const {
  if (type_ == Type::Array && arr_.size() >= 4)
    return {arr_[0].AsFloat(), arr_[1].AsFloat(), arr_[2].AsFloat(), arr_[3].AsFloat()};
  return def;
}

void JsonValue::Remove(const std::string& key) {
  auto it = objIndex_.find(key);
  if (it == objIndex_.end()) return;
  usize idx = it->second;
  obj_.erase(obj_.begin() + (i64)idx);
  objIndex_.clear();
  for (usize i = 0; i < obj_.size(); i++) objIndex_[obj_[i].first] = i;
}

// ------------------------------------------------------------------ parser
namespace {

struct Parser {
  const char* p;
  const char* end;
  std::string error;
  int line = 1;
  int depth = 0;

  bool fail(const std::string& msg) {
    if (error.empty()) {
      char buf[256];
      snprintf(buf, sizeof(buf), "%s (line %d)", msg.c_str(), line);
      error = buf;
    }
    return false;
  }
  void skipWs() {
    while (p < end) {
      char c = *p;
      if (c == '\n') { line++; p++; }
      else if (c == ' ' || c == '\t' || c == '\r') p++;
      else if (c == '/' && p + 1 < end && p[1] == '/') {   // allow comments (handy for hand-edited scenes)
        while (p < end && *p != '\n') p++;
      } else break;
    }
  }
  bool parseValue(JsonValue* out) {
    if (++depth > 200) return fail("nesting too deep");
    skipWs();
    if (p >= end) return fail("unexpected end of input");
    char c = *p;
    bool ok = false;
    if (c == '{') ok = parseObject(out);
    else if (c == '[') ok = parseArray(out);
    else if (c == '"') { std::string s; ok = parseString(&s); if (ok) *out = JsonValue(s); }
    else if (c == 't' || c == 'f') ok = parseBool(out);
    else if (c == 'n') ok = parseNull(out);
    else ok = parseNumber(out);
    depth--;
    return ok;
  }
  bool parseObject(JsonValue* out) {
    *out = JsonValue::Object();
    p++;  // {
    skipWs();
    if (p < end && *p == '}') { p++; return true; }
    while (p < end) {
      skipWs();
      if (p >= end || *p != '"') return fail("expected object key string");
      std::string key;
      if (!parseString(&key)) return false;
      skipWs();
      if (p >= end || *p != ':') return fail("expected ':' after object key");
      p++;
      JsonValue v;
      if (!parseValue(&v)) return false;
      (*out)[key] = std::move(v);
      skipWs();
      if (p < end && *p == ',') { p++; continue; }
      if (p < end && *p == '}') { p++; return true; }
      return fail("expected ',' or '}' in object");
    }
    return fail("unterminated object");
  }
  bool parseArray(JsonValue* out) {
    *out = JsonValue::Array();
    p++;  // [
    skipWs();
    if (p < end && *p == ']') { p++; return true; }
    while (p < end) {
      JsonValue v;
      if (!parseValue(&v)) return false;
      out->Push(std::move(v));
      skipWs();
      if (p < end && *p == ',') { p++; continue; }
      if (p < end && *p == ']') { p++; return true; }
      return fail("expected ',' or ']' in array");
    }
    return fail("unterminated array");
  }
  bool parseString(std::string* out) {
    p++;  // opening quote
    out->clear();
    while (p < end) {
      char c = *p++;
      if (c == '"') return true;
      if (c == '\\') {
        if (p >= end) return fail("unterminated escape");
        char e = *p++;
        switch (e) {
          case '"': out->push_back('"'); break;
          case '\\': out->push_back('\\'); break;
          case '/': out->push_back('/'); break;
          case 'b': out->push_back('\b'); break;
          case 'f': out->push_back('\f'); break;
          case 'n': out->push_back('\n'); break;
          case 'r': out->push_back('\r'); break;
          case 't': out->push_back('\t'); break;
          case 'u': {
            if (p + 4 > end) return fail("bad \\u escape");
            unsigned code = 0;
            for (int i = 0; i < 4; i++) {
              char h = *p++;
              code <<= 4;
              if (h >= '0' && h <= '9') code |= (unsigned)(h - '0');
              else if (h >= 'a' && h <= 'f') code |= (unsigned)(h - 'a' + 10);
              else if (h >= 'A' && h <= 'F') code |= (unsigned)(h - 'A' + 10);
              else return fail("bad hex digit in \\u escape");
            }
            // encode as UTF-8 (BMP only; surrogate pairs are merged when present)
            if (code >= 0xD800 && code <= 0xDBFF && p + 6 <= end && p[0] == '\\' && p[1] == 'u') {
              p += 2;
              unsigned low = 0;
              for (int i = 0; i < 4; i++) {
                char h = *p++;
                low <<= 4;
                if (h >= '0' && h <= '9') low |= (unsigned)(h - '0');
                else if (h >= 'a' && h <= 'f') low |= (unsigned)(h - 'a' + 10);
                else if (h >= 'A' && h <= 'F') low |= (unsigned)(h - 'A' + 10);
              }
              code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
            }
            if (code < 0x80) out->push_back((char)code);
            else if (code < 0x800) {
              out->push_back((char)(0xC0 | (code >> 6)));
              out->push_back((char)(0x80 | (code & 0x3F)));
            } else if (code < 0x10000) {
              out->push_back((char)(0xE0 | (code >> 12)));
              out->push_back((char)(0x80 | ((code >> 6) & 0x3F)));
              out->push_back((char)(0x80 | (code & 0x3F)));
            } else {
              out->push_back((char)(0xF0 | (code >> 18)));
              out->push_back((char)(0x80 | ((code >> 12) & 0x3F)));
              out->push_back((char)(0x80 | ((code >> 6) & 0x3F)));
              out->push_back((char)(0x80 | (code & 0x3F)));
            }
            break;
          }
          default: return fail("invalid escape sequence");
        }
      } else {
        if (c == '\n') return fail("newline inside string");
        out->push_back(c);
      }
    }
    return fail("unterminated string");
  }
  bool parseNumber(JsonValue* out) {
    const char* start = p;
    if (p < end && (*p == '-' || *p == '+')) p++;
    while (p < end && ((*p >= '0' && *p <= '9') || *p == '.' || *p == 'e' || *p == 'E' ||
                       ((*p == '-' || *p == '+') && (p[-1] == 'e' || p[-1] == 'E')))) p++;
    if (p == start) return fail("invalid value");
    std::string num(start, p - start);
    *out = JsonValue(std::strtod(num.c_str(), nullptr));
    return true;
  }
  bool parseBool(JsonValue* out) {
    if (end - p >= 4 && strncmp(p, "true", 4) == 0) { p += 4; *out = JsonValue(true); return true; }
    if (end - p >= 5 && strncmp(p, "false", 5) == 0) { p += 5; *out = JsonValue(false); return true; }
    return fail("invalid literal");
  }
  bool parseNull(JsonValue* out) {
    if (end - p >= 4 && strncmp(p, "null", 4) == 0) { p += 4; *out = JsonValue(); return true; }
    return fail("invalid literal");
  }
};

} // namespace

JsonValue JsonValue::Parse(const std::string& text, std::string* outError) {
  if (outError) outError->clear();
  Parser parser{text.data(), text.data() + text.size()};
  JsonValue root;
  if (!parser.parseValue(&root)) {
    if (outError) *outError = parser.error;
    return JsonValue();
  }
  parser.skipWs();
  if (parser.p != parser.end) {
    if (outError) *outError = "trailing data after JSON value";
    NF_WARN(LogCategory::Core, "JSON parse warning: trailing data");
  }
  return root;
}

bool JsonValue::ParseFile(const std::string& path, JsonValue* out, std::string* outError) {
  std::string text, err;
  if (!fs::ReadText(path, &text, &err)) {
    if (outError) *outError = err;
    return false;
  }
  std::string parseError;
  JsonValue v = Parse(text, &parseError);
  if (!parseError.empty()) {
    if (outError) *outError = parseError + " in " + path;
    return false;
  }
  *out = std::move(v);
  return true;
}

// ------------------------------------------------------------------ writer
static void EscapeTo(std::string& out, const std::string& s) {
  out.push_back('"');
  for (char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      default:
        if ((unsigned char)c < 0x20) {
          char buf[8];
          snprintf(buf, sizeof(buf), "\\u%04x", (unsigned)c);
          out += buf;
        } else out.push_back(c);
    }
  }
  out.push_back('"');
}

static void NumberTo(std::string& out, f64 v) {
  if (v == (i64)v && Abs((f32)v) < 1e15f) {
    char buf[32];
    snprintf(buf, sizeof(buf), "%lld", (long long)v);
    out += buf;
  } else {
    char buf[64];
    snprintf(buf, sizeof(buf), "%.9g", v);
    out += buf;
  }
}

void JsonValue::DumpTo(std::string& out, int indent, int depth) const {
  const bool pretty = indent > 0;
  std::string pad = pretty ? std::string((usize)(indent * (depth + 1)), ' ') : "";
  std::string padEnd = pretty ? std::string((usize)(indent * depth), ' ') : "";
  switch (type_) {
    case Type::Null: out += "null"; break;
    case Type::Bool: out += bool_ ? "true" : "false"; break;
    case Type::Number: NumberTo(out, num_); break;
    case Type::String: EscapeTo(out, str_); break;
    case Type::Array: {
      if (arr_.empty()) { out += "[]"; break; }
      // compact arrays of numbers (vectors) for readability
      bool allScalar = true;
      for (auto& v : arr_) if (v.type_ == Type::Array || v.type_ == Type::Object) { allScalar = false; break; }
      if (allScalar && arr_.size() <= 8) {
        out += "[";
        for (usize i = 0; i < arr_.size(); i++) {
          if (i) out += ", ";
          arr_[i].DumpTo(out, 0, depth);
        }
        out += "]";
        break;
      }
      out += "[\n";
      for (usize i = 0; i < arr_.size(); i++) {
        out += pad;
        arr_[i].DumpTo(out, indent, depth + 1);
        if (i + 1 < arr_.size()) out += ",";
        out += "\n";
      }
      out += padEnd + "]";
      break;
    }
    case Type::Object: {
      if (obj_.empty()) { out += "{}"; break; }
      out += "{\n";
      for (usize i = 0; i < obj_.size(); i++) {
        out += pad;
        EscapeTo(out, obj_[i].first);
        out += pretty ? ": " : ":";
        obj_[i].second.DumpTo(out, indent, depth + 1);
        if (i + 1 < obj_.size()) out += ",";
        out += "\n";
      }
      out += padEnd + "}";
      break;
    }
  }
}

std::string JsonValue::Dump(int indent) const {
  std::string out;
  out.reserve(512);
  DumpTo(out, indent, 0);
  if (indent > 0) out += "\n";
  return out;
}

bool JsonValue::WriteFile(const std::string& path, int indent) const {
  return fs::WriteText(path, Dump(indent));
}

} // namespace nf
