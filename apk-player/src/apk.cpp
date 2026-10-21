// apk.cpp — portable APK inspection for Neurio APK Player.
//
// An APK is a zip file. To decide whether an APK can be played without an
// Android emulator we look for web content (HTML5 games and apps built with
// Cordova, Capacitor, Construct, Phaser, plain WebView shells, ...): those can
// run directly in the Chromium engine of Windows (WebView2). Native apps
// (Unity, Unreal, Java/Kotlin UI, ...) are detected and reported instead.
//
// Binary formats handled here (all little endian):
//   * AndroidManifest.xml / res/xml/*.xml : Android binary XML ("AXML")
//   * resources.arsc                      : compiled resource table
//   * classes*.dex                        : only scanned for string literals
#include "apk.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <map>
#include <set>

#include "miniz.h"

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

namespace apk {
namespace {

inline uint16_t rd16(const uint8_t* p) { return uint16_t(p[0] | (p[1] << 8)); }
inline uint32_t rd32(const uint8_t* p) {
    return uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24);
}

bool startsWith(const std::string& s, const std::string& p) { return s.size() >= p.size() && s.compare(0, p.size(), p) == 0; }
bool endsWith(const std::string& s, const std::string& p) {
    return s.size() >= p.size() && s.compare(s.size() - p.size(), p.size(), p) == 0;
}
std::string lower(std::string s) {
    for (auto& c : s) c = char(std::tolower((unsigned char)c));
    return s;
}
std::string baseName(const std::string& p) {
    size_t i = p.find_last_of('/');
    return i == std::string::npos ? p : p.substr(i + 1);
}
std::string dirName(const std::string& p) {
    size_t i = p.find_last_of('/');
    return i == std::string::npos ? std::string() : p.substr(0, i);
}
int depthOf(const std::string& p) { return int(std::count(p.begin(), p.end(), '/')); }
std::string stripQuery(const std::string& s) {
    size_t i = s.find_first_of("?#");
    return i == std::string::npos ? s : s.substr(0, i);
}

void appendUtf8(std::string& out, uint32_t cp) {
    if (cp < 0x80) {
        out += char(cp);
    } else if (cp < 0x800) {
        out += char(0xC0 | (cp >> 6));
        out += char(0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
        out += char(0xE0 | (cp >> 12));
        out += char(0x80 | ((cp >> 6) & 0x3F));
        out += char(0x80 | (cp & 0x3F));
    } else {
        out += char(0xF0 | (cp >> 18));
        out += char(0x80 | ((cp >> 12) & 0x3F));
        out += char(0x80 | ((cp >> 6) & 0x3F));
        out += char(0x80 | (cp & 0x3F));
    }
}

#ifdef _WIN32
std::wstring widen(const std::string& s) {
    if (s.empty()) return std::wstring();
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), int(s.size()), nullptr, 0);
    std::wstring w(size_t(n), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), int(s.size()), &w[0], n);
    return w;
}
#endif

// Android resource / binary xml constants
enum : uint16_t {
    RES_STRING_POOL_TYPE = 0x0001,
    RES_TABLE_TYPE = 0x0002,
    RES_XML_TYPE = 0x0003,
    RES_XML_START_NAMESPACE_TYPE = 0x0100,
    RES_XML_END_NAMESPACE_TYPE = 0x0101,
    RES_XML_START_ELEMENT_TYPE = 0x0102,
    RES_XML_END_ELEMENT_TYPE = 0x0103,
    RES_XML_RESOURCE_MAP_TYPE = 0x0180,
    RES_TABLE_PACKAGE_TYPE = 0x0200,
    RES_TABLE_TYPE_TYPE = 0x0201,
    RES_TABLE_TYPE_SPEC_TYPE = 0x0202,
};
enum : uint8_t {
    TYPE_NULL = 0x00,
    TYPE_REFERENCE = 0x01,
    TYPE_ATTRIBUTE = 0x02,
    TYPE_STRING = 0x03,
    TYPE_INT_DEC = 0x10,
    TYPE_INT_HEX = 0x11,
    TYPE_INT_BOOLEAN = 0x12,
    TYPE_INT_COLOR_ARGB8 = 0x1c,
    TYPE_INT_COLOR_RGB8 = 0x1d,
    TYPE_INT_COLOR_ARGB4 = 0x1e,
    TYPE_INT_COLOR_RGB4 = 0x1f,
};
// android.R.attr ids
enum : uint32_t {
    ATTR_LABEL = 0x01010001,
    ATTR_ICON = 0x01010002,
    ATTR_NAME = 0x01010003,
    ATTR_SCREEN_ORIENTATION = 0x0101001e,
    ATTR_VALUE = 0x01010024,
    ATTR_RESOURCE = 0x01010025,
    ATTR_DRAWABLE = 0x01010199,
    ATTR_TARGET_ACTIVITY = 0x01010202,
    ATTR_MIN_SDK = 0x0101020c,
    ATTR_VERSION_CODE = 0x0101021b,
    ATTR_VERSION_NAME = 0x0101021c,
    ATTR_TARGET_SDK = 0x01010270,
    ATTR_ROUND_ICON = 0x0101052c,
};

