// NovaForge Engine - core/FileSystem.cpp
#include "core/FileSystem.h"
#include "core/Log.h"

#include <filesystem>
#include <fstream>
#include <sstream>

#if NF_PLATFORM_WINDOWS
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
#endif

namespace fs_std = std::filesystem;

namespace nf {

static fs_std::path ToPath(const std::string& utf8) {
#if defined(__cpp_lib_char8_t) && NF_PLATFORM_WINDOWS
  return fs_std::path(std::u8string(utf8.begin(), utf8.end()));
#else
  return fs_std::path(utf8);
#endif
}

static std::string FromPath(const fs_std::path& p) {
#if defined(__cpp_lib_char8_t) && NF_PLATFORM_WINDOWS
  auto u8 = p.u8string();
  return std::string(u8.begin(), u8.end());
#else
  return p.string();
#endif
}

std::string fs::Join(const std::string& a, const std::string& b) {
  if (a.empty()) return b;
  if (b.empty()) return a;
  if (IsAbsolute(b)) return b;
  char last = a.back();
  if (last == '/' || last == '\\') return a + b;
  return a + Sep() + b;
}

std::string fs::Normalize(const std::string& path) {
  if (path.empty()) return path;
  fs_std::path p = ToPath(path);
  return FromPath(p.lexically_normal());
}

std::string fs::Absolute(const std::string& path) {
  if (path.empty()) return path;
  std::error_code ec;
  auto p = fs_std::absolute(ToPath(path), ec);
  if (ec) return Normalize(path);
  return FromPath(p.lexically_normal());
}

std::string fs::Parent(const std::string& path) {
  fs_std::path p = ToPath(Normalize(path));
  return FromPath(p.parent_path());
}

std::string fs::FileName(const std::string& path) {
  fs_std::path p = ToPath(Normalize(path));
  return FromPath(p.filename());
}

std::string fs::Stem(const std::string& path) {
  fs_std::path p = ToPath(FileName(path));
  return FromPath(p.stem());
}

static std::string Lower(std::string s) {
  for (auto& c : s) c = (char)std::tolower((unsigned char)c);
  return s;
}

std::string fs::Extension(const std::string& path) {
  auto e = ToPath(FileName(path)).extension();
  std::string s = FromPath(e);
  if (!s.empty() && s[0] == '.') s.erase(s.begin());
  return Lower(s);
}

std::string fs::ReplaceExtension(const std::string& path, const std::string& newExt) {
  std::string base = path;
  auto dot = base.find_last_of('.');
  auto slash = base.find_last_of("/\\");
  if (dot != std::string::npos && (slash == std::string::npos || dot > slash)) base = base.substr(0, dot);
  return base + "." + newExt;
}

bool fs::IsAbsolute(const std::string& path) {
  return ToPath(path).is_absolute();
}

std::string fs::Relative(const std::string& path, const std::string& base) {
  std::error_code ec;
  auto rel = fs_std::relative(ToPath(path), ToPath(base), ec);
  if (ec) return path;
  std::string s = FromPath(rel);
  for (auto& c : s) if (c == '\\') c = '/';
  return s;
}

const char* fs::Sep() {
#if NF_PLATFORM_WINDOWS
  return "\\";
#else
  return "/";
#endif
}

bool fs::Exists(const std::string& path) {
  std::error_code ec;
  return fs_std::exists(ToPath(path), ec);
}
bool fs::IsDirectory(const std::string& path) {
  std::error_code ec;
  return fs_std::is_directory(ToPath(path), ec);
}
bool fs::IsFile(const std::string& path) {
  std::error_code ec;
  return fs_std::is_regular_file(ToPath(path), ec);
}
u64 fs::FileSize(const std::string& path) {
  std::error_code ec;
  auto s = fs_std::file_size(ToPath(path), ec);
  return ec ? 0 : (u64)s;
}
i64 fs::ModifiedTime(const std::string& path) {
  std::error_code ec;
  auto t = fs_std::last_write_time(ToPath(path), ec);
  if (ec) return 0;
  return (i64)t.time_since_epoch().count();
}

bool fs::CreateDirectories(const std::string& path) {
  std::error_code ec;
  fs_std::create_directories(ToPath(path), ec);
  return !ec;
}

bool fs::WriteText(const std::string& path, const std::string& text) {
  std::string parent = Parent(path);
  if (!parent.empty() && !Exists(parent)) CreateDirectories(parent);
  std::ofstream out(ToPath(path), std::ios::binary | std::ios::trunc);
  if (!out) {
    NF_ERROR(LogCategory::Core, "Failed to open file for writing: %s", path.c_str());
    return false;
  }
  out.write(text.data(), (std::streamsize)text.size());
  return out.good();
}

bool fs::WriteBinary(const std::string& path, const void* data, usize size) {
  std::string parent = Parent(path);
  if (!parent.empty() && !Exists(parent)) CreateDirectories(parent);
  std::ofstream out(ToPath(path), std::ios::binary | std::ios::trunc);
  if (!out) return false;
  out.write((const char*)data, (std::streamsize)size);
  return out.good();
}

bool fs::ReadText(const std::string& path, std::string* out, std::string* outError) {
  std::ifstream in(ToPath(path), std::ios::binary);
  if (!in) {
    if (outError) *outError = "file not found or unreadable: " + path;
    return false;
  }
  std::ostringstream ss;
  ss << in.rdbuf();
  *out = ss.str();
  return true;
}

std::vector<u8> fs::ReadBinary(const std::string& path, std::string* outError) {
  std::vector<u8> data;
  std::ifstream in(ToPath(path), std::ios::binary | std::ios::ate);
  if (!in) {
    if (outError) *outError = "file not found or unreadable: " + path;
    return data;
  }
  std::streamsize size = in.tellg();
  in.seekg(0, std::ios::beg);
  data.resize((usize)size);
  if (size > 0 && !in.read((char*)data.data(), size)) {
    if (outError) *outError = "read error: " + path;
    data.clear();
  }
  return data;
}

bool fs::Copy(const std::string& from, const std::string& to) {
  std::error_code ec;
  std::string parent = Parent(to);
  if (!parent.empty() && !Exists(parent)) CreateDirectories(parent);
  fs_std::copy_file(ToPath(from), ToPath(to), fs_std::copy_options::overwrite_existing, ec);
  return !ec;
}

bool fs::CopyRecursive(const std::string& from, const std::string& to) {
  if (!Exists(from)) return false;
  std::error_code ec;
  fs_std::copy(ToPath(from), ToPath(to),
               fs_std::copy_options::recursive | fs_std::copy_options::overwrite_existing, ec);
  return !ec;
}

bool fs::Remove(const std::string& path) {
  std::error_code ec;
  return fs_std::remove(ToPath(path), ec);
}

bool fs::RemoveRecursive(const std::string& path) {
  std::error_code ec;
  if (!Exists(path)) return true;
  return fs_std::remove_all(ToPath(path), ec) > 0;
}

bool fs::Rename(const std::string& from, const std::string& to) {
  std::error_code ec;
  fs_std::rename(ToPath(from), ToPath(to), ec);
  if (ec) {
    // fall back to copy+delete across volumes
    if (CopyRecursive(from, to)) { RemoveRecursive(from); return true; }
    return false;
  }
  return true;
}

std::vector<FileInfo> fs::ListDirectory(const std::string& path, bool recursive) {
  std::vector<FileInfo> out;
  std::error_code ec;
  if (!fs_std::exists(ToPath(path), ec)) return out;
  auto make = [&](const fs_std::directory_entry& e) {
    FileInfo fi;
    fi.path = FromPath(e.path());
    for (auto& c : fi.path) if (c == '\\') c = '/';
    fi.name = FromPath(e.path().filename());
    fi.isDirectory = e.is_directory(ec);
    fi.extension = fi.isDirectory ? "" : Extension(fi.name);
    if (!fi.isDirectory) fi.size = e.file_size(ec);
    auto t = e.last_write_time(ec);
    fi.modifiedTime = ec ? 0 : (i64)t.time_since_epoch().count();
    out.push_back(fi);
  };
  if (recursive) {
    for (auto it = fs_std::recursive_directory_iterator(ToPath(path), ec);
         it != fs_std::recursive_directory_iterator(); it.increment(ec)) {
      if (ec) { ec.clear(); break; }
      make(*it);
    }
  } else {
    for (auto it = fs_std::directory_iterator(ToPath(path), ec);
         it != fs_std::directory_iterator(); it.increment(ec)) {
      if (ec) { ec.clear(); break; }
      make(*it);
    }
  }
  std::sort(out.begin(), out.end(), [](const FileInfo& a, const FileInfo& b) {
    if (a.isDirectory != b.isDirectory) return a.isDirectory;
    return Lower(a.name) < Lower(b.name);
  });
  return out;
}

std::vector<std::string> fs::ListFilesWithExtension(const std::string& path,
                                                    const std::string& ext, bool recursive) {
  std::vector<std::string> out;
  for (auto& fi : ListDirectory(path, recursive))
    if (!fi.isDirectory && fi.extension == Lower(ext)) out.push_back(fi.path);
  return out;
}

std::string fs::CurrentWorkingDirectory() {
  std::error_code ec;
  auto p = fs_std::current_path(ec);
  return ec ? "." : FromPath(p);
}

std::string fs::ExecutablePath() {
#if NF_PLATFORM_WINDOWS
  wchar_t buf[4096];
  DWORD n = GetModuleFileNameW(nullptr, buf, 4096);
  if (n > 0 && n < 4096) {
    std::wstring w(buf, n);
    std::string out(w.begin(), w.end());
    return out;
  }
#endif
  std::error_code ec;
  auto p = fs_std::read_symlink("/proc/self/exe", ec);
  if (!ec) return FromPath(p);
  return Absolute(".");
}

std::string fs::ExecutableDirectory() { return Parent(ExecutablePath()); }

std::string fs::TempDirectory() {
  std::error_code ec;
  auto p = fs_std::temp_directory_path(ec);
  return ec ? "." : FromPath(p);
}

} // namespace nf
