// apk.h — portable APK inspection (zip + binary AndroidManifest + resources.arsc).
// Part of Neurio APK Player. No Windows dependencies here, so it is unit-tested on Linux.
#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <unordered_map>
#include <vector>

namespace apk {

struct Entry {
    std::string name;
    uint64_t size = 0;   // uncompressed size
    uint32_t index = 0;  // index inside the zip central directory
};

// Read-only zip archive (wraps miniz). Not thread-safe: use one instance per thread.
class Archive {
public:
    Archive();
    ~Archive();
    Archive(const Archive&) = delete;
    Archive& operator=(const Archive&) = delete;

    bool openFile(const std::string& utf8Path);
    bool openMemory(const void* data, size_t size);  // data must outlive the archive
    void close();
    bool isOpen() const { return zip_ != nullptr; }

    const std::vector<Entry>& entries() const { return entries_; }
    const Entry* find(const std::string& name) const;
    bool read(const Entry& e, std::string& out, uint64_t maxSize = (96ull << 20)) const;
    // Streams the decompressed bytes of an entry; the writer returns false to abort.
    bool extract(const Entry& e, const std::function<bool(const void*, size_t)>& writer) const;
    const std::string& lastError() const { return err_; }

private:
    bool indexEntries();
    void* zip_ = nullptr;   // mz_zip_archive*
    void* file_ = nullptr;  // FILE*
    std::vector<Entry> entries_;
    std::unordered_map<std::string, size_t> byName_;
    mutable std::string err_;
};

enum class Kind { Unknown, Web, Remote, Native };

struct Info {
    // identity
    std::string package, label, versionName, versionCode;
    int minSdk = 0, targetSdk = 0;
    std::string orientation;  // "landscape", "portrait" or ""

    // launcher icon (paths inside the archive)
    std::string icon;            // best bitmap (png / webp / jpg)
    std::string iconFg, iconBg;  // adaptive-icon bitmap layers, when there is no plain bitmap
    uint32_t iconBgColor = 0xFFFFFFFF;
    bool hasIconBgColor = false;

    // what kind of app this is
    Kind kind = Kind::Unknown;
    std::string framework;  // "Cordova", "Capacitor", "WebView", "Unity", "Flutter", ...
    std::string webRoot;    // folder inside the APK served as the web root, e.g. "assets/www"
    std::string entry;      // start page relative to webRoot, e.g. "index.html"
    std::string remoteUrl;  // for Kind::Remote
    bool guessed = false;   // entry/url found heuristically (not from an explicit reference)
    bool cordova = false;
    bool keyboard = false;  // the web content listens to keyboard events
    std::string uaSuffix;   // token(s) the app appends to its WebView user agent, e.g. " MyGameAPK/1.0"
    std::vector<std::string> abis;
    std::vector<std::string> engines;  // native engines / runtimes found in lib/ or assets/
    uint64_t webBytes = 0;             // total size of files under webRoot
    size_t webFiles = 0;
};

// Inspects an opened archive. Returns false only if it is not an APK at all.
bool inspect(const Archive& a, Info& info, std::string* error = nullptr);

// For .xapk / .apks / .apkm bundles: name of the base APK stored inside, or "".
std::string findInnerApk(const Archive& a);

const char* kindName(Kind k);
std::string jsonEscape(const std::string& s);
std::string toJson(const Info& info);

// ---- lower level pieces (exposed for tests) ----
struct XmlAttr {
    std::string ns, name;
    uint32_t resId = 0;  // android attribute id from the resource map (0 if unknown)
    uint8_t type = 0;    // Res_value data type
    uint32_t data = 0;
    std::string str;     // string value (raw value or string-typed data)
};
struct XmlElem {
    std::string name;
    int parent = -1;
    int depth = 0;
    std::vector<XmlAttr> attrs;
    const XmlAttr* attr(uint32_t resId, const char* name) const;
};
bool parseAxml(const std::string& buf, std::vector<XmlElem>& out);

}  // namespace apk
