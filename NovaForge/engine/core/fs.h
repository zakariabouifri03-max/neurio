// NovaForge Engine - filesystem helpers (thin, portable wrapper)
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace nf {
namespace fs {

using Bytes = std::vector<uint8_t>;

bool exists(const std::string& path);
bool isDirectory(const std::string& path);
bool isFile(const std::string& path);
int64_t fileSize(const std::string& path);
int64_t modifiedTime(const std::string& path);  // unix seconds, 0 if missing

std::string readText(const std::string& path);
Bytes readBinary(const std::string& path);
bool writeText(const std::string& path, const std::string& data);
bool writeBinary(const std::string& path, const Bytes& data);
bool writeBinary(const std::string& path, const void* data, size_t size);
bool appendText(const std::string& path, const std::string& data);

// base64 (used by glTF data URIs, the AI assistant file payloads and tests)
std::string base64Encode(const uint8_t* data, size_t size);
std::string base64Encode(const Bytes& data);
Bytes base64Decode(const std::string& text);

bool createDirectories(const std::string& path);
bool copyFile(const std::string& from, const std::string& to);
bool copyTree(const std::string& from, const std::string& to);
bool removeFile(const std::string& path);
bool removeTree(const std::string& path);
bool rename(const std::string& from, const std::string& to);

struct DirEntry {
    std::string name;      // file name only
    std::string path;      // full path
    bool directory = false;
    int64_t size = 0;
};
std::vector<DirEntry> listDirectory(const std::string& path, bool recursive = false);
std::vector<DirEntry> listDirectoryExt(const std::string& path,
                                       const std::vector<std::string>& extensions,
                                       bool recursive = true);

// path string helpers (purely textual, work with / and \)
std::string join(const std::string& a, const std::string& b);
std::string normalize(const std::string& path);          // uses '/' separators
std::string parent(const std::string& path);
std::string filename(const std::string& path);
std::string stem(const std::string& path);
std::string extension(const std::string& path);          // lowercase, no dot
std::string absolute(const std::string& path);
std::string relativeTo(const std::string& path, const std::string& base);
bool isAbsolute(const std::string& path);

std::string executablePath();
std::string executableDir();
std::string currentDir();
std::string homeDir();
std::string tempDir();

// Search helper used by the runtime: resolves "Assets/x.glb" against the
// executable dir, cwd and finally a "Content/" folder next to the exe.
std::string resolveAssetPath(const std::string& relative);

}  // namespace fs
}  // namespace nf