// ---------------------------------------------------------------- string pool
struct StringPool {
    std::vector<std::string> strings;
    const std::string& get(uint32_t i) const {
        static const std::string empty;
        return i < strings.size() ? strings[i] : empty;
    }
    // p points at the chunk header, n = bytes available from p
    bool parse(const uint8_t* p, size_t n) {
        strings.clear();
        if (n < 28) return false;
        uint16_t type = rd16(p), hsize = rd16(p + 2);
        uint32_t size = rd32(p + 4);
        if (type != RES_STRING_POOL_TYPE || size > n || size < 28 || hsize < 28) return false;
        uint32_t count = rd32(p + 8), flags = rd32(p + 16), strStart = rd32(p + 20);
        bool utf8 = (flags & (1u << 8)) != 0;
        if (count > (size - hsize) / 4 || strStart > size) return false;
        strings.resize(count);
        const uint8_t* offs = p + hsize;
        const uint8_t* end = p + size;
        for (uint32_t i = 0; i < count; i++) {
            uint32_t off = rd32(offs + 4 * i);
            const uint8_t* s = p + strStart + off;
            if (strStart + uint64_t(off) >= size) continue;
            std::string& out = strings[i];
            if (utf8) {
                // utf16 length (1 or 2 bytes), then utf8 byte length (1 or 2 bytes)
                if (s + 2 > end) continue;
                size_t k = (s[0] & 0x80) ? 2 : 1;
                if (s + k + 2 > end) continue;
                const uint8_t* q = s + k;
                size_t blen = q[0];
                if (q[0] & 0x80) {
                    blen = (size_t(q[0] & 0x7F) << 8) | q[1];
                    q += 2;
                } else {
                    q += 1;
                }
                if (q + blen > end) blen = size_t(end - q);
                out.assign(reinterpret_cast<const char*>(q), blen);
            } else {
                if (s + 2 > end) continue;
                size_t len = rd16(s);
                const uint8_t* q = s + 2;
                if (len & 0x8000) {
                    if (s + 4 > end) continue;
                    len = ((len & 0x7FFF) << 16) | rd16(s + 2);
                    q = s + 4;
                }
                if (q + 2 * len > end) len = size_t(end - q) / 2;
                out.reserve(len);
                for (size_t j = 0; j < len; j++) {
                    uint32_t c = rd16(q + 2 * j);
                    if (c >= 0xD800 && c <= 0xDBFF && j + 1 < len) {
                        uint32_t d = rd16(q + 2 * (j + 1));
                        if (d >= 0xDC00 && d <= 0xDFFF) {
                            c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00);
                            j++;
                        }
                    }
                    appendUtf8(out, c);
                }
            }
        }
        return true;
    }
};

// -------------------------------------------------------------- resource table
struct ResValue {
    uint8_t type = TYPE_NULL;
    uint32_t data = 0;
};
struct ResCandidate {
    ResValue v;
    uint16_t density = 0;  // 0 = default, 0xfffe = anydpi, 0xffff = nodpi
    bool defaultLocale = true;
    uint16_t sdk = 0;
};

class ResTable {
public:
    bool parse(std::string buf) {
        buf_ = std::move(buf);
        const uint8_t* p = reinterpret_cast<const uint8_t*>(buf_.data());
        size_t n = buf_.size();
        if (n < 12 || rd16(p) != RES_TABLE_TYPE) return false;
        uint16_t hsize = rd16(p + 2);
        size_t size = std::min<size_t>(rd32(p + 4), n);
        size_t off = hsize;
        bool gotStrings = false;
        while (off + 8 <= size) {
            const uint8_t* c = p + off;
            uint16_t ctype = rd16(c);
            uint32_t csize = rd32(c + 4);
            if (csize < 8 || off + csize > size) break;
            if (ctype == RES_STRING_POOL_TYPE && !gotStrings) {
                values_.parse(c, csize);
                gotStrings = true;
            } else if (ctype == RES_TABLE_PACKAGE_TYPE) {
                parsePackage(c, csize);
            }
            off += csize;
        }
        return !pkgs_.empty();
    }

    const StringPool& values() const { return values_; }

    std::vector<ResCandidate> lookup(uint32_t resId) const {
        std::vector<ResCandidate> out;
        uint32_t pkgId = resId >> 24, typeId = (resId >> 16) & 0xFF, entry = resId & 0xFFFF;
        for (const auto& pkg : pkgs_) {
            if (pkg.id != pkgId) continue;
            auto it = pkg.types.find(uint8_t(typeId));
            if (it == pkg.types.end()) continue;
            for (const auto& t : it->second) {
                ResCandidate rc;
                if (readEntry(t, entry, rc.v, nullptr)) {
                    rc.density = t.density;
                    rc.defaultLocale = t.defaultLocale;
                    rc.sdk = t.sdk;
                    out.push_back(rc);
                }
            }
        }
        return out;
    }

    // calls fn(key, value) for every plain string resource (any configuration)
    void forEachString(const std::function<void(const std::string&, const std::string&)>& fn) const {
        for (const auto& pkg : pkgs_) {
            uint8_t sid = 0;
            for (size_t i = 0; i < pkg.typeNames.strings.size(); i++)
                if (pkg.typeNames.strings[i] == "string") sid = uint8_t(i + 1);
            if (!sid) continue;
            auto it = pkg.types.find(sid);
            if (it == pkg.types.end()) continue;
            for (const auto& t : it->second) {
                for (uint32_t e = 0; e < t.entryCount; e++) {
                    ResValue v;
                    uint32_t keyIdx = 0;
                    if (!readEntry(t, e, v, &keyIdx)) continue;
                    if (v.type != TYPE_STRING) continue;
                    fn(pkg.keyNames.get(keyIdx), values_.get(v.data));
                }
            }
        }
    }

private:
    struct TypeChunk {
        const uint8_t* base = nullptr;
        size_t size = 0;
        uint32_t headerSize = 0, entryCount = 0, entriesStart = 0;
        uint8_t flags = 0;
        uint16_t density = 0, sdk = 0;
        bool defaultLocale = true;
    };
    struct Package {
        uint32_t id = 0;
        StringPool typeNames, keyNames;
        std::map<uint8_t, std::vector<TypeChunk>> types;
    };

    void parsePackage(const uint8_t* c, size_t csize) {
        if (csize < 284) return;
        Package pkg;
        uint16_t hsize = rd16(c + 2);
        pkg.id = rd32(c + 8);
        uint32_t typeStrings = rd32(c + 268), keyStrings = rd32(c + 276);
        if (typeStrings && typeStrings < csize) pkg.typeNames.parse(c + typeStrings, csize - typeStrings);
        if (keyStrings && keyStrings < csize) pkg.keyNames.parse(c + keyStrings, csize - keyStrings);
        size_t off = hsize;
        while (off + 8 <= csize) {
            const uint8_t* t = c + off;
            uint16_t ttype = rd16(t), th = rd16(t + 2);
            uint32_t tsize = rd32(t + 4);
            if (tsize < 8 || off + tsize > csize) break;
            if (ttype == RES_TABLE_TYPE_TYPE && th >= 20 && tsize >= th) {
                TypeChunk tc;
                tc.base = t;
                tc.size = tsize;
                tc.headerSize = th;
                uint8_t id = t[8];
                tc.flags = t[9];
                tc.entryCount = rd32(t + 12);
                tc.entriesStart = rd32(t + 16);
                // ResTable_config starts at t+20: size(4) mcc(2) mnc(2) lang(2) country(2)
                //   orientation(1) touchscreen(1) density(2) ... sdkVersion at +24 (after input/screen size)
                const uint8_t* cfg = t + 20;
                uint32_t cfgSize = (th >= 24) ? rd32(cfg) : 0;
                if (cfgSize >= 16 && 20 + 16 <= th) {
                    tc.defaultLocale = (cfg[8] == 0 && cfg[9] == 0);
                    tc.density = rd16(cfg + 14);
                }
                if (cfgSize >= 28 && 20 + 28 <= th) tc.sdk = rd16(cfg + 24);
                if (id && tc.entriesStart < tsize) pkg.types[id].push_back(tc);
            }
            off += tsize;
        }
        pkgs_.push_back(std::move(pkg));
    }

