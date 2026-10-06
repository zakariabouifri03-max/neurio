#include "core/fs.h"
#include "core/log.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#else
#include <unistd.h>
#endif

namespace stdfs = std::filesystem;

namespace nf {
namespace fs {

static std::string lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return (char)std::tolower(c); });
    return s;
}

bool exists(const std::string& p) {
    std::error_code ec;
    return stdfs::exists(p, ec);
}
bool isDirectory(const std::string& p) {
    std::error_code ec;
    return stdfs::is_directory(p, ec);
}
bool isFile(const std::string& p) {
    std::error_code ec;
    return stdfs::is_regular_file(p, ec);
}
int64_t fileSize(const std::string& p) {
    std::error_code ec;
    auto s = stdfs::file_size(p, ec);
    return ec ? 0 : (int64_t)s;
}
int64_t modifiedTime(const std::string& p) {
    std::error_code ec;
    auto t = stdfs::last_write_time(p, ec);
    if (ec) return 0;
    return (int64_t)std::chrono::duration_cast<std::chrono::seconds>(
               t.time_since_epoch()).count();
}

std::string readText(const std::string& p) {
    std::ifstream f(p, std::ios::binary);
    if (!f) return {};
    std::string s((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    return s;
}

Bytes readBinary(const std::string& p) {
    std::ifstream f(p, std::ios::binary | std::ios::ate);
    if (!f) return {};
    std::streamsize n = f.tellg();
    f.seekg(0);
    Bytes b((size_t)std::max<std::streamsize>(n, 0));
    if (n > 0) f.read((char*)b.data(), n);
    return b;
}

bool writeText(const std::string& p, const std::string& data) {
    std::string dir = parent(p);
    if (!dir.empty() && !exists(dir)) createDirectories(dir);
    std::ofstream f(p, std::ios::binary | std::ios::trunc);
    if (!f) {
        NF_LOG_ERROR("FS", "cannot write file '%s' (permission or missing directory)", p.c_str());
        return false;
    }
    f.write(data.data(), (std::streamsize)data.size());
    return f.good();
}

bool writeBinary(const std::string& p, const Bytes& data) {
    return writeBinary(p, data.data(), data.size());
}

bool writeBinary(const std::string& p, const void* data, size_t size) {
    std::string dir = parent(p);
    if (!dir.empty() && !exists(dir)) createDirectories(dir);
    std::ofstream f(p, std::ios::binary | std::ios::trunc);
    if (!f) {
        NF_LOG_ERROR("FS", "cannot write file '%s'", p.c_str());
        return false;
    }
    f.write((const char*)data, (std::streamsize)size);
    return f.good();
}

bool appendText(const std::string& p, const std::string& data) {
    std::ofstream f(p, std::ios::binary | std::ios::app);
    if (!f) return false;
    f.write(data.data(), (std::streamsize)data.size());
    return f.good();
}

static const char* kB64 =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string base64Encode(const uint8_t* data, size_t size) {
    std::string out;
    out.reserve(((size + 2) / 3) * 4);
    for (size_t i = 0; i < size; i += 3) {
        uint32_t v = (uint32_t)data[i] << 16;
        if (i + 1 < size) v |= (uint32_t)data[i + 1] << 8;
        if (i + 2 < size) v |= data[i + 2];
        out.push_back(kB64[(v >> 18) & 63]);
        out.push_back(kB64[(v >> 12) & 63]);
        out.push_back(i + 1 < size ? kB64[(v >> 6) & 63] : '=');
        out.push_back(i + 2 < size ? kB64[v & 63] : '=');
    }
    return out;
}

std::string base64Encode(const Bytes& data) {
    return base64Encode(data.data(), data.size());
}

Bytes base64Decode(const std::string& text) {
    auto val = [](char c) -> int {
        if (c >= 'A' && c <= 'Z') return c - 'A';
        if (c >= 'a' && c <= 'z') return c - 'a' + 26;
        if (c >= '0' && c <= '9') return c - '0' + 52;
        if (c == '+') return 62;
        if (c == '/') return 63;
        return -1;
    };
    Bytes out;
    out.reserve(text.size() * 3 / 4);
    int buf = 0, bits = 0;
    for (char c : text) {
        int v = val(c);
        if (v < 0) continue;
        buf = (buf << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back((uint8_t)((buf >> bits) & 0xFF));
        }
    }
    return out;
}

bool createDirectories(const std::string& p) {
    std::error_code ec;
    stdfs::create_directories(p, ec);
    return !ec;
}

bool copyFile(const std::string& from, const std::string& to) {
    std::error_code ec;
    std::string dir = parent(to);
    if (!dir.empty() && !exists(dir)) createDirectories(dir);
    stdfs::copy_file(from, to, stdfs::copy_options::overwrite_existing, ec);
    if (ec) {
        NF_LOG_ERROR("FS", "copy failed %s -> %s (%s)", from.c_str(), to.c_str(), ec.message().c_str());
        return false;
    }
    return true;
}

bool copyTree(const std::string& from, const std::string& to) {
    std::error_code ec;
    stdfs::copy(from, to,
                stdfs::copy_options::recursive | stdfs::copy_options::overwrite_existing, ec);
    if (ec) {
        NF_LOG_ERROR("FS", "copyTree failed %s -> %s (%s)", from.c_str(), to.c_str(), ec.message().c_str());
        return false;
    }
    return true;
}

bool removeFile(const std::string& p) {
    std::error_code ec;
    return stdfs::remove(p, ec);
}
bool removeTree(const std::string& p) {
    std::error_code ec;
    stdfs::remove_all(p, ec);
    return !ec;
}
bool rename(const std::string& from, const std::string& to) {
    std::error_code ec;
    stdfs::rename(from, to, ec);
    if (ec) return false;
    return true;
}

std::vector<DirEntry> listDirectory(const std::string& p, bool recursive) {
    std::vector<DirEntry> out;
    std::error_code ec;
    if (!stdfs::is_directory(p, ec)) return out;
    auto add = [&](const stdfs::directory_entry& e) {
        DirEntry d;
        d.path = normalize(e.path().string());
        d.name = e.path().filename().string();
        d.directory = e.is_directory(ec);
        d.size = d.directory ? 0 : (int64_t)e.file_size(ec);
        out.push_back(d);
    };
    if (recursive) {
        for (auto it = stdfs::recursive_directory_iterator(p, stdfs::directory_options::skip_permission_denied, ec);
             !ec && it != stdfs::recursive_directory_iterator(); it.increment(ec)) {
            add(*it);
        }
    } else {
        for (auto it = stdfs::directory_iterator(p, stdfs::directory_options::skip_permission_denied, ec);
             !ec && it != stdfs::directory_iterator(); it.increment(ec)) {
            add(*it);
        }
    }
    std::sort(out.begin(), out.end(), [](const DirEntry& a, const DirEntry& b) {
        if (a.directory != b.directory) return a.directory > b.directory;
        return lower(a.name) < lower(b.name);
    });
    return out;
}

std::vector<DirEntry> listDirectoryExt(const std::string& p,
                                       const std::vector<std::string>& extensions,
                                       bool recursive) {
    auto all = listDirectory(p, recursive);
    std::vector<DirEntry> out;
    // Accept both "json" and ".json" - extension() never returns the dot, and
    // callers (scene lists, importers, the asset browser) use both spellings.
    std::vector<std::string> wanted;
    wanted.reserve(extensions.size());
    for (const std::string& e : extensions)
        wanted.push_back(!e.empty() && e[0] == '.' ? e.substr(1) : e);
    for (auto& e : all) {
        if (e.directory) continue;
        std::string ext = extension(e.name);
        if (std::find(wanted.begin(), wanted.end(), ext) != wanted.end())
            out.push_back(e);
    }
    return out;
}

std::string normalize(const std::string& p) {
    std::string s = p;
    std::replace(s.begin(), s.end(), '\\', '/');
    // collapse duplicate slashes
    std::string out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '/' && !out.empty() && out.back() == '/') continue;
        out.push_back(s[i]);
    }
    return out;
}

