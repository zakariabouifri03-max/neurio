// NovaForge Engine - core/StringUtil.h
#pragma once

#include "core/Base.h"

namespace nf {

std::vector<std::string> SplitString(const std::string& s, char delim);
std::vector<std::string> SplitString(const std::string& s, const std::string& delim);
std::string JoinStrings(const std::vector<std::string>& parts, const std::string& sep);
std::string Trim(const std::string& s);
std::string ToLower(const std::string& s);
std::string ToUpper(const std::string& s);
bool StartsWith(const std::string& s, const std::string& prefix);
bool EndsWith(const std::string& s, const std::string& suffix);
bool ContainsInsensitive(const std::string& haystack, const std::string& needle);
std::string ReplaceAll(std::string s, const std::string& from, const std::string& to);
std::string Format(const char* fmt, ...);
std::string ToDisplayName(const std::string& identifier);   // "PlayerController" -> "Player Controller"
std::string SanitizeIdentifier(const std::string& name);    // spaces/punct -> PascalCase identifier
std::string Pluralize(int count, const std::string& singular, const std::string& plural = "");

} // namespace nf