    bool readEntry(const TypeChunk& t, uint32_t entry, ResValue& v, uint32_t* keyIdx) const {
        const uint8_t* idx = t.base + t.headerSize;
        size_t idxBytes = t.entriesStart > t.headerSize ? t.entriesStart - t.headerSize : 0;
        uint32_t offset = 0xFFFFFFFF;
        if (t.flags & 0x01) {  // FLAG_SPARSE: (u16 index, u16 offset/4) pairs sorted by index
            size_t n = std::min<size_t>(t.entryCount, idxBytes / 4);
            size_t lo = 0, hi = n;
            while (lo < hi) {
                size_t mid = (lo + hi) / 2;
                uint16_t ei = rd16(idx + 4 * mid);
                if (ei == entry) {
                    offset = uint32_t(rd16(idx + 4 * mid + 2)) * 4;
                    break;
                }
                if (ei < entry) lo = mid + 1; else hi = mid;
            }
        } else if (t.flags & 0x02) {  // FLAG_OFFSET16
            if (entry >= t.entryCount || (entry + 1) * 2 > idxBytes) return false;
            uint16_t o = rd16(idx + 2 * entry);
            if (o != 0xFFFF) offset = uint32_t(o) * 4;
        } else {
            if (entry >= t.entryCount || (uint64_t(entry) + 1) * 4 > idxBytes) return false;
            offset = rd32(idx + 4 * entry);
        }
        if (offset == 0xFFFFFFFF) return false;
        uint64_t pos = uint64_t(t.entriesStart) + offset;
        if (pos + 8 > t.size) return false;
        const uint8_t* e = t.base + pos;
        uint16_t esize = rd16(e), eflags = rd16(e + 2);
        if (eflags & 0x0008) {  // FLAG_COMPACT
            if (keyIdx) *keyIdx = esize;
            v.type = uint8_t(eflags >> 8);
            v.data = rd32(e + 4);
            return true;
        }
        if (keyIdx) *keyIdx = rd32(e + 4);
        if (eflags & 0x0001) return false;  // complex (bag) entry
        if (pos + esize + 8 > t.size) return false;
        const uint8_t* rv = e + esize;
        v.type = rv[3];
        v.data = rd32(rv + 4);
        return true;
    }

    std::string buf_;
    StringPool values_;
    std::vector<Package> pkgs_;
};

// ------------------------------------------------------------------ helpers

std::string resolveString(const ResTable* rt, uint8_t type, uint32_t data, const std::string& raw, int depth = 0) {
    if (type == TYPE_STRING) return raw;
    if (type == TYPE_INT_DEC) return std::to_string(int32_t(data));
    if (type == TYPE_INT_HEX) {
        char b[16];
        snprintf(b, sizeof b, "0x%x", data);
        return b;
    }
    if (type != TYPE_REFERENCE || !rt || depth > 6) return raw;
    auto cands = rt->lookup(data);
    const ResCandidate* best = nullptr;
    for (const auto& c : cands)
        if (c.defaultLocale) { best = &c; break; }
    if (!best && !cands.empty()) best = &cands[0];
    if (!best) return raw;
    if (best->v.type == TYPE_STRING) return rt->values().get(best->v.data);
    return resolveString(rt, best->v.type, best->v.data, std::string(), depth + 1);
}

std::string attrString(const ResTable* rt, const XmlAttr* a) {
    if (!a) return std::string();
    return resolveString(rt, a->type, a->data, a->str);
}

bool isBitmap(const std::string& p) {
    std::string l = lower(p);
    return endsWith(l, ".png") || endsWith(l, ".webp") || endsWith(l, ".jpg") || endsWith(l, ".jpeg");
}

int densityRank(uint16_t d) {
    if (d == 0xFFFF) return 100;   // nodpi
    if (d == 0xFFFE) return 50;    // anydpi (usually xml)
    if (d == 0) return 160;        // default = mdpi
    return d;
}

struct FileRes {
    std::string bitmap;  // best bitmap
    std::string xml;     // xml (vector / adaptive icon), if any
    bool isColor = false;
    uint32_t color = 0;
};

FileRes resolveFile(const ResTable* rt, uint32_t resId, int depth = 0) {
    FileRes fr;
    if (!rt || depth > 6) return fr;
    auto cands = rt->lookup(resId);
    int bestRank = -1;
    for (const auto& c : cands) {
        if (c.v.type == TYPE_STRING) {
            const std::string& path = rt->values().get(c.v.data);
            if (isBitmap(path)) {
                int r = densityRank(c.density);
                if (r > bestRank) {
                    bestRank = r;
                    fr.bitmap = path;
                }
            } else if (endsWith(lower(path), ".xml") && fr.xml.empty()) {
                fr.xml = path;
            }
        } else if (c.v.type >= TYPE_INT_COLOR_ARGB8 && c.v.type <= TYPE_INT_COLOR_RGB4) {
            fr.isColor = true;
            fr.color = c.v.data;
        } else if (c.v.type == TYPE_REFERENCE && fr.bitmap.empty()) {
            FileRes sub = resolveFile(rt, c.v.data, depth + 1);
            if (!sub.bitmap.empty()) fr.bitmap = sub.bitmap;
            if (fr.xml.empty()) fr.xml = sub.xml;
            if (sub.isColor && !fr.isColor) {
                fr.isColor = true;
                fr.color = sub.color;
            }
        }
    }
    return fr;
}

bool isPlainRef(const XmlAttr* a) { return a && a->type == TYPE_REFERENCE && a->data; }

