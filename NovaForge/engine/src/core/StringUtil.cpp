// NovaForge Engine - core/StringUtil.cpp
#include "core/StringUtil.h"

#include <cstdarg>

namespace nf {

std::vector<std::string> SplitString(const std::string& s, char delim) {
  std::vector<std::string> out;
  std::string cur;
  for (char c : s) {
    if (c == delim) { out.push_back(cur); cur.clear(); }
    else cur.push_back(c);
  }
  out.push_back(cur);
  return out;
}

std::vector<std::string> SplitString(const std::string& s, const std::string& delim) {
  std::vector<std::string> out;
  if (delim.empty()) { out.push_back(s); return out; }
  usize pos = 0;
  while (true) {
    usize next = s.find(delim, pos);
    if (next == std::string::npos) { out.push_back(s.substr(pos)); break; }
    out.push_back(s.substr(pos, next - pos));
    pos = next + delim.size();
  }
  return out;
}

std::string JoinStrings(const std::vector<std::string>& parts, const std::string& sep) {
  std::string out;
  for (usize i = 0; i < parts.size(); i++) {
    if (i) out += sep;
    out += parts[i];
  }
  return out;
}

std::string Trim(const std::string& s) {
  usize b = 0, e = s.size();
  while (b < e && (unsigned char)s[b] <= ' ') b++;
  while (e > b && (unsigned char)s[e - 1] <= ' ') e--;
  return s.substr(b, e - b);
}

std::string ToLower(const std::string& s) {
  std::string out = s;
  for (auto& c : out) c = (char)std::tolower((unsigned char)c);
  return out;
}

std::string ToUpper(const std::string& s) {
  std::string out = s;
  for (auto& c : out) c = (char)std::toupper((unsigned char)c);
  return out;
}

bool StartsWith(const std::string& s, const std::string& prefix) {
  return s.size() >= prefix.size() && s.compare(0, prefix.size(), prefix) == 0;
}

bool EndsWith(const std::string& s, const std::string& suffix) {
  return s.size() >= suffix.size() &&
         s.compare(s.size() - suffix.size(), suffix.size(), suffix) == 0;
}

bool ContainsInsensitive(const std::string& haystack, const std::string& needle) {
  if (needle.empty()) return true;
  auto h = ToLower(haystack);
  auto n = ToLower(needle);
  return h.find(n) != std::string::npos;
}

std::string ReplaceAll(std::string s, const std::string& from, const std::string& to) {
  if (from.empty()) return s;
  usize pos = 0;
  while ((pos = s.find(from, pos)) != std::string::npos) {
    s.replace(pos, from.size(), to);
    pos += to.size();
  }
  return s;
}

std::string Format(const char* fmt, ...) {
  char buffer[1024];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);
  return buffer;
}

std::string ToDisplayName(const std::string& identifier) {
  std::string out;
  for (usize i = 0; i < identifier.size(); i++) {
    char c = identifier[i];
    if (c == '_') { out.push_back(' '); continue; }
    if (i > 0 && std::isupper((unsigned char)c) && !out.empty() && out.back() != ' ' &&
        !std::isupper((unsigned char)identifier[i - 1]))
      out.push_back(' ');
    out.push_back(c);
  }
  return out;
}

std::string SanitizeIdentifier(const std::string& name) {
  std::string out;
  bool upperNext = true;
  for (char c : name) {
    if (std::isalnum((unsigned char)c)) {
      out.push_back(upperNext ? (char)std::toupper((unsigned char)c) : c);
      upperNext = false;
    } else {
      upperNext = true;
    }
  }
  if (out.empty() || std::isdigit((unsigned char)out[0])) out = "Item" + out;
  return out;
}

std::string Pluralize(int count, const std::string& singular, const std::string& plural) {
  if (count == 1) return std::to_string(count) + " " + singular;
  return std::to_string(count) + " " + (plural.empty() ? singular + "s" : plural);
}

} // namespace nf
