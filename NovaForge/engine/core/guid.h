// NovaForge Engine - GUID / unique id generation
#pragma once
#include <cstdint>
#include <string>

namespace nf {

// 128 bit id rendered as 32 hex chars, e.g. "3f7c1a9e5b2d4f1e8c6a0b3d7e9f2a4c"
std::string generateGuid();
// Short stable id from a string (used for deterministic ids in tests/prefabs)
uint64_t hashString(const char* s, size_t len);
inline uint64_t hashString(const std::string& s) { return hashString(s.data(), s.size()); }

}  // namespace nf