std::string normalizeColor(uint8_t type, uint32_t c) {
    (void)type;
    char b[16];
    snprintf(b, sizeof b, "#%08x", c);
    return b;
}

bool containsAny(const std::string& hay, const char* const* needles) {
    for (const char* const* n = needles; *n; n++)
        if (hay.find(*n) != std::string::npos) return true;
    return false;
}

// strings in dex files that start with prefix -> list of remainders
void scanForPrefix(const std::string& buf, const std::string& prefix, std::vector<std::string>& out) {
    size_t pos = 0;
    while ((pos = buf.find(prefix, pos)) != std::string::npos) {
        size_t s = pos + prefix.size(), e = s;
        while (e < buf.size() && e - s < 512) {
            unsigned char ch = (unsigned char)buf[e];
            if (ch < 0x20 || ch == '"' || ch == '\'' || ch == '<' || ch == '>' || ch == '\\' || ch == ' ') break;
            e++;
        }
        if (e > s) {
            std::string r = buf.substr(s, e - s);
            if (std::find(out.begin(), out.end(), r) == out.end()) out.push_back(r);
        }
        pos = s;
    }
}

const char* const kNotTheApp[] = {"licen", "privacy", "policy", "terms", "eula", "credits", "notice", "about",
                                  "help", "faq", "changelog", "open_source", "opensource", "oss", "third_party",
                                  "thirdparty", "copyright", "agreement", "consent", "tos.", "gdpr", "readme",
                                  "error", "offline", "404", nullptr};

bool looksLikeAppPage(const std::string& path) {
    std::string b = lower(baseName(path));
    return !containsAny(b, kNotTheApp);
}

std::string jsonGetString(const std::string& json, const std::string& key, size_t from = 0) {
    std::string pat = "\"" + key + "\"";
    size_t k = json.find(pat, from);
    if (k == std::string::npos) return std::string();
    size_t c = json.find(':', k + pat.size());
    if (c == std::string::npos) return std::string();
    size_t q = json.find_first_not_of(" \t\r\n", c + 1);
    if (q == std::string::npos || json[q] != '"') return std::string();
    std::string out;
    for (size_t i = q + 1; i < json.size(); i++) {
        char ch = json[i];
        if (ch == '\\' && i + 1 < json.size()) {
            out += json[++i];
            continue;
        }
        if (ch == '"') break;
        out += ch;
    }
    return out;
}

bool isPrivateUrl(const std::string& u) {
    std::string l = lower(u);
    const char* priv[] = {"://localhost", "://127.", "://10.", "://192.168.", "://172.16.", "://0.0.0.0", "://[::1]"};
    for (const char* p : priv)
        if (l.find(p) != std::string::npos) return true;
    return false;
}

}  // namespace

// ============================================================ Archive
Archive::Archive() {}
Archive::~Archive() { close(); }

void Archive::close() {
    if (zip_) {
        auto* z = static_cast<mz_zip_archive*>(zip_);
        mz_zip_reader_end(z);
        delete z;
        zip_ = nullptr;
    }
    if (file_) {
        fclose(static_cast<FILE*>(file_));
        file_ = nullptr;
    }
    entries_.clear();
    byName_.clear();
}

bool Archive::openFile(const std::string& path) {
    close();
#ifdef _WIN32
    FILE* f = _wfopen(widen(path).c_str(), L"rb");
#else
    FILE* f = fopen(path.c_str(), "rb");
#endif
    if (!f) {
        err_ = "cannot open the file";
        return false;
    }
#ifdef _WIN32
    _fseeki64(f, 0, SEEK_END);
    long long size = _ftelli64(f);
    _fseeki64(f, 0, SEEK_SET);
#else
    fseeko(f, 0, SEEK_END);
    long long size = (long long)ftello(f);
    fseeko(f, 0, SEEK_SET);
#endif
    if (size <= 22) {
        fclose(f);
        err_ = "the file is empty or too small to be an APK";
        return false;
    }
    auto* z = new mz_zip_archive;
    mz_zip_zero_struct(z);
    if (!mz_zip_reader_init_cfile(z, f, mz_uint64(size), 0)) {
        err_ = std::string("not a valid APK/zip file (") + mz_zip_get_error_string(mz_zip_get_last_error(z)) + ")";
        delete z;
        fclose(f);
        return false;
    }
    zip_ = z;
    file_ = f;
    return indexEntries();
}

bool Archive::openMemory(const void* data, size_t size) {
    close();
    auto* z = new mz_zip_archive;
    mz_zip_zero_struct(z);
    if (!mz_zip_reader_init_mem(z, data, size, 0)) {
        err_ = std::string("not a valid APK/zip file (") + mz_zip_get_error_string(mz_zip_get_last_error(z)) + ")";
        delete z;
        return false;
    }
    zip_ = z;
    return indexEntries();
}

bool Archive::indexEntries() {
    auto* z = static_cast<mz_zip_archive*>(zip_);
    mz_uint n = mz_zip_reader_get_num_files(z);
    entries_.reserve(n);
    for (mz_uint i = 0; i < n; i++) {
        mz_zip_archive_file_stat st;
        if (!mz_zip_reader_file_stat(z, i, &st)) continue;
        if (st.m_is_directory) continue;
        Entry e;
        e.name = st.m_filename;
        // normalise: forward slashes, no leading slash
        std::replace(e.name.begin(), e.name.end(), '\\', '/');
        while (!e.name.empty() && e.name[0] == '/') e.name.erase(0, 1);
        if (e.name.empty()) continue;
        e.size = st.m_uncomp_size;
        e.index = i;
        if (byName_.count(e.name)) continue;  // keep the first duplicate, like Android does
        byName_[e.name] = entries_.size();
        entries_.push_back(std::move(e));
    }
    return true;
}

const Entry* Archive::find(const std::string& name) const {
    auto it = byName_.find(name);
    return it == byName_.end() ? nullptr : &entries_[it->second];
}

bool Archive::read(const Entry& e, std::string& out, uint64_t maxSize) const {
    out.clear();
    if (!zip_) return false;
    if (e.size > maxSize) {
        err_ = "entry too large";
        return false;
    }
    out.resize(size_t(e.size));
    if (e.size == 0) return true;
    auto* z = static_cast<mz_zip_archive*>(zip_);
    if (!mz_zip_reader_extract_to_mem(z, e.index, &out[0], out.size(), 0)) {
        err_ = mz_zip_get_error_string(mz_zip_get_last_error(z));
        out.clear();
        return false;
    }
    return true;
}