bool isAbsolute(const std::string& p) {
    if (p.empty()) return false;
    if (p[0] == '/' || p[0] == '\\') return true;
    return p.size() > 1 && p[1] == ':';
}

std::string join(const std::string& a, const std::string& b) {
    if (a.empty()) return b;
    if (b.empty()) return a;
    if (isAbsolute(b)) return b;
    char last = a.back();
    if (last == '/' || last == '\\') return a + b;
    return a + "/" + b;
}

std::string parent(const std::string& p) {
    std::string s = normalize(p);
    while (s.size() > 1 && s.back() == '/') s.pop_back();
    size_t pos = s.find_last_of('/');
    if (pos == std::string::npos) return "";
    if (pos == 0) return "/";
    return s.substr(0, pos);
}

std::string filename(const std::string& p) {
    std::string s = normalize(p);
    while (s.size() > 1 && s.back() == '/') s.pop_back();
    size_t pos = s.find_last_of('/');
    return pos == std::string::npos ? s : s.substr(pos + 1);
}

std::string stem(const std::string& p) {
    std::string f = filename(p);
    size_t pos = f.find_last_of('.');
    return pos == std::string::npos ? f : f.substr(0, pos);
}

std::string extension(const std::string& p) {
    std::string f = filename(p);
    size_t pos = f.find_last_of('.');
    if (pos == std::string::npos) return "";
    return lower(f.substr(pos + 1));
}

