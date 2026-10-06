// NovaForge Engine - core/FileSystem.h
// UTF-8 path helpers + file IO. All public APIs take UTF-8 std::string paths.
#pragma once

#include "core/Base.h"

namespace nf {

struct FileInfo {
  std::string path;       // relative (as requested) UTF-8 path
  std::string name;
  std::string extension;  // lower-case, without dot
  u64 size = 0;
  bool isDirectory = false;
  i64 modifiedTime = 0;
};

class fs {
public:
  // ---- path helpers
  static std::string Join(const std::string& a, const std::string& b);
  static std::string Normalize(const std::string& path);
  static std::string Absolute(const std::string& path);
  static std::string Parent(const std::string& path);
  static std::string FileName(const std::string& path);
  static std::string Stem(const std::string& path);
  static std::string Extension(const std::string& path);        // lower-case, no dot
  static std::string ReplaceExtension(const std::string& path, const std::string& newExt);
  static bool IsAbsolute(const std::string& path);
  static std::string Relative(const std::string& path, const std::string& base);
  static const char* Sep();

  // ---- queries
  static bool Exists(const std::string& path);
  static bool IsDirectory(const std::string& path);
  static bool IsFile(const std::string& path);
  static u64 FileSize(const std::string& path);
  static i64 ModifiedTime(const std::string& path);

  // ---- mutations
  static bool CreateDirectories(const std::string& path);
  static bool WriteText(const std::string& path, const std::string& text);
  static bool WriteBinary(const std::string& path, const void* data, usize size);
  static bool ReadText(const std::string& path, std::string* out, std::string* outError = nullptr);
  static std::vector<u8> ReadBinary(const std::string& path, std::string* outError = nullptr);
  static bool Copy(const std::string& from, const std::string& to);
  static bool CopyRecursive(const std::string& from, const std::string& to);
  static bool Remove(const std::string& path);
  static bool RemoveRecursive(const std::string& path);
  static bool Rename(const std::string& from, const std::string& to);

  // ---- enumeration
  static std::vector<FileInfo> ListDirectory(const std::string& path, bool recursive = false);
  static std::vector<std::string> ListFilesWithExtension(const std::string& path,
                                                         const std::string& ext,
                                                         bool recursive = false);

  static std::string CurrentWorkingDirectory();
  static std::string ExecutablePath();
  static std::string ExecutableDirectory();
  static std::string TempDirectory();
};

} // namespace nf