namespace {
struct CbCtx {
    const std::function<bool(const void*, size_t)>* fn;
};
size_t extractCb(void* opaque, mz_uint64, const void* buf, size_t n) {
    auto* c = static_cast<CbCtx*>(opaque);
    return (*c->fn)(buf, n) ? n : 0;
}
}  // namespace

bool Archive::extract(const Entry& e, const std::function<bool(const void*, size_t)>& writer) const {
    if (!zip_) return false;
    auto* z = static_cast<mz_zip_archive*>(zip_);
    CbCtx ctx{&writer};
    if (!mz_zip_reader_extract_to_callback(z, e.index, extractCb, &ctx, 0)) {
        err_ = mz_zip_get_error_string(mz_zip_get_last_error(z));
        return false;
    }
    return true;
}

// ============================================================ binary XML
const XmlAttr* XmlElem::attr(uint32_t resId, const char* nm) const {
    if (resId)
        for (const auto& a : attrs)
            if (a.resId == resId) return &a;
    if (nm)
        for (const auto& a : attrs)
            if (a.name == nm) return &a;
    return nullptr;
}

bool parseAxml(const std::string& buf, std::vector<XmlElem>& out) {
    out.clear();
    const uint8_t* p = reinterpret_cast<const uint8_t*>(buf.data());
    size_t n = buf.size();
    if (n < 8 || rd16(p) != RES_XML_TYPE) return false;
    size_t off = rd16(p + 2);
    if (off < 8) off = 8;
    StringPool sp;
    std::vector<uint32_t> resMap;
    std::vector<int> stack;
    while (off + 8 <= n) {
        const uint8_t* c = p + off;
        uint16_t type = rd16(c), hsize = rd16(c + 2);
        uint32_t size = rd32(c + 4);
        if (size < 8 || off + size > n) break;
        if (type == RES_STRING_POOL_TYPE) {
            sp.parse(c, size);
        } else if (type == RES_XML_RESOURCE_MAP_TYPE) {
            size_t cnt = (size - hsize) / 4;
            resMap.resize(cnt);
            for (size_t i = 0; i < cnt; i++) resMap[i] = rd32(c + hsize + 4 * i);
        } else if (type == RES_XML_START_ELEMENT_TYPE && hsize >= 16 && size >= uint32_t(hsize) + 20) {
            // ResXMLTree_node (headerSize bytes, normally 16) then ResXMLTree_attrExt
            const uint8_t* ext = c + hsize;
            XmlElem el;
            el.name = sp.get(rd32(ext + 4));
            uint16_t attrStart = rd16(ext + 8), attrSize = rd16(ext + 10), attrCount = rd16(ext + 12);
            if (attrSize < 20) attrSize = 20;
            for (uint16_t i = 0; i < attrCount; i++) {
                size_t ao = size_t(hsize) + size_t(attrStart) + size_t(i) * attrSize;
                if (ao + 20 > size) break;
                const uint8_t* a = c + ao;
                XmlAttr at;
                uint32_t nsIdx = rd32(a), nameIdx = rd32(a + 4), rawIdx = rd32(a + 8);
                at.ns = nsIdx == 0xFFFFFFFF ? std::string() : sp.get(nsIdx);
                at.name = sp.get(nameIdx);
                if (nameIdx < resMap.size()) at.resId = resMap[nameIdx];
                at.type = a[15];
                at.data = rd32(a + 16);
                if (rawIdx != 0xFFFFFFFF) at.str = sp.get(rawIdx);
                if (at.type == TYPE_STRING) at.str = sp.get(at.data);
                el.attrs.push_back(std::move(at));
            }
            el.parent = stack.empty() ? -1 : stack.back();
            el.depth = int(stack.size());
            out.push_back(std::move(el));
            stack.push_back(int(out.size()) - 1);
        } else if (type == RES_XML_END_ELEMENT_TYPE) {
            if (!stack.empty()) stack.pop_back();
        }
        off += size;
    }
    return !out.empty();
}

// ============================================================ inspect
const char* kindName(Kind k) {
    switch (k) {
        case Kind::Web: return "web";
        case Kind::Remote: return "remote";
        case Kind::Native: return "native";
        default: return "unknown";
    }
}

std::string findInnerApk(const Archive& a) {
    if (a.find("AndroidManifest.xml")) return std::string();
    std::string best;
    uint64_t bestSize = 0;
    for (const auto& e : a.entries()) {
        std::string l = lower(e.name);
        if (!endsWith(l, ".apk")) continue;
        std::string b = baseName(l);
        if (b == "base.apk") return e.name;
        // config splits (split_config.arm64_v8a.apk, config.xxhdpi.apk ...) are never the base
        if (startsWith(b, "split_config") || startsWith(b, "config.")) continue;
        if (e.size > bestSize) {
            bestSize = e.size;
            best = e.name;
        }
    }
    return best;
}