std::string absolute(const std::string& p) {
    std::error_code ec;
    auto a = stdfs::absolute(p, ec);
    return ec ? normalize(p) : normalize(a.string());
}

std::string relativeTo(const std::string& path, const std::string& base) {
    std::error_code ec;
    auto r = stdfs::relative(path, base, ec);
    if (ec) return normalize(path);
    return normalize(r.string());
}

std::string executablePath() {
#if defined(_WIN32)
    char buf[4096];
    DWORD n = GetModuleFileNameA(nullptr, buf, sizeof(buf));
    return n ? normalize(std::string(buf, n)) : "";
#else
    char buf[4096];
    ssize_t n = readlink("/proc/self/exe", buf, sizeof(buf) - 1);
    if (n > 0) { buf[n] = 0; return normalize(std::string(buf)); }
    return "";
#endif
}
std::string executableDir() { return parent(executablePath()); }
std::string currentDir() {
    std::error_code ec;
    return normalize(stdfs::current_path(ec).string());
}
std::string homeDir() {
    const char* h = getenv("HOME");
#if defined(_WIN32)
    if (!h) h = getenv("USERPROFILE");
#endif
    return h ? normalize(std::string(h)) : currentDir();
}
std::string tempDir() {
    std::error_code ec;
    return normalize(stdfs::temp_directory_path(ec).string());
}

std::string resolveAssetPath(const std::string& relative) {
    std::string r = normalize(relative);
    if (isAbsolute(r) && exists(r)) return r;
    std::vector<std::string> roots = {
        currentDir(),
        executableDir(),
        join(executableDir(), "Content"),
        join(executableDir(), ".."),
        homeDir(),
    };
    for (auto& root : roots) {
        std::string cand = join(root, r);
        if (exists(cand)) return cand;
    }
    // try stripping a leading project folder name
    size_t slash = r.find('/');
    if (slash != std::string::npos) {
        std::string tail = r.substr(slash + 1);
        for (auto& root : roots) {
            std::string cand = join(root, tail);
            if (exists(cand)) return cand;
        }
    }
    return join(currentDir(), r);
}

}  // namespace fs
}  // namespace nf