bool inspect(const Archive& a, Info& info, std::string* error) {
    info = Info();
    const Entry* man = a.find("AndroidManifest.xml");
    if (!man) {
        if (error) *error = "AndroidManifest.xml not found - this is not an APK";
        return false;
    }

    // ---- resources.arsc (optional, used to resolve @string / @mipmap references)
    ResTable table;
    const ResTable* rt = nullptr;
    if (const Entry* rs = a.find("resources.arsc")) {
        std::string buf;
        if (a.read(*rs, buf) && table.parse(std::move(buf))) rt = &table;
    }

    // ---- manifest
    std::string mbuf;
    std::vector<XmlElem> xml;
    if (!a.read(*man, mbuf) || !parseAxml(mbuf, xml)) {
        if (error) *error = "cannot read AndroidManifest.xml";
        return false;
    }

    int appIdx = -1;
    std::vector<int> activities;
    for (size_t i = 0; i < xml.size(); i++) {
        const XmlElem& el = xml[i];
        if (el.name == "manifest" && el.depth == 0) {
            if (auto* at = el.attr(0, "package")) info.package = at->str;
            info.versionCode = attrString(rt, el.attr(ATTR_VERSION_CODE, "versionCode"));
            info.versionName = attrString(rt, el.attr(ATTR_VERSION_NAME, "versionName"));
        } else if (el.name == "uses-sdk") {
            auto* mn = el.attr(ATTR_MIN_SDK, "minSdkVersion");
            auto* tg = el.attr(ATTR_TARGET_SDK, "targetSdkVersion");
            if (mn && mn->type == TYPE_INT_DEC) info.minSdk = int(mn->data);
            if (tg && tg->type == TYPE_INT_DEC) info.targetSdk = int(tg->data);
        } else if (el.name == "application" && appIdx < 0) {
            appIdx = int(i);
        } else if (el.name == "activity" || el.name == "activity-alias") {
            activities.push_back(int(i));
        }
    }

    // launcher activity = has <intent-filter> with action MAIN + category LAUNCHER
    int launcher = -1;
    for (int act : activities) {
        bool main = false, cat = false;
        for (size_t j = size_t(act) + 1; j < xml.size() && xml[j].depth > xml[act].depth; j++) {
            const XmlElem& el = xml[j];
            const XmlAttr* nm = el.attr(ATTR_NAME, "name");
            if (!nm) continue;
            if (el.name == "action" && nm->str == "android.intent.action.MAIN") main = true;
            if (el.name == "category" && (nm->str == "android.intent.category.LAUNCHER" ||
                                          nm->str == "android.intent.category.LEANBACK_LAUNCHER"))
                cat = true;
        }
        if (main && cat) {
            launcher = act;
            break;
        }
    }
    int orientationSrc = launcher;
    if (launcher >= 0 && xml[launcher].name == "activity-alias") {
        // orientation lives on the target activity
        std::string target = attrString(rt, xml[launcher].attr(ATTR_TARGET_ACTIVITY, "targetActivity"));
        for (int act : activities) {
            if (xml[act].name != "activity") continue;
            std::string nm = attrString(rt, xml[act].attr(ATTR_NAME, "name"));
            if (nm == target || (!target.empty() && target[0] == '.' && endsWith(nm, target)) ||
                (!nm.empty() && nm[0] == '.' && endsWith(target, nm))) {
                orientationSrc = act;
                break;
            }
        }
    }
    if (orientationSrc >= 0) {
        if (auto* o = xml[orientationSrc].attr(ATTR_SCREEN_ORIENTATION, "screenOrientation")) {
            int v = int(int32_t(o->data));
            if (v == 0 || v == 6 || v == 8 || v == 11) info.orientation = "landscape";
            if (v == 1 || v == 7 || v == 9 || v == 12) info.orientation = "portrait";
        }
    }

    // label
    if (appIdx >= 0) info.label = attrString(rt, xml[appIdx].attr(ATTR_LABEL, "label"));
    if (info.label.empty() && launcher >= 0) info.label = attrString(rt, xml[launcher].attr(ATTR_LABEL, "label"));
    if (info.label.empty()) info.label = info.package;

    // icon
    if (appIdx >= 0 && rt) {
        const XmlAttr* ic = xml[appIdx].attr(ATTR_ICON, "icon");
        if (!isPlainRef(ic)) ic = xml[appIdx].attr(ATTR_ROUND_ICON, "roundIcon");
        if (isPlainRef(ic)) {
            FileRes fr = resolveFile(rt, ic->data);
            if (!fr.bitmap.empty() && a.find(fr.bitmap)) {
                info.icon = fr.bitmap;
            } else if (!fr.xml.empty()) {
                // adaptive icon: <adaptive-icon><background android:drawable/><foreground android:drawable/>
                std::string xbuf;
                std::vector<XmlElem> ix;
                const Entry* xe = a.find(fr.xml);
                if (xe && a.read(*xe, xbuf, 1 << 20) && parseAxml(xbuf, ix)) {
                    for (const auto& el : ix) {
                        if (el.name != "background" && el.name != "foreground") continue;
                        const XmlAttr* d = el.attr(ATTR_DRAWABLE, "drawable");
                        if (!d) continue;
                        if (d->type >= TYPE_INT_COLOR_ARGB8 && d->type <= TYPE_INT_COLOR_RGB4) {
                            if (el.name == "background") {
                                info.hasIconBgColor = true;
                                info.iconBgColor = d->data;
                            }
                            continue;
                        }
                        if (!isPlainRef(d)) continue;
                        FileRes layer = resolveFile(rt, d->data);
                        if (el.name == "foreground" && !layer.bitmap.empty()) info.iconFg = layer.bitmap;
                        if (el.name == "background") {
                            if (!layer.bitmap.empty()) info.iconBg = layer.bitmap;
                            else if (layer.isColor) {
                                info.hasIconBgColor = true;
                                info.iconBgColor = layer.color;
                            }
                        }
                    }
                }
            }
        }
    }
    if (info.icon.empty() && info.iconFg.empty()) {
        // fallback: res/mipmap-*/ic_launcher.png (highest density folder)
        static const char* dens[] = {"xxxhdpi", "xxhdpi", "xhdpi", "hdpi", "mdpi", ""};
        int bestD = 99;
        for (const auto& e : a.entries()) {
            if (!startsWith(e.name, "res/") || !isBitmap(e.name)) continue;
            std::string b = lower(baseName(e.name));
            if (!startsWith(b, "ic_launcher.") && !startsWith(b, "icon.") && !startsWith(b, "app_icon.")) continue;
            for (int d = 0; dens[d]; d++) {
                if (e.name.find(dens[d]) != std::string::npos) {
                    if (d < bestD) {
                        bestD = d;
                        info.icon = e.name;
                    }
                    break;
                }
            }
        }
    }

    // ---- native libraries & engines
    std::set<std::string> abis, engines;
    static const struct {
        const char* lib;
        const char* engine;
    } kLibs[] = {
        {"libunity.so", "Unity"},
        {"libil2cpp.so", "Unity"},
        {"libUE4.so", "Unreal Engine"},
        {"libUnreal.so", "Unreal Engine"},
        {"libgodot_android.so", "Godot"},
        {"libcocos2dcpp.so", "Cocos2d-x"},
        {"libcocos2djs.so", "Cocos2d-x"},
        {"libcocos2dlua.so", "Cocos2d-x"},
        {"libcocos.so", "Cocos Creator"},
        {"libflutter.so", "Flutter"},
        {"libreactnativejni.so", "React Native"},
        {"libhermes.so", "React Native"},
        {"libmonodroid.so", "Xamarin / .NET MAUI"},
        {"libmonosgen-2.0.so", "Xamarin / .NET MAUI"},
        {"libgdx.so", "libGDX"},
        {"libyoyo.so", "GameMaker"},
        {"libcorona.so", "Solar2D"},
        {"libSDL2.so", "SDL2"},
        {"libdefold.so", "Defold"},
        {"libxwalkcore.so", "Crosswalk"},  // Crosswalk = bundled Chromium: still web content
    };
    for (const auto& e : a.entries()) {
        if (startsWith(e.name, "lib/")) {
            size_t s = e.name.find('/', 4);
            if (s != std::string::npos) abis.insert(e.name.substr(4, s - 4));
            std::string b = baseName(e.name);
            for (const auto& L : kLibs)
                if (b == L.lib) engines.insert(L.engine);
        } else if (startsWith(e.name, "assets/")) {
            if (startsWith(e.name, "assets/bin/Data/")) engines.insert("Unity");
            else if (startsWith(e.name, "assets/flutter_assets/")) engines.insert("Flutter");
            else if (e.name == "assets/index.android.bundle") engines.insert("React Native");
            else if (endsWith(e.name, ".pck") && depthOf(e.name) == 1) engines.insert("Godot");
            else if (e.name == "assets/game.droid") engines.insert("GameMaker");
        }
    }
    info.abis.assign(abis.begin(), abis.end());
    info.engines.assign(engines.begin(), engines.end());
    bool nativeEngine = false;
    for (const auto& en : engines)
        if (en != "Crosswalk") nativeEngine = true;

    // ---- collect html pages under assets/
    std::vector<const Entry*> htmls;
    for (const auto& e : a.entries()) {
        if (!startsWith(e.name, "assets/")) continue;
        std::string l = lower(e.name);
        if (endsWith(l, ".html") || endsWith(l, ".htm")) htmls.push_back(&e);
    }

    // ---- references in dex code: loadUrl("file:///android_asset/...")
    std::vector<std::string> dexAssetRefs, dexLoaderRefs;
    bool usesWebView = false;
    {
        uint64_t scanned = 0;
        for (const auto& e : a.entries()) {
            if (!(startsWith(e.name, "classes") && endsWith(e.name, ".dex")) || e.name.find('/') != std::string::npos)
                continue;
            if (scanned > (400ull << 20)) break;
            std::string d;
            if (!a.read(e, d, 160ull << 20)) continue;
            scanned += d.size();
            scanForPrefix(d, "file:///android_asset/", dexAssetRefs);
            scanForPrefix(d, "https://appassets.androidplatform.net/assets/", dexLoaderRefs);
            if (!usesWebView && d.find("Landroid/webkit/WebView;") != std::string::npos) usesWebView = true;
        }
    }

    auto setWeb = [&](const std::string& root, const std::string& entry, const std::string& fw, bool guessed) {
        info.kind = Kind::Web;
        info.webRoot = root;
        info.entry = entry;
        if (info.framework.empty()) info.framework = fw;
        info.guessed = guessed;
    };

    // 1) Cordova: assets/www + res/xml/config.xml <content src="..."/>
    if (!nativeEngine && info.kind == Kind::Unknown) {
        const Entry* cfg = a.find("res/xml/config.xml");
        std::string src;
        bool isCordova = a.find("assets/www/cordova.js") != nullptr;
        if (cfg) {
            std::string cbuf;
            std::vector<XmlElem> cx;
            if (a.read(*cfg, cbuf, 4 << 20) && parseAxml(cbuf, cx) && !cx.empty() && cx[0].name == "widget") {
                isCordova = true;
                for (const auto& el : cx)
                    if (el.name == "content")
                        if (auto* s = el.attr(0, "src")) src = s->str;
            }
        }
        if (isCordova) {
            info.cordova = true;
            info.framework = "Cordova";
            std::string l = lower(src);
            if ((startsWith(l, "http://") || startsWith(l, "https://")) && !isPrivateUrl(src)) {
                info.kind = Kind::Remote;
                info.remoteUrl = src;
            } else {
                // "https://localhost/index.html" or "index.html"
                if (startsWith(l, "http")) {
                    size_t s3 = src.find('/', src.find("//") + 2);
                    src = s3 == std::string::npos ? std::string() : src.substr(s3 + 1);
                }
                if (src.empty()) src = "index.html";
                if (a.find("assets/www/" + stripQuery(src))) setWeb("assets/www", src, "Cordova", false);
            }
        }
    }

    // 2) Capacitor: assets/public + assets/capacitor.config.json
    if (!nativeEngine && info.kind == Kind::Unknown) {
        if (const Entry* cc = a.find("assets/capacitor.config.json")) {
            info.framework = "Capacitor";
            std::string json;
            a.read(*cc, json, 1 << 20);
            size_t srv = json.find("\"server\"");
            std::string url = srv == std::string::npos ? std::string() : jsonGetString(json, "url", srv);
            if (!url.empty() && startsWith(lower(url), "http") && !isPrivateUrl(url)) {
                info.kind = Kind::Remote;
                info.remoteUrl = url;
            } else if (a.find("assets/public/index.html")) {
                setWeb("assets/public", "index.html", "Capacitor", false);
            }
        }
    }

    // 3) explicit references from the app code
    if (!nativeEngine && info.kind == Kind::Unknown) {
        for (const auto& r : dexAssetRefs) {
            std::string path = stripQuery(r);
            std::string l = lower(path);
            if (!(endsWith(l, ".html") || endsWith(l, ".htm"))) continue;
            if (!a.find("assets/" + path) || !looksLikeAppPage(path)) continue;
            setWeb("assets", r, "WebView", false);
            break;
        }
    }
    if (!nativeEngine && info.kind == Kind::Unknown) {
        for (const auto& r : dexLoaderRefs) {
            std::string path = stripQuery(r);
            std::string l = lower(path);
            if (!(endsWith(l, ".html") || endsWith(l, ".htm"))) continue;
            if (!a.find("assets/" + path) || !looksLikeAppPage(path)) continue;
            setWeb("assets", r, "WebView", false);
            break;
        }
    }

    // 4) heuristic: best looking html page in assets/
    if (!nativeEngine && info.kind == Kind::Unknown && !htmls.empty()) {
        const Entry* best = nullptr;
        auto score = [](const Entry* e) {
            std::string b = lower(baseName(e->name));
            int s = 0;
            if (b == "index.html" || b == "index.htm") s += 1000;
            else if (b == "game.html" || b == "main.html" || b == "app.html" || b == "start.html" || b == "home.html") s += 600;
            s -= depthOf(e->name) * 100;
            if (e->size > 1024) s += 50;
            return s;
        };
        for (const Entry* e : htmls) {
            if (!looksLikeAppPage(e->name)) continue;
            if (!best || score(e) > score(best) || (score(e) == score(best) && e->size > best->size)) best = e;
        }
        if (best) {
            // only trust a guess when the page is substantial or comes with scripts next to it
            bool hasScripts = false;
            std::string dir = dirName(best->name) + "/";
            for (const auto& e : a.entries())
                if (startsWith(e.name, dir) && endsWith(lower(e.name), ".js")) {
                    hasScripts = true;
                    break;
                }
            if (best->size > 4096 || hasScripts)
                setWeb("assets", best->name.substr(7), usesWebView ? "WebView" : "HTML5", true);
        }
    }

    // 5) website wrappers: Trusted Web Activity / WebView shells pointing at a URL
    if (info.kind == Kind::Unknown && !nativeEngine) {
        for (const auto& el : xml) {
            if (el.name != "meta-data") continue;
            const XmlAttr* nm = el.attr(ATTR_NAME, "name");
            if (!nm || nm->str != "android.support.customtabs.trusted.DEFAULT_URL") continue;
            std::string url = attrString(rt, el.attr(ATTR_VALUE, "value"));
            if (startsWith(lower(url), "http")) {
                info.kind = Kind::Remote;
                info.remoteUrl = url;
                info.framework = "Trusted Web Activity";
            }
        }
        if (info.kind == Kind::Unknown && usesWebView && rt) {
            static const char* keys[] = {"launchUrl", "launch_url", "start_url", "startUrl", "app_url", "appUrl",
                                         "web_url", "webUrl", "base_url", "baseUrl", "website_url", "home_url",
                                         "main_url", "webview_url", "site_url", nullptr};
            std::string found;
            rt->forEachString([&](const std::string& k, const std::string& v) {
                if (!found.empty() || !startsWith(lower(v), "http")) return;
                for (int i = 0; keys[i]; i++)
                    if (k == keys[i]) {
                        found = v;
                        return;
                    }
            });
            if (!found.empty()) {
                info.kind = Kind::Remote;
                info.remoteUrl = found;
                info.framework = "WebView";
                info.guessed = true;
            }
        }
    }

    if (info.kind == Kind::Unknown) {
        info.kind = Kind::Native;
        if (info.framework.empty()) {
            for (const auto& en : engines)
                if (en != "Crosswalk") {
                    info.framework = en;
                    break;
                }
        }
        if (info.framework.empty()) info.framework = "Java/Kotlin";
    }

    // ---- web content statistics + keyboard support hint
    if (info.kind == Kind::Web) {
        std::string prefix = info.webRoot + "/";
        uint64_t budget = 48ull << 20;
        for (const auto& e : a.entries()) {
            if (!startsWith(e.name, prefix)) continue;
            info.webBytes += e.size;
            info.webFiles++;
            if (info.keyboard || budget == 0) continue;
            std::string l = lower(e.name);
            if (!(endsWith(l, ".js") || endsWith(l, ".html") || endsWith(l, ".htm") || endsWith(l, ".mjs"))) continue;
            if (e.size > (16ull << 20) || e.size > budget) continue;
            std::string s;
            if (!a.read(e, s)) continue;
            budget -= e.size;
            if (s.find("keydown") != std::string::npos || s.find("keyup") != std::string::npos ||
                s.find("KeyboardEvent") != std::string::npos)
                info.keyboard = true;
        }
    }
    return true;
}

std::string jsonEscape(const std::string& s) {
    std::string o;
    o.reserve(s.size() + 8);
    for (unsigned char c : s) {
        switch (c) {
            case '"': o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n"; break;
            case '\r': o += "\\r"; break;
            case '\t': o += "\\t"; break;
            case '<': o += "\\u003c"; break;  // safe to embed in <script>
            case '>': o += "\\u003e"; break;
            default:
                if (c < 0x20) {
                    char b[8];
                    snprintf(b, sizeof b, "\\u%04x", c);
                    o += b;
                } else {
                    o += char(c);
                }
        }
    }
    return o;
}

std::string toJson(const Info& i) {
    auto q = [](const std::string& s) { return "\"" + jsonEscape(s) + "\""; };
    auto arr = [&](const std::vector<std::string>& v) {
        std::string o = "[";
        for (size_t k = 0; k < v.size(); k++) o += (k ? "," : "") + q(v[k]);
        return o + "]";
    };
    std::string o = "{";
    o += "\"package\":" + q(i.package);
    o += ",\"label\":" + q(i.label);
    o += ",\"versionName\":" + q(i.versionName);
    o += ",\"versionCode\":" + q(i.versionCode);
    o += ",\"minSdk\":" + std::to_string(i.minSdk);
    o += ",\"targetSdk\":" + std::to_string(i.targetSdk);
    o += ",\"orientation\":" + q(i.orientation);
    o += ",\"icon\":" + q(i.icon);
    o += ",\"iconFg\":" + q(i.iconFg);
    o += ",\"iconBg\":" + q(i.iconBg);
    o += ",\"iconBgColor\":" + q(i.hasIconBgColor ? normalizeColor(0, i.iconBgColor) : std::string());
    o += ",\"kind\":" + q(kindName(i.kind));
    o += ",\"framework\":" + q(i.framework);
    o += ",\"webRoot\":" + q(i.webRoot);
    o += ",\"entry\":" + q(i.entry);
    o += ",\"remoteUrl\":" + q(i.remoteUrl);
    o += std::string(",\"guessed\":") + (i.guessed ? "true" : "false");
    o += std::string(",\"cordova\":") + (i.cordova ? "true" : "false");
    o += std::string(",\"keyboard\":") + (i.keyboard ? "true" : "false");
    o += ",\"abis\":" + arr(i.abis);
    o += ",\"engines\":" + arr(i.engines);
    o += ",\"webBytes\":" + std::to_string(i.webBytes);
    o += ",\"webFiles\":" + std::to_string(i.webFiles);
    o += "}";
    return o;
}

}  // namespace apk
